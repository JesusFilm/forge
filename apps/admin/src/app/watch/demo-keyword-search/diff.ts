/**
 * Pure helper: compute top-K overlap between two ordered id lists.
 *
 * - `both` preserves the order of the first list (`a`).
 * - `aOnly` / `bOnly` preserve their respective input order.
 * - Only the first `k` ids of each input are considered.
 * - Duplicates within a single input are tolerated; the first
 *   occurrence wins, later duplicates are ignored.
 */

export type TopKDiff = {
  both: string[]
  aOnly: string[]
  bOnly: string[]
}

export function computeTopKDiff(
  a: readonly string[],
  b: readonly string[],
  k: number,
): TopKDiff {
  if (k <= 0) return { both: [], aOnly: [], bOnly: [] }

  const aTop = dedupeFirst(a.slice(0, k))
  const bTop = dedupeFirst(b.slice(0, k))
  const aSet = new Set(aTop)
  const bSet = new Set(bTop)

  const both: string[] = []
  const aOnly: string[] = []
  const bOnly: string[] = []

  for (const id of aTop) {
    if (bSet.has(id)) both.push(id)
    else aOnly.push(id)
  }
  for (const id of bTop) {
    if (!aSet.has(id)) bOnly.push(id)
  }

  return { both, aOnly, bOnly }
}

function dedupeFirst(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
