import { TextDecoder } from "node:util"
import { graphql } from "@forge/graphql"
import getClient from "@/cms/client"
import { buildJobArtifactHref } from "@/lib/job-artifacts"
import { resolveCmsLanguageCode } from "@/lib/mux-language"
import { getPlaybackUrl, listMuxSubtitleTracks } from "@/services/mux"
import { readArtifact } from "@/services/storage"
import type { JobRecord } from "@/types/job"
import type {
  JobReviewContextResult,
  ReviewChapter,
  ReviewMetadataDomain,
  ReviewMetadataValue,
  ReviewTextTrack,
} from "./review-player-types"

const GET_VIDEO_REVIEW_SOURCE = graphql(`
  query GetVideoReviewSource($documentId: ID!) {
    video(documentId: $documentId) {
      documentId
      title
      description
      primaryLanguage {
        coreId
        name
        bcp47
        iso3
      }
      subtitles(pagination: { limit: -1 }) {
        aiGenerated
        primary
        vttSrc
        language {
          coreId
          name
          bcp47
          iso3
        }
      }
    }
  }
`)

const TRUSTED_SUBTITLE_HOSTS = new Set(["stream.mux.com"])
const TRUSTED_JESUSFILM_SUBTITLE_HOSTS = ["jesusfilm.org"] as const

type LoadVideoReviewSourceResult = {
  title?: string
  description?: string
  language?: string
  subtitles: ReviewTextTrack[]
}

type LoadJobReviewContextDeps = {
  loadVideoReviewSource?: (
    videoDocumentId: string,
  ) => Promise<LoadVideoReviewSourceResult | null>
  loadMuxSubtitleTracks?: (job: JobRecord) => Promise<ReviewTextTrack[]>
  readArtifactJson?: (assetId: string, artifactKey: string) => Promise<unknown>
  buildArtifactHref?: (jobId: string, artifactKey: string) => string
}

function trimNonBlank(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const strings = value
    .map((entry) => trimNonBlank(entry))
    .filter((entry): entry is string => entry != null)

  return strings.length > 0 ? strings : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function isTrustedSubtitleHost(hostname: string): boolean {
  if (TRUSTED_SUBTITLE_HOSTS.has(hostname)) {
    return true
  }

  return TRUSTED_JESUSFILM_SUBTITLE_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  )
}

function isTrustedSubtitleSrc(src: string): boolean {
  try {
    const url = new URL(src)
    return url.protocol === "https:" && isTrustedSubtitleHost(url.hostname)
  } catch {
    return false
  }
}

function filterTrustedSubtitleTracks(
  tracks: ReviewTextTrack[],
): ReviewTextTrack[] {
  return tracks.filter((track) => isTrustedSubtitleSrc(track.src))
}

async function defaultReadArtifactJson(
  assetId: string,
  artifactKey: string,
): Promise<unknown> {
  const descriptor =
    artifactKey === "chapters" || artifactKey === "metadata"
      ? { artifactType: artifactKey, ext: "json" as const }
      : null
  if (!descriptor) {
    throw new Error(`Unsupported JSON artifact ${artifactKey}`)
  }

  const body = await readArtifact(
    assetId,
    descriptor.artifactType,
    descriptor.ext,
  )
  return JSON.parse(new TextDecoder().decode(body)) as unknown
}

async function defaultLoadVideoReviewSource(
  videoDocumentId: string,
): Promise<LoadVideoReviewSourceResult | null> {
  const client = getClient()
  const result = await client.query({
    query: GET_VIDEO_REVIEW_SOURCE,
    variables: { documentId: videoDocumentId },
    fetchPolicy: "no-cache",
  })

  const video = result.data?.video
  if (!video) {
    return null
  }

  const fallbackLanguageCode = resolveCmsLanguageCode(video.primaryLanguage)
  const subtitles = (video.subtitles ?? [])
    .filter(
      (subtitle): subtitle is NonNullable<typeof subtitle> => subtitle != null,
    )
    .map((subtitle): ReviewTextTrack | null => {
      const src = trimNonBlank(subtitle.vttSrc)
      const languageCode =
        resolveCmsLanguageCode(subtitle.language) ?? fallbackLanguageCode

      if (!src || !languageCode) {
        return null
      }

      return {
        languageCode,
        label:
          trimNonBlank(subtitle.language?.name) ?? languageCode.toUpperCase(),
        src,
        source: "cms" as const,
        isGenerated: Boolean(subtitle.aiGenerated),
      }
    })
    .filter((track): track is NonNullable<typeof track> => track != null)

  return {
    title: trimNonBlank(video.title),
    description: trimNonBlank(video.description),
    language:
      trimNonBlank(video.primaryLanguage?.name) ??
      resolveCmsLanguageCode(video.primaryLanguage) ??
      undefined,
    subtitles,
  }
}

