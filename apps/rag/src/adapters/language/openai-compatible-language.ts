import type {
  DetectedLanguage,
  LanguageDetector,
  LlmReviewer,
} from "../../contracts/index.js"

const LANGUAGE_PROMPT =
  'Identify the language of the document\'s MAIN CONTENT. Ignore navigation, breadcrumbs, footer, copyright, cookie banners, share controls, related links, and other site chrome. Reply only with JSON: {"language": string|null, "confidence": number, "evidence": string}. language must be a lowercase ISO 639-1 code or null; evidence must be a short quote from the main body. Declared languages are hints only; content wins.'

type Options = {
  apiKey: string
  model: string
  baseUrl?: string
  timeoutMs?: number
  maxAttempts?: number
  maxOutputTokens?: number
}

type Completion = {
  choices?: Array<{
    message?: { content?: string | null }
    finish_reason?: string | null
  }>
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
  ) {
    super(`chat completion failed: ${status} ${statusText}`)
  }
}

function retryable(error: unknown): boolean {
  if (error instanceof HttpError)
    return error.status === 429 || error.status >= 500
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.name === "AbortError")
  )
}

function parseDetection(content: string): DetectedLanguage {
  const start = content.indexOf("{")
  const end = content.lastIndexOf("}")
  const value = JSON.parse(
    start >= 0 && end >= start ? content.slice(start, end + 1) : content,
  ) as Record<string, unknown>
  if (!("language" in value))
    throw new Error("language detection response missing language")
  const code =
    typeof value.language === "string"
      ? value.language.trim().toLowerCase()
      : ""
  const language = /^[a-z]{2}$/.test(code) ? code : null
  if (
    language &&
    (typeof value.confidence !== "number" ||
      value.confidence < 0 ||
      value.confidence > 1)
  )
    throw new Error("language detection response has invalid confidence")
  return {
    language,
    confidence: language ? (value.confidence as number) : 0,
    evidence:
      typeof value.evidence === "string" ? value.evidence.slice(0, 240) : "",
  }
}

class ChatClient {
  readonly model: string
  constructor(private readonly options: Options) {
    if (!options.apiKey)
      throw new Error("OpenAI-compatible chat: apiKey is required")
    this.model = options.model
  }

  async complete(system: string, user: string, json = false): Promise<string> {
    const attempts = Math.max(1, this.options.maxAttempts ?? 10)
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.completeOnce(system, user, json)
      } catch (error) {
        if (attempt >= attempts || !retryable(error)) throw error
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(500 * 2 ** (attempt - 1), 8_000)),
        )
      }
    }
  }

  private async completeOnce(
    system: string,
    user: string,
    json: boolean,
  ): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 30_000,
    )
    try {
      const response = await fetch(
        `${(this.options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            ...(json ? { response_format: { type: "json_object" } } : {}),
            temperature: 0,
            max_tokens: this.options.maxOutputTokens ?? (json ? 400 : 1_200),
          }),
          signal: controller.signal,
        },
      )
      if (!response.ok)
        throw new HttpError(response.status, response.statusText)
      const body = (await response.json()) as Completion
      if (body.choices?.[0]?.finish_reason === "length")
        throw new Error(
          "chat completion response truncated at output token limit",
        )
      const content = body.choices?.[0]?.message?.content
      if (!content?.trim())
        throw new Error("chat completion returned empty content")
      return content.trim()
    } finally {
      clearTimeout(timer)
    }
  }
}

export class OpenAICompatibleLanguageDetector implements LanguageDetector {
  readonly model: string
  private readonly client: ChatClient
  constructor(options: Options) {
    this.client = new ChatClient(options)
    this.model = this.client.model
  }
  async detect(
    text: string,
    opts: { declared: readonly string[] },
  ): Promise<DetectedLanguage> {
    if (!text.trim()) return { language: null, confidence: 0, evidence: "" }
    return parseDetection(
      await this.client.complete(
        LANGUAGE_PROMPT,
        `Declared languages (hint only): [${opts.declared.join(", ")}]\n\nDocument:\n${text.trim()}`,
        true,
      ),
    )
  }
}

export class OpenAICompatibleLlmReviewer implements LlmReviewer {
  readonly model: string
  private readonly client: ChatClient
  constructor(options: Options) {
    this.client = new ChatClient(options)
    this.model = this.client.model
  }
  review(instruction: string, content: string): Promise<string> {
    return this.client.complete(instruction, content)
  }
}

export type { Options as OpenAICompatibleLanguageOptions }
export { parseDetection }
