import OpenAI from 'openai'

let client: OpenAI | null = null
function getClient(): OpenAI {
  if (client) return client
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')
  client = new OpenAI({ apiKey })
  return client
}

export type ChatOpts = {
  model: string
  systemPrompt: string
  userPrompt: string
  /** Set true to force `response_format: json_object`. */
  jsonMode?: boolean
  maxTokens?: number
  temperature?: number
}

/**
 * Single chat completion with rate-limit retry. Returns the assistant's text.
 *
 * On 429s: backs off (5s, 10s, 15s) for up to 3 attempts. Other errors throw.
 * Caller is responsible for parsing / validating the response body.
 */
export async function chatComplete(opts: ChatOpts): Promise<string> {
  const c = getClient()
  const maxRetries = 3
  let lastError: unknown

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await c.chat.completions.create({
        model: opts.model,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userPrompt },
        ],
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 1,
        response_format: opts.jsonMode ? { type: 'json_object' } : undefined,
      })
      return res.choices[0]?.message?.content ?? ''
    } catch (e) {
      lastError = e
      if (e instanceof OpenAI.RateLimitError) {
        const waitMs = (attempt + 1) * 5000
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      throw e
    }
  }
  throw lastError
}

/** Same as chatComplete but JSON-parses the result. Throws on parse failure. */
export async function chatCompleteJson<T = unknown>(opts: ChatOpts): Promise<T> {
  const text = await chatComplete({ ...opts, jsonMode: true })
  return JSON.parse(text) as T
}
