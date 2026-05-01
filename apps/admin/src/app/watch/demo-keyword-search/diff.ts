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
 * 3-way overlap variant. Operates on the same {first-k, dedupe-first}
 * semantics as `computeTopKDiff` but partitions the union of three
 * ordered id lists into 7 buckets:
 *
 * - `inAll`             — present in all three
 * - `hybridKeyword`     — hybrid + keyword-first only
 * - `hybridAlgolia`     — hybrid + algolia only
 * - `keywordAlgolia`    — keyword-first + algolia only
 * - `hybridOnly`        — hybrid alone
 * - `keywordOnly`       — keyword-first alone
 * - `algoliaOnly`       — algolia alone
 *
 * Bucket order preserves the order of the source the id was first seen
 * in (hybrid, then keyword, then algolia).
 *
 * The 3-way diff in the demo route compares by SLUG, not cuid, because
 * Algolia hits don't carry admin's cuid id — `videoId` on the Algolia
 * hit is the same shape as admin's `SearchResult.slug`.
 */
export type ThreeWayDiff = {
  inAll: string[]
  hybridKeyword: string[]
  hybridAlgolia: string[]
  keywordAlgolia: string[]
  hybridOnly: string[]
  keywordOnly: string[]
  algoliaOnly: string[]
}

export function computeThreeWayDiff(
  hybrid: readonly string[],
  keyword: readonly string[],
  algolia: readonly string[],
  k: number,
): ThreeWayDiff {
  const empty: ThreeWayDiff = {
    inAll: [],
    hybridKeyword: [],
    hybridAlgolia: [],
    keywordAlgolia: [],
    hybridOnly: [],
    keywordOnly: [],
    algoliaOnly: [],
  }
  if (k <= 0) return empty

  const h = dedupeFirst(hybrid.slice(0, k))
  const kk = dedupeFirst(keyword.slice(0, k))
  const a = dedupeFirst(algolia.slice(0, k))
  const hSet = new Set(h)
  const kSet = new Set(kk)
  const aSet = new Set(a)

  const out: ThreeWayDiff = {
    inAll: [],
    hybridKeyword: [],
    hybridAlgolia: [],
    keywordAlgolia: [],
    hybridOnly: [],
    keywordOnly: [],
    algoliaOnly: [],
  }
  const seen = new Set<string>()

  const classify = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    const inH = hSet.has(id)
    const inK = kSet.has(id)
    const inA = aSet.has(id)
    if (inH && inK && inA) out.inAll.push(id)
    else if (inH && inK) out.hybridKeyword.push(id)
    else if (inH && inA) out.hybridAlgolia.push(id)
    else if (inK && inA) out.keywordAlgolia.push(id)
    else if (inH) out.hybridOnly.push(id)
    else if (inK) out.keywordOnly.push(id)
    else if (inA) out.algoliaOnly.push(id)
  }

  for (const id of h) classify(id)
  for (const id of kk) classify(id)
  for (const id of a) classify(id)

  return out
}

/**
 * Per-id provenance map: which of {H, K, A} contains each id within
 * its top-K. Used by the demo route to render "also in" badges on
 * each result row without re-traversing arrays.
 */
export type Source = "H" | "K" | "A"

export function buildProvenanceMap(
  hybrid: readonly string[],
  keyword: readonly string[],
  algolia: readonly string[],
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
  add(algolia, "A")
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
