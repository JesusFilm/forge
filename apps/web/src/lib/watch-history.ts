import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"
import { resolveVideoDisplayTitle } from "@forge/content-display"

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

const watchHistoryVideoFragment = adminGraphql(`
  fragment WatchHistoryVideoFields on Video @_unmask {
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
      locales(languageSlug: $languageSlug) {
        title
        imageAlt
      }
      englishTitleLocales: locales(locale: "en") {
        title
      }
      englishLanguageTitleLocales: locales(languageSlug: "english") {
        title
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
`)

const WATCH_HISTORY_VIDEOS = adminGraphql(
  `
    query WatchHistoryVideos($ids: [ID!]!, $languageSlug: String) {
      watchVideosByIds(ids: $ids) {
        ...WatchHistoryVideoFields
      }
    }
  `,
  [watchHistoryVideoFragment],
)

const WATCH_HISTORY_VIDEO = adminGraphql(
  `
    query WatchHistoryVideo($id: ID!, $languageSlug: String) {
      video(id: $id) {
        ...WatchHistoryVideoFields
      }
    }
  `,
  [watchHistoryVideoFragment],
)

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

async function fetchHistoryVideo(videoId: string, languageSlug: string | null) {
  const result = await client.query({
    query: WATCH_HISTORY_VIDEO,
    variables: {
      id: videoId,
      languageSlug: languageSlug ?? "english",
    },
    fetchPolicy: "no-cache",
  })
  return result.data?.video ?? null
}

async function fetchHistoryVideos(
  videoIds: string[],
  languageSlug: string | null,
): Promise<WatchHistoryVideo[]> {
  try {
    const result = await client.query({
      query: WATCH_HISTORY_VIDEOS,
      variables: {
        ids: videoIds,
        languageSlug: languageSlug ?? "english",
      },
      fetchPolicy: "no-cache",
    })
    if (result.error) throw result.error
    return result.data?.watchVideosByIds ?? []
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
          ? error.message
          : ""
    if (!message.includes('Cannot query field "watchVideosByIds"')) {
      throw error
    }
    const videos = await Promise.all(
      videoIds.map((videoId) => fetchHistoryVideo(videoId, languageSlug)),
    )
    return videos.filter((video): video is WatchHistoryVideo => video != null)
  }
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
  const requestsByLanguage = new Map<string, string[]>()
  for (const request of uniqueRequests) {
    requestsByLanguage.set(request.languageSlug, [
      ...(requestsByLanguage.get(request.languageSlug) ?? []),
      request.videoId,
    ])
  }
  const videoById = new Map<string, WatchHistoryVideo>()
  await Promise.all(
    Array.from(requestsByLanguage.entries()).map(
      async ([languageSlug, videoIds]) => {
        const videos = await fetchHistoryVideos(videoIds, languageSlug)
        for (const video of videos) {
          if (video.documentId) videoById.set(video.documentId, video)
        }
      },
    ),
  )

  const items = uniqueRequests.map(({ videoId, languageSlug }) => {
    const video = videoById.get(videoId)
    if (!video) return null

    const title =
      resolveVideoDisplayTitle({
        requestedTitles: video.locales?.map((locale) => locale.title),
        englishTitles: [
          ...(video.englishTitleLocales?.map((row) => row.title) ?? []),
          ...(video.englishLanguageTitleLocales?.map((row) => row.title) ?? []),
        ],
        slug: video.slug,
      }) ?? "Video"
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
  })

  return items.filter((item): item is WatchHistoryVideoDetails => item != null)
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
