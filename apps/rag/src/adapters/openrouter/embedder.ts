import type { Embedder } from "../../contracts/index.js"

export type OpenRouterEmbedderOptions = {
  apiKey: string
  model: string
  dimensions?: number
  truncateToDimensions?: boolean
  baseUrl?: string
  wireModel?: string
  queryInstruction?: string
  timeoutMs?: number
  maxAttempts?: number
}

type EmbeddingResponse = {
  data?: Array<{ embedding: number[]; index: number }>
}

export class OpenRouterEmbedder implements Embedder {
  readonly model: string
  readonly dimensions: number

  constructor(private readonly options: OpenRouterEmbedderOptions) {
    if (!options.apiKey)
      throw new Error("OpenRouterEmbedder: apiKey is required")
    this.model = options.model
    this.dimensions = options.dimensions ?? 1536
  }

  async embed(texts: string[]): Promise<(number[] | null)[]> {
    const result: (number[] | null)[] = Array(texts.length).fill(null)
    const pending = texts
      .map((text, index) => ({ text: text.replace(/\n+/g, " ").trim(), index }))
      .filter(({ text }) => text.length > 0)
    if (pending.length === 0) return result
    const vectors = await this.request(pending.map(({ text }) => text))
    pending.forEach(({ index }, offset) => {
      result[index] = vectors[offset]
    })
    return result
  }

  async embedQuery(text: string): Promise<number[]> {
    const query = text.replace(/\n+/g, " ").trim()
    if (!query) throw new Error("embedQuery: query text is empty")
    const input = this.options.queryInstruction
      ? `Instruct: ${this.options.queryInstruction}\nQuery: ${query}`
      : query
    return (await this.request([input]))[0]
  }

  private async request(inputs: string[]): Promise<number[][]> {
    const attempts = Math.max(1, this.options.maxAttempts ?? 2)
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.requestOnce(inputs)
      } catch (error) {
        if (attempt >= attempts || !isRetryable(error)) throw error
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * 2 ** (attempt - 1)),
        )
      }
    }
  }

  private async requestOnce(inputs: string[]): Promise<number[][]> {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 4_000,
    )
    try {
      const response = await fetch(
        `${(this.options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/embeddings`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.options.wireModel ?? this.model,
            input: inputs,
            dimensions: this.dimensions,
          }),
          signal: controller.signal,
        },
      )
      if (!response.ok) {
        const error = new Error(
          `embeddings failed: ${response.status} ${response.statusText}`,
        ) as Error & { retryable?: boolean }
        error.retryable = response.status === 429 || response.status >= 500
        throw error
      }
      const body = (await response.json()) as EmbeddingResponse
      const rows = [...(body.data ?? [])].sort((a, b) => a.index - b.index)
      if (
        rows.length !== inputs.length ||
        rows.some((row, index) => row.index !== index)
      ) {
        throw new Error("embedding response count/index mismatch")
      }
      return rows.map(({ embedding }, index) => {
        const vector =
          this.options.truncateToDimensions &&
          embedding.length > this.dimensions
            ? normalize(embedding.slice(0, this.dimensions))
            : embedding
        if (
          vector.length !== this.dimensions ||
          vector.some((value) => !Number.isFinite(value))
        ) {
          throw new Error(
            `embedding ${index} has invalid width or non-finite values; expected ${this.dimensions}`,
          )
        }
        return vector
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  )
  return vector.map((value) => value / magnitude)
}

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const value = error as { name?: string; retryable?: boolean }
  return (
    value.retryable === true ||
    value.name === "AbortError" ||
    value.name === "TypeError"
  )
}