async function defaultLoadMuxSubtitleTracks(
  job: JobRecord,
): Promise<ReviewTextTrack[]> {
  if (!job.muxAssetId) {
    return []
  }

  const tracks = await listMuxSubtitleTracks(job.muxAssetId)
  return tracks.map((track) => ({
    languageCode: track.languageCode,
    label: track.label,
    src: track.src,
    source: "mux" as const,
    isGenerated: false,
  }))
}

function buildGeneratedSubtitleTracks(
  job: JobRecord,
  buildArtifactHref: (jobId: string, artifactKey: string) => string,
): ReviewTextTrack[] {
  const languageSpecificTracks = Object.entries(job.artifacts)
    .filter(
      ([key, value]) =>
        value.kind === "downloadable" && key.startsWith("subtitles-"),
    )
    .map(([key]) => {
      const languageCode = key.slice("subtitles-".length).toLowerCase()

      return {
        languageCode,
        label: languageCode.toUpperCase(),
        src: buildArtifactHref(job.id, key),
        source: "artifact" as const,
        isGenerated: true,
      }
    })

  if (
    languageSpecificTracks.length === 0 &&
    job.artifacts.subtitles?.kind === "downloadable" &&
    job.sourceLanguageCode
  ) {
    return [
      {
        languageCode: job.sourceLanguageCode.toLowerCase(),
        label: job.sourceLanguageCode.toUpperCase(),
        src: buildArtifactHref(job.id, "subtitles"),
        source: "artifact",
        isGenerated: true,
      },
    ]
  }

  return languageSpecificTracks.sort((left, right) =>
    left.languageCode.localeCompare(right.languageCode),
  )
}

function buildMetadataDomain(value: unknown): ReviewMetadataDomain {
  if (!isRecord(value)) {
    return {
      status: "failed",
      message: "Metadata artifact had an unexpected shape",
    }
  }

  const metadata: ReviewMetadataValue = {
    title: trimNonBlank(value.title),
    description: trimNonBlank(value.description),
    tags: readStringArray(value.tags),
    topics: readStringArray(value.topics),
    speakers: readStringArray(value.speakers),
    language: trimNonBlank(value.language),
  }

  if (
    !metadata.title &&
    !metadata.description &&
    !metadata.tags &&
    !metadata.topics &&
    !metadata.speakers &&
    !metadata.language
  ) {
    return {
      status: "unavailable",
      reason: "artifact_empty",
    }
  }

  return {
    status: "available",
    value: metadata,
  }
}

function buildChaptersDomain(value: unknown):
  | {
      status: "available"
      value: {
        chapters: ReviewChapter[]
      }
    }
  | {
      status: "failed"
      message: string
    } {
  if (!isRecord(value) || !Array.isArray(value.chapters)) {
    return {
      status: "failed",
      message: "Chapters artifact had an unexpected shape",
    }
  }

  const chapters = value.chapters
    .filter((chapter): chapter is Record<string, unknown> => isRecord(chapter))
    .map((chapter) => ({
      title: trimNonBlank(chapter.title) ?? "Untitled chapter",
      startSeconds:
        typeof chapter.startSeconds === "number" &&
        Number.isFinite(chapter.startSeconds)
          ? chapter.startSeconds
          : 0,
      endSeconds:
        typeof chapter.endSeconds === "number" &&
        Number.isFinite(chapter.endSeconds)
          ? chapter.endSeconds
          : null,
      summary: trimNonBlank(chapter.summary),
    }))

  return {
    status: "available",
    value: {
      chapters,
    },
  }
}

