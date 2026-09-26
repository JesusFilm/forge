import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"

import client from "@/lib/admin-client"
import { formatDuration } from "@/lib/format-duration"
import {
  asLocaleSlug,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
} from "@/lib/routes"
import { fetchWatchProgressForUser } from "@/lib/watch-progress-server"

const WATCH_HISTORY_VIDEO = adminGraphql(`
  query WatchHistoryVideo($id: ID!, $locale: String!, $languageSlug: String) {
    video(id: $id) {
      documentId: id
      slug
      label
      durationSeconds
      images {
        url
        thumbnail
        mobileCinematicHigh
        mobileCinematicLow
        videoStill
      }
      locales(locale: $locale, languageSlug: $languageSlug) {
        title
        imageAlt
      }
      dubs {
        slug
        published
        hls
        language {
          slug
        }
      }
      parents {
        parent {
          slug
          label
        }
      }
    }
  }
`)

type WatchHistoryVideoData = AdminResultOf<typeof WATCH_HISTORY_VIDEO>
type WatchHistoryVideo = NonNullable<WatchHistoryVideoData["video"]>

export type WatchHistoryItem = {
  videoId: string
  title: string
  label: string
  href: string | null
  imageUrl: string | null
  imageAlt: string
  durationLabel: string | null
  progressPercent: number
  watchedAt: string
}

export type WatchHistoryVideoDetails = Omit<
  WatchHistoryItem,
  "progressPercent" | "watchedAt"
>

export type WatchHistoryVideoRequest = {
  videoId: string
  languageSlug?: string | null
}

const ENGLISH_LANGUAGE_SLUG = asLocaleSlug("english")

const LABEL_TEXT: Record<string, string> = {
  BEHIND_THE_SCENES: "Behind the scenes",
  COLLECTION: "Collection",
  EPISODE: "Episode",
  FEATURE_FILM: "Feature film",
  SEGMENT: "Segment",
  SERIES: "Series",
  SHORT_FILM: "Short film",
  TRAILER: "Trailer",
}

function labelText(video: WatchHistoryVideo): string {
  if (
    video.label === "SEGMENT" &&
    video.parents?.some((relation) => relation.parent?.label === "FEATURE_FILM")
  ) {
    return "Chapter"
  }

  const label = video.label
  return label ? (LABEL_TEXT[label] ?? "Video") : "Video"
}

function bestImage(video: WatchHistoryVideo): string | null {
  const image = video.images?.[0]
  return (
    image?.mobileCinematicHigh ??
    image?.thumbnail ??
    image?.videoStill ??
    image?.mobileCinematicLow ??
    image?.url ??
    null
  )
}

function playableLanguageSlug(video: WatchHistoryVideo) {
  const dub = video.dubs?.find((candidate) => {
    return candidate.published === true && Boolean(candidate.hls)
  })
  return (
    tryAsLocaleSlug(dub?.language?.slug ?? "") ??
    tryAsLocaleSlug(dub?.slug ?? "") ??
    ENGLISH_LANGUAGE_SLUG
  )
}

function historyHref(
  video: WatchHistoryVideo,
  requestedLanguageSlug?: string | null,
): string | null {
  const slug = tryAsContentSlug(video.slug ?? "")
  if (!slug) return null

  const languageSlug =
    tryAsLocaleSlug(requestedLanguageSlug ?? "") ?? playableLanguageSlug(video)
  const parentSlug = tryAsContentSlug(video.parents?.[0]?.parent?.slug ?? "")
  return parentSlug
    ? watchEpisodePath(parentSlug, slug, languageSlug)
    : watchVideoPath(slug, languageSlug)
}

function progressPercent(positionSeconds: number, durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) return 0
  return Math.round(Math.min(1, positionSeconds / durationSeconds) * 100)
}

/**
 * Admin GraphQL requests allowed in flight while resolving watch-history
 * cards. A history can carry the full 200-id cap; firing all of them at once
 * makes an Admin rate-limit rejection or the 15 s client timeout in
 * `admin-client.ts` far likelier than the same work at this width. Bounded
 * parallelism per
 * `docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md`.
 */
export const WATCH_HISTORY_FANOUT_CONCURRENCY = 8

