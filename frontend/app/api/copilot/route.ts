import { NextResponse } from 'next/server';
import { V1_MODEL_PARAMS, REASONING_HEADROOM } from '@/lib/ai/v1-model'
import { requireUser } from '@/lib/auth/require-user'

export const maxDuration = 30;

let currentKeyIndex = 0;

export async function POST(req: Request) {
  const auth = await requireUser('v1-ai')   // P8 + 8.4: signed-in users only, within the hourly limit
  if (auth instanceof Response) return auth
  try {
    const GROQ_KEYS = [
      process.env.GROQ_API_KEY_1,
      process.env.GROQ_API_KEY_2,
      process.env.GROQ_API_KEY_3,
      process.env.GROQ_API_KEY_4,
    ].filter(Boolean) as string[];

    if (GROQ_KEYS.length === 0) {
      console.error('[API/Copilot] Missing Groq API keys in environment.');
      return NextResponse.json({ error: 'System configuration error.' }, { status: 500 });
    }

    const json = await req.json();
    console.log('[API/Copilot] Received payload');
    
    const { messages } = json;
    const context = json.context as string | undefined
    const marketContext = json.marketContext || json.data?.marketContext;

    // Portfolio coach mode — short whispers, no hand-holding
    if (context === 'portfolio') {
      const portfolioSystemPrompt = `You are a quiet trading coach watching someone play a portfolio simulation. Give a single 1-sentence observation about their behaviour. Never tell them what to do explicitly. Under 20 words total. If a cognitive bias applies (anchoring, recency bias, FOMO, disposition effect, loss aversion), name it. Be direct, not encouraging.`

      const formattedMessages = [
        { role: 'system', content: portfolioSystemPrompt },
        ...messages,
      ]

      let attempts = 0
      while (attempts < GROQ_KEYS.length) {
        try {
          const apiKey = GROQ_KEYS[currentKeyIndex]
          const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...V1_MODEL_PARAMS,   // P7: was llama-3.1-8b-instant (not on the key)
              messages: formattedMessages,
              stream: false,
              temperature: 0.5,
              max_tokens: 40 + REASONING_HEADROOM,
            }),
          })
          if (response.status === 429) { currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length; attempts++; continue }
          if (!response.ok) throw new Error(`Groq ${response.status}`)
          const data = await response.json()
          const text = data.choices?.[0]?.message?.content ?? ''
          return new Response(text, { headers: { 'Content-Type': 'text/plain' } })
        } catch {
          currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length
          attempts++
        }
      }
      return NextResponse.json({ error: 'All keys failed' }, { status: 500 })
    }

    const systemPrompt = `
You are an expert quantitative trading teacher. Your goal is to help the user understand the current market setup and answer any trading questions they have.
Explain concepts clearly, patiently, and structurally, like a tutor. 

Current Market Context (Live Data):
Price: ${marketContext?.price || 'Unknown'}
RSI: ${marketContext?.rsi || 'Unknown'}
MACD: ${marketContext?.macd || 'Unknown'}
Recent Event: ${marketContext?.news || 'None'}

Format your responses in markdown. Use bolding and lists for readability, but keep it concise and strictly focused on education and the user's question. Do not roleplay; answer as a helpful AI teacher.
`;

    // Format messages for OpenAI/Groq API
    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    let attempts = 0;
    while (attempts < GROQ_KEYS.length) {
      try {
        const apiKey = GROQ_KEYS[currentKeyIndex];
        console.log(`[API/Copilot] Attempting with key index: ${currentKeyIndex}`);
        
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...V1_MODEL_PARAMS,   // P7: was llama-3.1-8b-instant (not on the key)
            messages: formattedMessages,
            stream: true,
            temperature: 0.7,
            max_tokens: 1024 + REASONING_HEADROOM,
          }),
        });

        if (response.status === 429) {
          console.warn(`[Groq] Rate limit hit on key index ${currentKeyIndex}. Switching keys...`);
          currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
          attempts++;
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Groq API Error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        // Return the stream directly bypassing Vercel AI SDK
        // Transform the stream to extract just the text content from the Server-Sent Events
        const stream = new ReadableStream({
          async start(controller) {
            const reader = response.body?.getReader();
            if (!reader) {
              controller.close();
              return;
            }

            const decoder = new TextDecoder();
            
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                  if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                      const data = JSON.parse(line.slice(6));
                      if (data.choices && data.choices[0].delta.content) {
                        // Queue just the raw text chunk
                        controller.enqueue(new TextEncoder().encode(data.choices[0].delta.content));
                      }
                    } catch (e) {
                      // ignore parse errors
                    }
                  }
                }
              }
            } catch (err) {
              console.error('Stream reading error:', err);
              controller.error(err);
            } finally {
              controller.close();
            }
          }
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'no-cache',
          },
        });

      } catch (err: any) {
        console.error(`[API/Copilot] Error on attempt ${attempts}:`, err);
        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
        attempts++;
        if (attempts >= GROQ_KEYS.length) {
            return NextResponse.json({ error: 'All Groq keys failed.', details: err.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ error: 'All Groq keys rate limited or failed.', debug: `Tried ${attempts} times.` }, { status: 500 });
  } catch (error: any) {
    console.error('Copilot Error:', error);
    return NextResponse.json({ error: 'Internal server error processing AI debate.', details: error.message }, { status: 500 });
  }
}
