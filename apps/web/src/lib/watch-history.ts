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
 * Per-item failure lines emitted before falling back to the summary alone, so
 * a wholly unreachable Admin cannot turn one request into 200 log lines.
 */
const MAX_FANOUT_FAILURE_LOGS = 5

/**
 * A sliding-window pool: each worker takes the next index as soon as it is
 * free, so one slow video cannot stall the rest of its cohort the way a
 * chunked wave would. Results are written back by index, preserving input
 * order.
 */
async function mapWithConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  concurrency: number,
  task: (input: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(inputs.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await task(inputs[index] as TInput)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, worker),
  )
  return results
}

/**
 * The error's type name only. A rejected Apollo call can carry response body
 * fragments in its message, which must not reach the logs.
 */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

async function fetchHistoryVideo(videoId: string, languageSlug: string | null) {
  const result = await client.query({
    query: WATCH_HISTORY_VIDEO,
    variables: {
      id: videoId,
      locale: "en",
      languageSlug: languageSlug ?? "english",
    },
    fetchPolicy: "no-cache",
  })
  return result.data?.video ?? null
}

export async function fetchWatchHistoryVideoDetails(
  requests: WatchHistoryVideoRequest[],
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
  let failed = 0
  const items = await mapWithConcurrency(
    uniqueRequests,
    WATCH_HISTORY_FANOUT_CONCURRENCY,
    async ({ videoId, languageSlug }) => {
      // One unwatchable, slow, or rate-limited video costs its own card and
      // nothing else. Without this catch a single rejection failed the whole
      // batch, which `POST /api/watch-progress` turned into a 500 and the
      // browser client read as "not signed in" — `watch-progress-client.ts`
      // sets `authState = "anonymous"` on any non-OK response.
      const video = await fetchHistoryVideo(videoId, languageSlug).catch(
        (error: unknown) => {
          failed += 1
          if (failed <= MAX_FANOUT_FAILURE_LOGS) {
            console.warn(
              `[watch-history] event=history_video_fetch_failure videoId=${videoId} reason=${errorName(error)}`,
            )
          }
          return null
        },
      )
      if (!video) return null

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
    },
  )

  const details = items.filter(
    (item): item is WatchHistoryVideoDetails => item != null,
  )
  if (failed > 0) {
    // Plain `event=` string, never JSON.stringify: Railway logsV2 silences
    // stringified payloads from Next.js route handlers.
    console.warn(
      `[watch-history] event=history_fanout_degraded requested=${uniqueRequests.length} returned=${details.length} failed=${failed}`,
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