function mergeTrackLists(
  preferred: ReviewTextTrack[],
  fallback: ReviewTextTrack[],
): ReviewTextTrack[] {
  const ordered = new Map<string, ReviewTextTrack>()

  for (const track of [...preferred, ...fallback]) {
    if (!ordered.has(track.languageCode)) {
      ordered.set(track.languageCode, track)
    }
  }

  return [...ordered.values()].sort((left, right) =>
    left.languageCode.localeCompare(right.languageCode),
  )
}

export async function loadJobReviewContext(
  job: JobRecord,
  deps: LoadJobReviewContextDeps = {},
): Promise<JobReviewContextResult> {
  if (!job.muxPlaybackId) {
    return {
      status: "unsupported",
      message: "No playback source available",
    }
  }

  const buildArtifactHref = deps.buildArtifactHref ?? buildJobArtifactHref
  const readArtifactJson = deps.readArtifactJson ?? defaultReadArtifactJson
  const loadVideoReviewSource =
    deps.loadVideoReviewSource ?? defaultLoadVideoReviewSource
  const loadMuxSubtitleTracks =
    deps.loadMuxSubtitleTracks ?? defaultLoadMuxSubtitleTracks

  let videoSource: LoadVideoReviewSourceResult | null = null
  if (job.videoDocumentId) {
    videoSource = await loadVideoReviewSource(job.videoDocumentId)
  }

  let muxTracks: ReviewTextTrack[] = []
  try {
    muxTracks = await loadMuxSubtitleTracks(job)
  } catch {
    muxTracks = []
  }

  const beforeTracks = mergeTrackLists(
    filterTrustedSubtitleTracks(muxTracks),
    filterTrustedSubtitleTracks(videoSource?.subtitles ?? []),
  )
  const afterTracks = buildGeneratedSubtitleTracks(job, buildArtifactHref)

  let afterMetadata: ReviewMetadataDomain
  if (job.artifacts.metadata?.kind !== "downloadable") {
    afterMetadata = {
      status: "unavailable",
      reason: "artifact_missing",
    }
  } else {
    try {
      afterMetadata = buildMetadataDomain(
        await readArtifactJson(job.muxAssetId, "metadata"),
      )
    } catch (error) {
      afterMetadata = {
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Failed to load metadata artifact",
      }
    }
  }

  let afterChapters:
    | {
        status: "available"
        value: {
          chapters: ReviewChapter[]
        }
      }
    | {
        status: "unavailable"
        reason: string
      }
    | {
        status: "failed"
        message: string
      }

  if (job.artifacts.chapters?.kind !== "downloadable") {
    afterChapters = {
      status: "unavailable",
      reason: "artifact_missing",
    }
  } else {
    try {
      afterChapters = buildChaptersDomain(
        await readArtifactJson(job.muxAssetId, "chapters"),
      )
    } catch (error) {
      afterChapters = {
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Failed to load chapters artifact",
      }
    }
  }

  const hasBeforeMetadata = Boolean(
    videoSource?.title || videoSource?.description || videoSource?.language,
  )

  return {
    status: "ready",
    context: {
      playbackUrl: getPlaybackUrl(job.muxPlaybackId),
      before: {
        subtitles:
          beforeTracks.length > 0
            ? {
                status: "available",
                tracks: beforeTracks,
              }
            : {
                status: "unavailable",
                reason: job.videoDocumentId
                  ? "no_live_subtitles"
                  : "no_video_document_id",
              },
        metadata: hasBeforeMetadata
          ? {
              status: "available",
              value: {
                title: videoSource?.title,
                description: videoSource?.description,
                language: videoSource?.language,
              },
            }
          : {
              status: "unavailable",
              reason: job.videoDocumentId
                ? "no_live_metadata"
                : "no_video_document_id",
            },
        chapters: {
          status: "unavailable",
          reason: "no_live_chapters",
        },
      },
      after: {
        subtitles:
          afterTracks.length > 0
            ? {
                status: "available",
                tracks: afterTracks,
              }
            : {
                status: "unavailable",
                reason: "artifact_missing",
              },
        metadata: afterMetadata,
        chapters: afterChapters,
      },
      compare: {},
    },
  }
}
