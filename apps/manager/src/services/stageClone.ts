import {
  createMuxAsset,
  getMuxAsset,
  getMuxStaticRenditionSourceUrl,
  type MuxAssetInfo,
} from "@/services/mux"
import {
  buildMuxSourceLanguagePriority,
  type SupportedMuxGeneratedSubtitleLanguage,
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

export type EnrichmentMaterializationMode =
  | "snapshot_to_stage_clone"
  | "direct_mux_asset_reuse"

export type EnrichmentSource = {
  sourceVideoCoreId: string
  sourceLanguage?: CmsLanguageMetadata | null
  sourceLanguageCode: SupportedMuxGeneratedSubtitleLanguage
  sourceMuxAssetId?: string
  sourceMuxPlaybackId?: string
  sourceInputUrl?: string
  sourceInputType: "download_mp4" | "mux_asset"
  sourceSelectionReason:
    | "requested"
    | "fallback-en"
    | "fallback-es"
    | "fallback-fr"
    | "fallback-supported"
  sourceSelectionAttemptedCodes: SupportedMuxGeneratedSubtitleLanguage[]
}

export type MaterializeEnrichmentTargetResult =
  | ({
      status: "ready"
      materializationMode: EnrichmentMaterializationMode
      targetMuxAssetId: string
      targetMuxPlaybackId: string
    } & EnrichmentSource)
  | {
      status: "unsupported"
      sourceVideoCoreId: string
      sourceMuxAssetId?: string
      reason:
        | "no_variant_with_mux"
        | "no_materializable_source_url"
        | "no_mux_supported_downloadable_source"
        | "source_requires_manual_copy"
        | "no_reusable_mux_asset"
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
  getAsset?: (assetId: string) => Promise<MuxAssetInfo>
}

export type CreateStageCloneOptions = {
  preferredSourceLanguageIds?: string[]
  sourceLanguagePriorityCodes?: SupportedMuxGeneratedSubtitleLanguage[]
  requestedTargetLanguageCode?: string
  materializationTarget?: "clone" | "direct"
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
  sourceLanguageCode: SupportedMuxGeneratedSubtitleLanguage,
  sourceSelectionReason: EnrichmentSource["sourceSelectionReason"],
  sourceSelectionAttemptedCodes: SupportedMuxGeneratedSubtitleLanguage[],
): EnrichmentSource | null {
  const sourceInputUrl = pickBestDownloadableMp4(variant.downloads)
  if (!sourceInputUrl) {
    return null
  }

  return {
    sourceVideoCoreId: video.coreId,
    sourceLanguage: variant.language ?? null,
    sourceLanguageCode,
    sourceMuxAssetId: variant.muxVideo?.assetId ?? undefined,
    sourceMuxPlaybackId: variant.muxVideo?.playbackId ?? undefined,
    sourceInputUrl,
    sourceInputType: "download_mp4",
    sourceSelectionReason,
    sourceSelectionAttemptedCodes,
  }
}

function buildDirectReuseCandidate(
  video: StageCloneVideo,
  variant: StageCloneVariant,
  sourceLanguageCode: SupportedMuxGeneratedSubtitleLanguage,
  sourceSelectionReason: EnrichmentSource["sourceSelectionReason"],
  sourceSelectionAttemptedCodes: SupportedMuxGeneratedSubtitleLanguage[],
): EnrichmentSource | null {
  const sourceMuxAssetId = variant.muxVideo?.assetId ?? undefined
  const sourceMuxPlaybackId = variant.muxVideo?.playbackId ?? undefined

  if (!sourceMuxAssetId) {
    return null
  }

  return {
    sourceVideoCoreId: video.coreId,
    sourceLanguage: variant.language ?? null,
    sourceLanguageCode,
    sourceMuxAssetId,
    sourceMuxPlaybackId,
    sourceInputType: "mux_asset",
    sourceSelectionReason,
    sourceSelectionAttemptedCodes,
  }
}

function resolveSourceSelectionReason(
  chosenLanguageCode: SupportedMuxGeneratedSubtitleLanguage,
  requestedTargetLanguageCode?: string,
): EnrichmentSource["sourceSelectionReason"] {
  if (requestedTargetLanguageCode === chosenLanguageCode) {
    return "requested"
  }

  if (chosenLanguageCode === "en") {
    return "fallback-en"
  }

  if (chosenLanguageCode === "es") {
    return "fallback-es"
  }

  if (chosenLanguageCode === "fr") {
    return "fallback-fr"
  }

  return "fallback-supported"
}

export function resolveEnrichmentSource(
  video: StageCloneVideo,
  options: CreateStageCloneOptions = {},
): EnrichmentSource | null {
  const variants = (video.variants ?? []).filter(
    (variant): variant is StageCloneVariant => variant != null,
  )
  if (variants.length === 0) {
    return null
  }

  const sourceLanguagePriorityCodes =
    options.sourceLanguagePriorityCodes &&
    options.sourceLanguagePriorityCodes.length > 0
      ? options.sourceLanguagePriorityCodes
      : buildMuxSourceLanguagePriority(options.requestedTargetLanguageCode)
  const materializationTarget = options.materializationTarget ?? "clone"

  for (const languageCode of sourceLanguagePriorityCodes) {
    const sameLanguageVariants = variants.filter(
      (variant) =>
        resolveMuxSubtitleLanguageCode(variant.language) === languageCode,
    )

    const sourceSelectionReason = resolveSourceSelectionReason(
      languageCode,
      options.requestedTargetLanguageCode,
    )

    const candidates = sameLanguageVariants
      .map((variant) =>
        materializationTarget === "clone"
          ? buildStageCloneCandidate(
              video,
              variant,
              languageCode,
              sourceSelectionReason,
              sourceLanguagePriorityCodes,
            )
          : buildDirectReuseCandidate(
              video,
              variant,
              languageCode,
              sourceSelectionReason,
              sourceLanguagePriorityCodes,
            ),
      )
      .filter((candidate): candidate is EnrichmentSource => candidate != null)
      .sort((left, right) => {
        if (materializationTarget !== "clone") {
          return 0
        }

        return (
          scoreDownloadableMp4Url(right.sourceInputUrl ?? "") -
          scoreDownloadableMp4Url(left.sourceInputUrl ?? "")
        )
      })

    if (candidates[0]) {
      return candidates[0]
    }
  }

  return null
}

export function resolveStageCloneCandidate(
  video: StageCloneVideo,
  options: CreateStageCloneOptions = {},
): EnrichmentSource | null {
  return resolveEnrichmentSource(video, {
    ...options,
    materializationTarget: "clone",
  })
}

export async function materializeEnrichmentTargetForJob(
  video: StageCloneVideo,
  options: CreateStageCloneOptions = {},
  deps: CreateStageCloneDeps = {},
): Promise<MaterializeEnrichmentTargetResult> {
  const variants = (video.variants ?? []).filter(
    (variant): variant is StageCloneVariant => variant != null,
  )
  const materializationTarget = options.materializationTarget ?? "clone"
  const candidate = resolveEnrichmentSource(video, options)

  if (!candidate) {
    const firstMuxAssetId =
      variants.find((variant) => variant.muxVideo?.assetId)?.muxVideo
        ?.assetId ?? undefined

    return {
      status: "unsupported",
      sourceVideoCoreId: video.coreId,
      sourceMuxAssetId: firstMuxAssetId,
      reason:
        materializationTarget === "direct"
          ? firstMuxAssetId
            ? "no_reusable_mux_asset"
            : "no_variant_with_mux"
          : firstMuxAssetId
            ? "no_mux_supported_downloadable_source"
            : "no_variant_with_mux",
    }
  }

  if (materializationTarget === "direct") {
    const getAsset = deps.getAsset ?? getMuxAsset

    try {
      let liveAsset: MuxAssetInfo | null = null
      try {
        liveAsset = await getAsset(candidate.sourceMuxAssetId!)
      } catch (error) {
        if (!candidate.sourceMuxPlaybackId) {
          throw error
        }
      }

      const resolvedPlaybackId =
        candidate.sourceMuxPlaybackId ?? liveAsset?.playbackId

      if (!resolvedPlaybackId) {
        throw new Error(
          `Mux asset ${candidate.sourceMuxAssetId} has no playback ID`,
        )
      }

      const sourceInputUrl = liveAsset
        ? (getMuxStaticRenditionSourceUrl(liveAsset) ?? undefined)
        : undefined

      return {
        status: "ready",
        ...candidate,
        sourceMuxPlaybackId: resolvedPlaybackId,
        ...(sourceInputUrl ? { sourceInputUrl } : {}),
        materializationMode: "direct_mux_asset_reuse",
        targetMuxAssetId: candidate.sourceMuxAssetId!,
        targetMuxPlaybackId: resolvedPlaybackId,
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to resolve reusable Mux asset"

      return {
        status: "errored",
        sourceVideoCoreId: video.coreId,
        sourceMuxAssetId: candidate.sourceMuxAssetId,
        message,
      }
    }
  }

  const createAsset = deps.createAsset ?? createMuxAsset

  try {
    const stageAsset = await createAsset({
      inputUrl: candidate.sourceInputUrl!,
      passthrough: `snapshot-stage-clone:${video.coreId}`,
    })

    return {
      status: "ready",
      ...candidate,
      materializationMode: "snapshot_to_stage_clone",
      targetMuxAssetId: stageAsset.assetId,
      targetMuxPlaybackId: stageAsset.playbackId,
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

export async function createStageCloneForJob(
  video: StageCloneVideo,
  options: CreateStageCloneOptions = {},
  deps: CreateStageCloneDeps = {},
): Promise<MaterializeEnrichmentTargetResult> {
  return materializeEnrichmentTargetForJob(
    video,
    {
      ...options,
      materializationTarget: "clone",
    },
    deps,
  )
}