/**
 * Wall-clock ceiling for the WHOLE fan-out, not one request.
 *
 * Bounding concurrency without bounding the total is a regression, not a fix:
 * at width 8 the 200-id cap is 25 sequential rounds, and because per-item
 * failures deliberately no longer short-circuit the batch, a sick Admin would
 * hold a Node worker for up to 25 x the 15 s per-request budget in
 * `admin-client.ts` (~375 s) where the pre-fix `Promise.all` gave up after
 * roughly one. Sized above the healthy 200-id worst case (25 rounds x the
 * sub-500 ms SSR call `admin-client.ts` documents, ~12.5 s) and far below the
 * edge's ~100 s ceiling, so a healthy full history still completes while a
 * degraded one degrades on time. Per
 * `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`.
 */
export const WATCH_HISTORY_FANOUT_BUDGET_MS = 20_000

/**
 * Per-item failure lines emitted before falling back to the summary alone, so
 * a wholly unreachable Admin cannot turn one request into 200 log lines.
 */
const MAX_FANOUT_FAILURE_LOGS = 5

/**
 * `videoId` reaches this module straight from the request body, where
 * `entrySchema` bounds it only to a non-empty string, and submitted entries
 * reach the fan-out whether or not they were persisted. Interpolating one raw
 * into a `key=value` line would let any signed-in caller inject newlines and
 * forge whole log events. Bound the charset and the length at the sink, which
 * also covers ids arriving from the Admin store rather than this request.
 */
function sanitizeLogValue(value: string): string {
  return value.replace(/[^\w.:-]/g, "_").slice(0, 64)
}

/**
 * A sliding-window pool under one shared deadline: each worker takes the next
 * index as soon as it is free, so one slow video cannot stall the rest of its
 * cohort the way a chunked wave would, and no worker claims new work once
 * `signal` aborts. The same signal is handed to each task so in-flight calls
 * are cancelled rather than left running past the deadline. Unclaimed indices
 * stay holes, which the caller's null filter drops — a spent budget costs the
 * cards that did not resolve, never the ones that did.
 */
const DEADLINE_REACHED = Symbol("deadline-reached")

async function mapWithConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  concurrency: number,
  task: (input: TInput, signal: AbortSignal) => Promise<TOutput>,
  signal: AbortSignal,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(inputs.length)
  let nextIndex = 0

  // One listener for the whole pool, not one per item: a per-task listener on
  // a 200-item batch would pile up on the same signal and trip Node's
  // max-listeners warning.
  const deadlineReached = new Promise<typeof DEADLINE_REACHED>((resolve) => {
    if (signal.aborted) {
      resolve(DEADLINE_REACHED)
      return
    }
    signal.addEventListener("abort", () => resolve(DEADLINE_REACHED), {
      once: true,
    })
  })

  async function worker(): Promise<void> {
    while (nextIndex < inputs.length && !signal.aborted) {
      const index = nextIndex
      nextIndex += 1
      // Racing the deadline as well as passing the signal down is deliberate
      // belt-and-braces: the signal asks the upstream to stop, the race
      // guarantees the pool itself settles on time even if some client in the
      // chain ignores it. Losing the race leaves a hole, which the caller's
      // null filter drops.
      const outcome = await Promise.race([
        task(inputs[index] as TInput, signal),
        deadlineReached,
      ])
      if (outcome === DEADLINE_REACHED) return
      results[index] = outcome
    }
  }

  // `Math.max(1, ...)` keeps a degenerate cap from spawning zero workers,
  // which would return an all-holes array the null filter silently empties.
  const workers = Math.max(1, Math.min(concurrency, inputs.length))
  await Promise.all(
    Array.from({ length: inputs.length === 0 ? 0 : workers }, worker),
  )
  return results
}

/**
 * The error's type name only. A rejected Apollo call can carry response body
 * fragments in its message, which must not reach the logs. Exported so the
 * `/api/watch-progress` route logs its own degraded fan-out through the same
 * invariant rather than re-deriving it.
 */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

// Premise this whole module's error handling rests on, verified by hand
// 2026-09-22 against the installed @apollo/client 4.1.9: `errorPolicy`
// defaults to "none" (core/QueryManager.js:439) and the query path throws
// `CombinedGraphQLErrors` whenever the response carries errors, INCLUDING a
// partial-data response (core/QueryManager.js:165-166, :639-642). No test in
// this repo executes that branch — `watch-history.test.ts` mocks this client —
// so re-check it on an Apollo major bump.
async function fetchHistoryVideo(
  videoId: string,
  languageSlug: string | null,
  signal: AbortSignal,
) {
  const result = await client.query({
    query: WATCH_HISTORY_VIDEO,
    variables: {
      id: videoId,
      locale: "en",
      languageSlug: languageSlug ?? "english",
    },
    fetchPolicy: "no-cache",
    // `createTimeoutFetch` in `admin-client.ts` composes this with its own
    // 15 s signal, so a call in flight when the fan-out budget expires is
    // aborted instead of running on against a response nobody will read.
    context: { fetchOptions: { signal } },
  })
  return result.data?.video ?? null
}

