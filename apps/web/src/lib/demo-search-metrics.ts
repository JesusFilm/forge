// Page-scoped metrics for the /demo-search showcase.
//
// Records wall-clock round-trip for each semanticSearch query the demo page
// fires client-side (initial page-load latency is server-side and not captured
// here — see the demo page copy for the methodology note). Counters reset on
// every page load — the panel copy says "this session" meaning the current
// visit, not a persistent tab session.
//
// Embedding cost assumption below tracks OpenAI text-embedding-3-small via
// OpenRouter at ~20 tokens/query. Adjust both the constant and the demo panel
// copy together if the embedding model changes.

const EMBEDDING_COST_USD_PER_QUERY = 0.0000006

export type DemoSearchStats = {
  count: number
  p50Ms: number | null
  p95Ms: number | null
  totalEmbeddingCostUsd: number
}

const listeners = new Set<() => void>()
let samples: number[] = []

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  const weight = rank - lo
  return sorted[lo] * (1 - weight) + sorted[hi] * weight
}

// Cached snapshot so getStats() returns a stable reference across reads when
// nothing has changed. This matters for React's useSyncExternalStore, which
// does Object.is on the snapshot — returning a fresh object every render
// triggers an infinite re-render loop.
let cachedStats: DemoSearchStats | null = null

function invalidateCache() {
  cachedStats = null
}

export function recordQuery(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return
  samples.push(durationMs)
  invalidateCache()
  listeners.forEach((listener) => listener())
}

export function getStats(): DemoSearchStats {
  if (cachedStats !== null) return cachedStats
  if (samples.length === 0) {
    cachedStats = {
      count: 0,
      p50Ms: null,
      p95Ms: null,
      totalEmbeddingCostUsd: 0,
    }
    return cachedStats
  }
  const sorted = [...samples].sort((a, b) => a - b)
  cachedStats = {
    count: samples.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    totalEmbeddingCostUsd: samples.length * EMBEDDING_COST_USD_PER_QUERY,
  }
  return cachedStats
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function __resetForTests(): void {
  samples = []
  listeners.clear()
  invalidateCache()
}

export { EMBEDDING_COST_USD_PER_QUERY }
