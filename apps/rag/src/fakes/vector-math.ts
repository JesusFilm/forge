/**
 * Tiny vector helpers for the in-memory fakes: cosine similarity (the ranking
 * the real pgvector store does in SQL) and a deterministic text→unit-vector
 * function so FakeEmbedder produces stable, reproducible embeddings. Identical
 * text yields cosine 1.0; distinct text yields lower scores — enough for
 * Retrieval/Indexing unit tests to assert ranking without a real model.
 */
import { createHash } from "node:crypto"

export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  let dot = 0
  let magA = 0
  let magB = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

function seedFromText(text: string): number {
  return createHash("sha256").update(text).digest().readUInt32BE(0)
}

/** Seeded PRNG (mulberry32) — deterministic across runs and platforms. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic unit vector derived from `text`. */
export function deterministicVector(
  text: string,
  dimensions: number,
): number[] {
  const rng = mulberry32(seedFromText(text))
  const v = new Array<number>(dimensions)
  let norm = 0
  for (let i = 0; i < dimensions; i++) {
    const x = rng() * 2 - 1
    v[i] = x
    norm += x * x
  }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < dimensions; i++) v[i] /= norm
  return v
}
