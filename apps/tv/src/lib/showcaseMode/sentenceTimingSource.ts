/**
 * U3: the injectable seam that resolves a centerpiece slug to derived sentence timing —
 * lean subtitle query (KTD-2) → guarded bounded VTT fetch → parseVtt → U1 derivation →
 * process-lifetime cache (KTD-7). Never throws: every failure maps to a closed reason
 * union so the caller (ShowcaseScreen) logs it and rebuilds on the fixed grid.
 */

import { parseVtt } from "../parseVtt"
import { validateActionUrl } from "../validateUrl"
import { withTimeout } from "../withTimeout"
import { deriveSentenceTiming, type SentenceTiming } from "./sentenceTiming"
import { GET_SHOWCASE_SUBTITLE } from "./showcaseVideoQuery"

/** The English reference track's own language slug — never a bcp47 prefix (en-nai collides). */
const ENGLISH_SLUG = "english"

// Per-op deadlines, both under and summing under the caller's total budget (KTD-5), per
// the outbound-timeout law — so a single stalled op degrades before the total backstop.
const SHOWCASE_VTT_QUERY_DEADLINE_MS = 2000
const SHOWCASE_VTT_FETCH_DEADLINE_MS = 2500

/** KTD-5: the total plan-build budget; a slower acquisition degrades to the fixed grid (AE5). */
export const SHOWCASE_SENTENCE_PLAN_BUDGET_MS = 5000

/**
 * Device-side pragmatic cap: reject a VTT body over ~1.5MB (a real caption track is a few
 * KB). A deliberate deviation from the server streaming byte-cap law — this fetches our
 * own trusted CDN on a client, so buffering then length-checking is acceptable.
 */
const MAX_VTT_TEXT_LENGTH = 1_500_000

/** KTD-7: ~one showcase reel's worth of language centerpieces. */
const CACHE_MAX_ENTRIES = 8

/** Reasons this seam itself can produce; the plan-time union (timeout, no-usable-boundaries) is the caller's. */
export type SentenceTimingFailureReason =
  | "no-subtitle"
  | "fetch-failed"
  | "parse-empty"

export type SentenceTimingResult =
  | { ok: true; timing: SentenceTiming }
  | { ok: false; reason: SentenceTimingFailureReason }

// Type-only reference to the app's Apollo client — erased at runtime, so this module stays
// free of the client's native-adjacent import graph and unit-tests cleanly.
type ShowcaseApolloClient = ReturnType<
  typeof import("../apolloClient").getApolloClient
>

/** Loose shape so the gql.tada result and plain test literals both pick cleanly. */
type PickableSubtitle = {
  readonly vttSrc?: string | null
  readonly primary?: boolean | null
  readonly aiGenerated?: boolean | null
  readonly language?: { readonly slug?: string | null } | null
}

// KTD-2's client pick: lower score wins — primary first, then human over AI-generated.
function subtitleRank(sub: PickableSubtitle): number {
  return (sub.primary ? 0 : 2) + (sub.aiGenerated ? 1 : 0)
}

function pickEnglishVttSrc(
  subtitles: readonly PickableSubtitle[] | null | undefined,
): string | null {
  const english = (subtitles ?? []).filter(
    (sub) => sub.language?.slug === ENGLISH_SLUG && !!sub.vttSrc,
  )
  if (english.length === 0) return null
  // Reduce (not sort) so ties keep the FIRST row — a stable, order-preserving pick.
  let best = english[0]
  for (const sub of english) {
    if (subtitleRank(sub) < subtitleRank(best)) best = sub
  }
  return best.vttSrc ?? null
}

