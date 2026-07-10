export type RetrievalSignal = {
  coreId: string
  videoVariantId: string
  visualScore?: number
  audioScore?: number
  textScore?: number
  durationScore?: number
}

export type TimecodedStringSignature = {
  coreId: string
  videoVariantId: string
  offsetMilliseconds: number
  value: string
}

export function jaccardScore(
  left: Iterable<string>,
  right: Iterable<string>,
): number {
  const leftSet = new Set(left)
  const rightSet = new Set(right)

  if (leftSet.size === 0 || rightSet.size === 0) return 0

  let intersection = 0
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1
  }

  return intersection / new Set([...leftSet, ...rightSet]).size
}

export function mergeSignals(signals: RetrievalSignal[]): RetrievalSignal[] {
  const byVariant = new Map<string, RetrievalSignal>()

  for (const signal of signals) {
    const key = retrievalSignalKey(signal)
    const existing = byVariant.get(key)

    if (!existing) {
      byVariant.set(key, { ...signal })
      continue
    }

    byVariant.set(key, {
      ...existing,
      visualScore: maxOptional(existing.visualScore, signal.visualScore),
      audioScore: maxOptional(existing.audioScore, signal.audioScore),
      textScore: maxOptional(existing.textScore, signal.textScore),
      durationScore: maxOptional(existing.durationScore, signal.durationScore),
    })
  }

  return Array.from(byVariant.values())
}

export function retrievalSignalKey(
  signal: Pick<RetrievalSignal, "coreId" | "videoVariantId">,
): string {
  return `${signal.coreId}:${signal.videoVariantId}`
}

function maxOptional(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return Math.max(left, right)
}