export async function fetchWatchHistoryVideoDetails(
  requests: WatchHistoryVideoRequest[],
  // Production never passes this: the module owns the budget so no call site
  // can quietly opt out of it. Tests inject a tiny real signal because
  // `AbortSignal.timeout` cannot be driven by fake timers.
  { signal }: { signal?: AbortSignal } = {},
): Promise<WatchHistoryVideoDetails[]> {
  const uniqueRequests = Array.from(
    new Map(
      requests
        .filter((request) => Boolean(request.videoId))
        .map((request) => [
          request.videoId,
          {
            videoId: request.videoId,
            languageSlug:
              tryAsLocaleSlug(request.languageSlug ?? "") ??
              ENGLISH_LANGUAGE_SLUG,
          },
        ]),
    ).values(),
  ).slice(0, 200)
  const deadline = signal ?? AbortSignal.timeout(WATCH_HISTORY_FANOUT_BUDGET_MS)
  let failed = 0
  let notFound = 0
  const items = await mapWithConcurrency(
    uniqueRequests,
    WATCH_HISTORY_FANOUT_CONCURRENCY,
    // The catch wraps the WHOLE per-item body, not just the fetch: one
    // unwatchable, slow, or rate-limited video — or one video whose shape
    // trips the mapping below — costs its own card and nothing else. Without
    // it a single rejection failed the whole batch, which
    // `POST /api/watch-progress` turned into a 500 and the browser client read
    // as "not signed in" (`watch-progress-client.ts` sets
    // `authState = "anonymous"` on any non-OK response).
    async ({ videoId, languageSlug }, itemSignal) => {
      try {
        const video = await fetchHistoryVideo(videoId, languageSlug, itemSignal)
        if (!video) {
          // Admin answered, and the answer was "no such video" (unpublished,
          // deleted, stale id). Counted apart from `failed` so the summary can
          // tell an operator "Admin dropped these" from "the fan-out broke".
          notFound += 1
          return null
        }

        const title = video.locales?.[0]?.title?.trim() || video.slug || "Video"
        const durationLabel =
          video.durationSeconds != null
            ? formatDuration(video.durationSeconds) || null
            : null

        return {
          videoId,
          title,
          label: labelText(video),
          href: historyHref(video, languageSlug),
          imageUrl: bestImage(video),
          imageAlt: video.locales?.[0]?.imageAlt || title,
          durationLabel,
        }
      } catch (error: unknown) {
        failed += 1
        if (failed <= MAX_FANOUT_FAILURE_LOGS) {
          console.warn(
            `[watch-history] event=history_video_fetch_failure videoId=${sanitizeLogValue(videoId)} reason=${errorName(error)}`,
          )
        }
        return null
      }
    },
    deadline,
  )

  const details = items.filter(
    (item): item is WatchHistoryVideoDetails => item != null,
  )
  const timedOut = deadline.aborted
  if (failed > 0 || notFound > 0 || timedOut) {
    // Plain `event=` string, never JSON.stringify: Railway logsV2 silences
    // stringified payloads from Next.js route handlers. `timedOut` is what
    // separates "Admin is sick" from "this history was too big for the
    // budget" — both degrade, but only one is an incident.
    console.warn(
      `[watch-history] event=history_fanout_degraded requested=${uniqueRequests.length} returned=${details.length} failed=${failed} notFound=${notFound} timedOut=${timedOut}`,
    )
  }
  return details
}

export async function fetchWatchHistoryForUser(
  userId: string,
): Promise<WatchHistoryItem[]> {
  const progress = await fetchWatchProgressForUser(userId)
  const videos = await fetchWatchHistoryVideoDetails(
    progress.map((entry) => ({
      videoId: entry.videoId,
      languageSlug: entry.languageSlug,
    })),
  )
  const videoById = new Map(videos.map((video) => [video.videoId, video]))

  return progress.flatMap((entry) => {
    const video = videoById.get(entry.videoId)
    return video
      ? [
          {
            ...video,
            videoId: entry.videoId,
            durationLabel:
              video.durationLabel ??
              formatDuration(entry.durationSeconds) ??
              null,
            progressPercent: progressPercent(
              entry.positionSeconds,
              entry.durationSeconds,
            ),
            watchedAt: entry.updatedAt,
          },
        ]
      : []
  })
}
