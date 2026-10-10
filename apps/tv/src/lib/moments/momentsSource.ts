// Injectable seam that resolves a video slug to its classified moments —
// lean query → defensive parse → classifyMoments → process-lifetime bounded
// cache. Mirrors sentenceTimingSource.ts: never throws, closed failure
// union, per-op deadline under the caller's patience, injectable client so
// jest never touches the Apollo import graph.

import { withTimeout } from "../withTimeout"
import {
  classifyMoments,
  type MomentsClassification,
  type VideoMoment,
} from "./momentsModel"
import { GET_VIDEO_MOMENTS } from "./momentsQuery"

/** One query, bounded: the panel shows a loading row meanwhile, and a slow
 *  admin degrades to the sections that need no fetch (questions, citations). */
export const MOMENTS_QUERY_DEADLINE_MS = 4000

/** A handful of films per app session; the payload is small but not free. */
const CACHE_MAX_ENTRIES = 8

export type MomentsFailureReason = "fetch-failed" | "timeout"

export type MomentsResult =
  | { ok: true; classification: MomentsClassification }
  | { ok: false; reason: MomentsFailureReason }

// Type-only reference to the app's Apollo client — erased at runtime, so this
// module stays free of the client's native-adjacent import graph.
type MomentsApolloClient = ReturnType<
  typeof import("../apolloClient").getApolloClient
>

/** Defensively narrow one server row; malformed rows drop, never throw. */
function parseMomentRow(row: unknown): VideoMoment | null {
  if (typeof row !== "object" || row === null) return null
  const r = row as {
    startSeconds?: unknown
    endSeconds?: unknown
    summary?: unknown
    bibleVerses?: unknown
  }
  return {
    startSeconds: typeof r.startSeconds === "number" ? r.startSeconds : null,
    endSeconds: typeof r.endSeconds === "number" ? r.endSeconds : null,
    summary:
      typeof r.summary === "string" && r.summary.length > 0 ? r.summary : null,
    bibleVerses: Array.isArray(r.bibleVerses)
      ? r.bibleVerses.filter((v): v is string => typeof v === "string")
      : [],
  }
}

export function parseMomentRows(rows: unknown): VideoMoment[] {
  if (!Array.isArray(rows)) return []
  const parsed: VideoMoment[] = []
  for (const row of rows) {
    const moment = parseMomentRow(row)
    if (moment != null) parsed.push(moment)
  }
  return parsed
}

// Insertion-ordered Map as a bounded FIFO cache (the sentenceTimingSource
// pattern). Successes only — a transient failure retries on next open.
const cache = new Map<string, MomentsClassification>()

export function __resetMomentsCacheForTests(): void {
  cache.clear()
}

/**
 * Load and classify the moments for `slug`, best-effort. A cached film
 * answers synchronously; otherwise one bounded query. Failures return a
 * reason — the panel maps them to its sections-that-need-no-fetch fallback,
 * never an error screen.
 */
export async function loadVideoMoments({
  client,
  slug,
  languageSlug,
}: {
  client: MomentsApolloClient
  slug: string
  languageSlug?: string | null
}): Promise<MomentsResult> {
  const key = `${slug}::${languageSlug ?? ""}`
  const cached = cache.get(key)
  if (cached != null) return { ok: true, classification: cached }

  let result: Awaited<ReturnType<MomentsApolloClient["query"]>>
  try {
    result = await withTimeout(
      client.query({
        query: GET_VIDEO_MOMENTS,
        variables: { slug, languageSlug: languageSlug ?? null },
        fetchPolicy: "no-cache",
        errorPolicy: "all",
      }),
      MOMENTS_QUERY_DEADLINE_MS,
    )
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && /timed out/i.test(error.message)
          ? "timeout"
          : "fetch-failed",
    }
  }

  const rows = (
    result.data as
      | { videoBySlug?: { moments?: unknown } | null }
      | null
      | undefined
  )?.videoBySlug?.moments
  const classification = classifyMoments(parseMomentRows(rows))

  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest != null) cache.delete(oldest)
  }
  cache.set(key, classification)
  return { ok: true, classification }
}
