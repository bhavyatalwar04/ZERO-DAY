import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { withGroqFallback } from '@/lib/ai/groq-client';
import { requireUser } from '@/lib/auth/require-user'

export const maxDuration = 10;

export async function POST(req: Request) {
  const auth = await requireUser('v1-ai')   // P8 + 8.4: signed-in users only, within the hourly limit
  if (auth instanceof Response) return auth
  try {
    const { headline } = await req.json();

    if (!headline) {
      return NextResponse.json({ error: 'Headline is required' }, { status: 400 });
    }

    const prompt = `
You are a quantitative finance NLP model. Analyze the following news headline and return the exact sentiment.
Respond ONLY with a valid JSON object containing no other text.
Format: { "score": <number between 0 and 100>, "type": "<bullish | bearish | neutral>" }

Headline: "${headline}"
`;

    const textPayload = await withGroqFallback(async (model) => {
      const { text } = await generateText({
        model,
        prompt,
      });
      return text;
    });

    let jsonStr = textPayload.trim();
    if (jsonStr.startsWith('\`\`\`json')) {
      jsonStr = jsonStr.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
    }

    const { score, type } = JSON.parse(jsonStr);

    return NextResponse.json({ score, type: type.toLowerCase() });
  } catch (error: any) {
    console.error('Sentiment Error:', error);
    // Silent fallback so UI doesn't break
    return NextResponse.json({ score: 50, type: 'neutral' });
  }
}