/** KTD-7 bounded insert: evict the oldest key (Map preserves insertion order) at the cap. */
function cacheBounded(
  cache: Map<string, SentenceTiming>,
  key: string,
  value: SentenceTiming,
): void {
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

async function fetchVttText(
  vttSrc: string,
  fetchImpl: typeof fetch,
  deadlineMs: number,
): Promise<string> {
  // AbortController is the hard cap so a stalled CDN can't hold the request open; mirrors
  // SubtitleOverlay's fetch guard.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deadlineMs)
  try {
    const response = await fetchImpl(vttSrc, { signal: controller.signal })
    if (!response.ok) throw new Error(`vtt_http_${response.status}`)
    const text = await response.text()
    if (text.length > MAX_VTT_TEXT_LENGTH) throw new Error("vtt_oversize")
    return text
  } finally {
    clearTimeout(timer)
  }
}

const derivedTimingCache = new Map<string, SentenceTiming>()

/**
 * Bind the acquisition to the Apollo client as an injectable seam, mirroring
 * createShowcaseVideoFetcher. Cache-first so a revisited centerpiece across reel loops
 * never refetches (AE7). `deps` are test seams (injected fetch/cache/deadlines); the
 * defaults are the real global fetch and the process-lifetime cache.
 */
export function createSentenceTimingSource(
  client: ShowcaseApolloClient,
  deps: {
    fetchImpl?: typeof fetch
    cache?: Map<string, SentenceTiming>
    queryDeadlineMs?: number
    fetchDeadlineMs?: number
  } = {},
): (slug: string) => Promise<SentenceTimingResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const cache = deps.cache ?? derivedTimingCache
  const queryDeadlineMs = deps.queryDeadlineMs ?? SHOWCASE_VTT_QUERY_DEADLINE_MS
  const fetchDeadlineMs = deps.fetchDeadlineMs ?? SHOWCASE_VTT_FETCH_DEADLINE_MS

  return async (slug: string): Promise<SentenceTimingResult> => {
    let subtitles: readonly PickableSubtitle[] | null | undefined
    try {
      const result = await withTimeout(
        client.query({
          query: GET_SHOWCASE_SUBTITLE,
          variables: { slug },
          fetchPolicy: "cache-first",
        }),
        queryDeadlineMs,
      )
      subtitles =
        result.data?.videoBySlug?.preferredPlayableDub?.videoEdition?.subtitles
    } catch {
      // A transient query/network error is a fetch failure, not a curator's missing track.
      return { ok: false, reason: "fetch-failed" }
    }

    const vttSrc = pickEnglishVttSrc(subtitles)
    // Validate the CMS-sourced URL before ever fetching it (apps/tv URL law).
    if (!vttSrc || !validateActionUrl(vttSrc)) {
      return { ok: false, reason: "no-subtitle" }
    }

    const cached = cache.get(vttSrc)
    if (cached) return { ok: true, timing: cached }

    let text: string
    try {
      text = await fetchVttText(vttSrc, fetchImpl, fetchDeadlineMs)
    } catch {
      return { ok: false, reason: "fetch-failed" }
    }

    const cues = parseVtt(text)
    if (cues.length === 0) return { ok: false, reason: "parse-empty" }

    const timing = deriveSentenceTiming(cues)
    cacheBounded(cache, vttSrc, timing)
    return { ok: true, timing }
  }
}

/**
 * KTD-5: race the acquisition against the total plan-build budget so the reel never waits
 * longer than the ceiling. An unresolved acquisition yields `timeout` and the caller plays
 * the fixed grid (AE5). Kept out of the screen effect so it is testable without a render
 * harness (`acquire` never throws — U3 maps its own failures to a reason).
 */
export async function resolveSentenceTimingWithinBudget(
  acquire: () => Promise<SentenceTimingResult>,
  budgetMs: number,
): Promise<
  | { timing: SentenceTiming }
  | { timing: null; reason: SentenceTimingFailureReason | "timeout" }
> {
  let result: SentenceTimingResult
  try {
    result = await withTimeout(acquire(), budgetMs)
  } catch {
    return { timing: null, reason: "timeout" }
  }
  return result.ok
    ? { timing: result.timing }
    : { timing: null, reason: result.reason }
}
