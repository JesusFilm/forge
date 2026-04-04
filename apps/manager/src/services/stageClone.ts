import { createMuxAsset, type MuxAssetInfo } from "@/services/mux"
import {
  resolveMuxSubtitleLanguageCode,
  type CmsLanguageMetadata,
  type MuxGeneratedSubtitleLanguage,
} from "@/lib/mux-language"
import { isTrustedStageCloneSourceUrl } from "@/lib/video-sources"

export type StageCloneDownload = {
  url?: string | null
}

export type StageCloneVariant = {
  language?: CmsLanguageMetadata | null
  muxVideo?: {
    assetId?: string | null
    playbackId?: string | null
  } | null
  downloads?: Array<StageCloneDownload | null> | null
}

export type StageCloneVideo = {
  coreId: string
  variants?: Array<StageCloneVariant | null> | null
}

type StageCloneCandidate = {
  sourceVideoCoreId: string
  sourceLanguage?: CmsLanguageMetadata | null
  sourceMuxAssetId?: string
  sourceMuxPlaybackId?: string
  sourceInputUrl: string
  sourceInputType: "download_mp4"
}

export type StageCloneResult =
  | ({
      status: "ready"
      stageMuxAssetId: string
      stageMuxPlaybackId: string
    } & StageCloneCandidate)
  | {
      status: "unsupported"
      sourceVideoCoreId: string
      sourceMuxAssetId?: string
      reason:
        | "no_variant_with_mux"
        | "no_materializable_source_url"
        | "source_requires_manual_copy"
    }
  | {
      status: "errored"
      sourceVideoCoreId: string
      sourceMuxAssetId?: string
      message: string
    }

export type CreateStageCloneDeps = {
  createAsset?: (options: {
    inputUrl: string
    passthrough?: string
    generateSubtitles?: boolean
    subtitleLanguageCode?: MuxGeneratedSubtitleLanguage
  }) => Promise<MuxAssetInfo>
}

export type CreateStageCloneOptions = {
  preferredSourceLanguageId?: string
}

function isMuxStaticRenditionUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.hostname === "stream.mux.com" &&
      parsed.pathname.toLowerCase().endsWith(".mp4")
    )
  } catch {
    return false
  }
}

function scoreDownloadableMp4Url(url: string): number {
  let score = 0

  if (isMuxStaticRenditionUrl(url)) {
    score += 10
  }

  const renditionMatch = url.match(/\/(\d{3,4})p\.mp4(?:$|\?)/i)
  if (renditionMatch) {
    score += Number(renditionMatch[1]) / 100
  }

  return score
}

function pickBestDownloadableMp4(
  downloads: Array<StageCloneDownload | null> | null | undefined,
): string | null {
  const urls = (downloads ?? [])
    .map((download) => download?.url ?? null)
    .filter(isTrustedStageCloneSourceUrl)

  if (urls.length === 0) {
    return null
  }

  return [...urls].sort(
    (left, right) =>
      scoreDownloadableMp4Url(right) - scoreDownloadableMp4Url(left),
  )[0]
}

function buildStageCloneCandidate(
  video: StageCloneVideo,
  variant: StageCloneVariant,
): StageCloneCandidate | null {
  const sourceInputUrl = pickBestDownloadableMp4(variant.downloads)
  if (!sourceInputUrl) {
    return null
  }

  return {
    sourceVideoCoreId: video.coreId,
    sourceLanguage: variant.language ?? null,
    sourceMuxAssetId: variant.muxVideo?.assetId ?? undefined,
    sourceMuxPlaybackId: variant.muxVideo?.playbackId ?? undefined,
    sourceInputUrl,
    sourceInputType: "download_mp4",
  }
}

export function resolveStageCloneCandidate(
  video: StageCloneVideo,
  preferredSourceLanguageId?: string,
): StageCloneCandidate | null {
  const variants = (video.variants ?? []).filter(
    (variant): variant is StageCloneVariant => variant != null,
  )
  if (variants.length === 0) {
    return null
  }

  const preferred = preferredSourceLanguageId?.trim().toLowerCase()
  const orderedVariants = preferred
    ? [...variants].sort((left, right) => {
        const leftPreferred =
          left.language?.coreId?.trim().toLowerCase() === preferred ? 1 : 0
        const rightPreferred =
          right.language?.coreId?.trim().toLowerCase() === preferred ? 1 : 0
        return rightPreferred - leftPreferred
      })
    : variants

  for (const variant of orderedVariants) {
    const candidate = buildStageCloneCandidate(video, variant)
    if (candidate) {
      return candidate
    }
  }

  return null
}

export async function createStageCloneForJob(
  video: StageCloneVideo,
  options: CreateStageCloneOptions = {},
  deps: CreateStageCloneDeps = {},
): Promise<StageCloneResult> {
  const variants = (video.variants ?? []).filter(
    (variant): variant is StageCloneVariant => variant != null,
  )

  const candidate = resolveStageCloneCandidate(
    video,
    options.preferredSourceLanguageId,
  )
  if (!candidate) {
    const firstMuxAssetId =
      variants.find((variant) => variant.muxVideo?.assetId)?.muxVideo
        ?.assetId ?? undefined

    return {
      status: "unsupported",
      sourceVideoCoreId: video.coreId,
      sourceMuxAssetId: firstMuxAssetId,
      reason: firstMuxAssetId
        ? "no_materializable_source_url"
        : "no_variant_with_mux",
    }
  }

  const createAsset = deps.createAsset ?? createMuxAsset
  const subtitleLanguageCode = candidate.sourceLanguage
    ? resolveMuxSubtitleLanguageCode(candidate.sourceLanguage)
    : "auto"

  try {
    const stageAsset = await createAsset({
      inputUrl: candidate.sourceInputUrl,
      passthrough: `snapshot-stage-clone:${video.coreId}`,
      generateSubtitles: true,
      subtitleLanguageCode,
    })

    return {
      status: "ready",
      ...candidate,
      stageMuxAssetId: stageAsset.assetId,
      stageMuxPlaybackId: stageAsset.playbackId,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create stage clone"

    return {
      status: "errored",
      sourceVideoCoreId: video.coreId,
      sourceMuxAssetId: candidate.sourceMuxAssetId,
      message,
    }
  }
}
