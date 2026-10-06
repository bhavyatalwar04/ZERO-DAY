import { createOpenAI } from '@ai-sdk/openai';
import { generateText, streamText } from 'ai';

// Array of provided keys
const GROQ_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
].filter(Boolean) as string[];

let currentKeyIndex = 0;

function getClient(key: string) {
  return createOpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: key,
  });
}

/**
 * Executes a function that returns a Promise (e.g., generateText or streamText).
 * If it hits a rate limit (status 429), it switches to the next Groq API key and retries.
 */
export async function withGroqFallback<T>(
  operation: (model: any) => Promise<T>
): Promise<T> {
  let attempts = 0;
  const maxAttempts = GROQ_KEYS.length;

  while (attempts < maxAttempts) {
    try {
      const groq = getClient(GROQ_KEYS[currentKeyIndex]);
      // P7: was llama-3.1-8b-instant, which isn't on the project's key. Only /api/sentiment (unreachable) uses this.
      return await operation(groq('openai/gpt-oss-20b'));
    } catch (error: any) {
      const isRateLimit = error?.statusCode === 429 || error?.message?.includes('429');
      
      if (isRateLimit) {
        console.warn(`[Groq] Rate limit hit on key index ${currentKeyIndex}. Switching keys...`);
        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
        attempts++;
      } else {
        throw error;
      }
    }
  }

  throw new Error('All Groq API keys rate limited or failed.');
}
