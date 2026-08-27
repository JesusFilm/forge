import type { Embedder } from "../../contracts/index.js"

export type FallbackEmbedderOptions = {
  primary: Embedder
  fallback: Embedder
}

/** Keeps the gateway primary while preserving OpenRouter as provider failover. */
export class FallbackEmbedder implements Embedder {
  readonly model: string
  readonly dimensions: number

  constructor(private readonly options: FallbackEmbedderOptions) {
    if (options.primary.model !== options.fallback.model) {
      throw new Error("FallbackEmbedder: canonical model mismatch")
    }
    if (options.primary.dimensions !== options.fallback.dimensions) {
      throw new Error("FallbackEmbedder: dimensions mismatch")
    }
    this.model = options.primary.model
    this.dimensions = options.primary.dimensions
  }

  async embed(texts: string[]): Promise<(number[] | null)[]> {
    try {
      return await this.options.primary.embed(texts)
    } catch {
      return this.options.fallback.embed(texts)
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      return await this.options.primary.embedQuery(text)
    } catch {
      return this.options.fallback.embedQuery(text)
    }
  }
}
