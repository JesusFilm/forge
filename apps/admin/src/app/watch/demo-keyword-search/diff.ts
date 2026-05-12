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

/**
 * Per-id provenance map: which of {H, K} contains each id within
 * its top-K. Used by the demo route to render "also in" badges on
 * each result row without re-traversing arrays.
 */
export type Source = "H" | "K"

export function buildProvenanceMap(
  hybrid: readonly string[],
  keyword: readonly string[],
  k: number,
): Map<string, Set<Source>> {
  const map = new Map<string, Set<Source>>()
  if (k <= 0) return map
  const add = (ids: readonly string[], source: Source): void => {
    const top = dedupeFirst(ids.slice(0, k))
    for (const id of top) {
      const set = map.get(id) ?? new Set<Source>()
      set.add(source)
      map.set(id, set)
    }
  }
  add(hybrid, "H")
  add(keyword, "K")
  return map
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
