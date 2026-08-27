/**
 * In-memory Embedder fake. Deterministic vectors (see vector-math) so unit
 * tests get stable, comparable embeddings with no network. Adopts the
 * reconciled port shape (docs/architecture.md §4 note): `embed` returns
 * `(number[] | null)[]` — null for empty/whitespace input — and exposes
 * `readonly model` / `readonly dimensions`. The null-per-empty-input is the
 * load-bearing skip path the dedup/ingest logic relies on.
 */
import type { Embedder } from "../contracts/index.js"
import { deterministicVector } from "./vector-math.js"

export interface FakeEmbedderOptions {
  model?: string
  /** Default 1536 to match the real model; override smaller for fast tests. */
  dimensions?: number
}

export class FakeEmbedder implements Embedder {
  readonly model: string
  readonly dimensions: number

  constructor(options: FakeEmbedderOptions = {}) {
    this.model = options.model ?? "fake/deterministic-embedder"
    this.dimensions = options.dimensions ?? 1536
  }

  async embed(texts: string[]): Promise<(number[] | null)[]> {
    return texts.map((t) =>
      t.trim() === "" ? null : deterministicVector(t, this.dimensions),
    )
  }

  async embedQuery(text: string): Promise<number[]> {
    return deterministicVector(text, this.dimensions)
  }
}
