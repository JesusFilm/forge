// Session-scoped metrics for the /demo-search showcase.
//
// Records wall-clock round-trip for each semanticSearch query the demo page
// fires client-side (initial page-load latency is server-side and not captured
// here — see the demo page copy for the methodology note).
//
// Embedding cost assumption below tracks OpenAI text-embedding-3-small via
// OpenRouter at ~20 tokens/query. Adjust both the constant and the demo panel
// copy together if the embedding model changes.

const EMBEDDING_COST_USD_PER_QUERY = 0.0000006

const STORAGE_KEY = "demo-search-metrics:v1"

type SerializedState = {
  samples: number[]
}

export type DemoSearchStats = {
  count: number
  p50Ms: number | null
  p95Ms: number | null
  totalEmbeddingCostUsd: number
}

const listeners = new Set<() => void>()
let samples: number[] = []
let hydrated = false

function hasSessionStorage(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.sessionStorage !== "undefined"
    )
  } catch {
    return false
  }
}

function hydrate() {
  if (hydrated) return
  hydrated = true
  if (!hasSessionStorage()) return
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as SerializedState
    if (Array.isArray(parsed.samples)) {
      samples = parsed.samples.filter(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
      )
    }
  } catch {
    // Corrupted storage — drop silently, start fresh.
  }
}

function persist() {
  if (!hasSessionStorage()) return
  try {
    const payload: SerializedState = { samples }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota exceeded or access denied — keep the in-memory copy.
  }
}

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
  hydrate()
  samples.push(durationMs)
  invalidateCache()
  persist()
  listeners.forEach((listener) => listener())
}

export function getStats(): DemoSearchStats {
  hydrate()
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
  hydrated = false
  listeners.clear()
  invalidateCache()
  if (hasSessionStorage()) {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
}

export { EMBEDDING_COST_USD_PER_QUERY }
