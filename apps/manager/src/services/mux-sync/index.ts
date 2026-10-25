import { env } from "@/config/env"
import { buildMuxArtifactAccessUrl } from "@/lib/mux-artifact-access"
import type {
  MuxSyncComparison,
  MuxSyncOverrideAuditEntry,
  MuxSyncReport,
} from "@/types/job"
import type { LanguageResult } from "@/services/mastra-subtitle-enrichment"
import { readArtifact } from "@/services/storage"

type MuxTrackInfo = {
  id?: string | null
  type?: "video" | "audio" | "text" | null
  text_type?: "subtitles" | "captions" | null
  language_code?: string | null
  status?: "preparing" | "ready" | "errored" | "deleted" | null
  name?: string | null
  url?: string | null
}

type MuxAssetPayload = {
  tracks?: MuxTrackInfo[] | null
}

export type MuxSubtitleTrack = {
  id: string
  languageCode: string
  status: "preparing" | "ready" | "errored" | "deleted" | "unknown"
  name?: string
  url?: string
}

type SyncSubtitlesToMuxDeps = {
  retrieveAsset?: (assetId: string) => Promise<MuxAssetPayload>
  createTrack?: (
    assetId: string,
    input: { languageCode: string; url: string; name: string },
  ) => Promise<{ id?: string | null }>
  updateTrack?: (
    assetId: string,
    trackId: string,
    input: { languageCode: string; name: string },
  ) => Promise<void>
  deleteTrack?: (assetId: string, trackId: string) => Promise<void>
  readArtifactText?: (assetId: string, artifactKey: string) => Promise<string>
  readTrackText?: (trackUrl: string) => Promise<string>
  buildArtifactUrl?: (input: { jobId: string; artifactKey: string }) => string
  now?: () => string
}

function normalizeLanguageCode(language: string): string {
  return (
    language.trim().toLowerCase().split(/[-_]/)[0] ??
    language.trim().toLowerCase()
  )
}

function isSubtitleTrack(
  track: MuxTrackInfo,
): track is MuxTrackInfo & { id: string } {
  return (
    track.type === "text" &&
    track.text_type === "subtitles" &&
    Boolean(track.id)
  )
}

function normalizeTrack(
  track: MuxTrackInfo & { id: string },
): MuxSubtitleTrack | null {
  const languageCode =
    typeof track.language_code === "string"
      ? normalizeLanguageCode(track.language_code)
      : null
  if (!languageCode) {
    return null
  }

  return {
    id: track.id,
    languageCode,
    status:
      track.status === "preparing" ||
      track.status === "ready" ||
      track.status === "errored" ||
      track.status === "deleted"
        ? track.status
        : "unknown",
    name: typeof track.name === "string" ? track.name : undefined,
    url: typeof track.url === "string" ? track.url : undefined,
  }
}

function getSubtitleTracks(asset: MuxAssetPayload): MuxSubtitleTrack[] {
  return (asset.tracks ?? [])
    .filter(isSubtitleTrack)
    .map(normalizeTrack)
    .filter((track): track is MuxSubtitleTrack => track != null)
}

function findSubtitleTrackByLanguage(
  tracks: MuxSubtitleTrack[],
  targetLanguage: string,
): MuxSubtitleTrack | undefined {
  const normalizedLanguage = normalizeLanguageCode(targetLanguage)
  return tracks.find((track) => track.languageCode === normalizedLanguage)
}

function findSubtitleTrackById(
  tracks: MuxSubtitleTrack[],
  trackId?: string,
): MuxSubtitleTrack | undefined {
  if (!trackId) {
    return undefined
  }

  return tracks.find((track) => track.id === trackId)
}

function findSubtitleTrackByName(
  tracks: MuxSubtitleTrack[],
  name: string,
): MuxSubtitleTrack | undefined {
  return tracks.find((track) => track.name === name)
}

function buildPreview(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        line !== "WEBVTT" &&
        !line.includes("-->") &&
        !/^\d+$/.test(line),
    )
    .join(" ")
    .slice(0, 280)
}

function buildTrackName(languageCode: string): string {
  return `${languageCode.toUpperCase()} subtitles`
}

function buildPendingOverrideTrackName(
  languageCode: string,
  jobId: string,
): string {
  return `${buildTrackName(languageCode)} (override ${jobId.slice(0, 8)})`
}

function buildExplanationForExistingTrack(targetLanguage: string): string {
  return `Mux already has ${targetLanguage} subtitles`
}

async function defaultReadArtifactText(
  assetId: string,
  artifactKey: string,
): Promise<string> {
  const body = await readArtifact(assetId, artifactKey, "vtt")
  return new TextDecoder().decode(body)
}

async function defaultReadTrackText(trackUrl: string): Promise<string> {
  const response = await fetch(trackUrl, {
    method: "GET",
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Mux subtitle track preview (${response.status})`,
    )
  }

  return response.text()
}

function getMuxAuthHeader(): string {
  return `Basic ${Buffer.from(`${env.MUX_TOKEN_ID}:${env.MUX_TOKEN_SECRET}`).toString("base64")}`
}

async function muxApiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.mux.com${path}`, {
    ...init,
    headers: {
      Authorization: getMuxAuthHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Mux API request failed (${response.status})`)
  }

  return (await response.json()) as T
}

async function defaultRetrieveAsset(assetId: string): Promise<MuxAssetPayload> {
  const response = await muxApiRequest<{ data?: MuxAssetPayload }>(
    `/video/v1/assets/${encodeURIComponent(assetId)}`,
    { method: "GET" },
  )

  return response.data ?? {}
}

async function defaultCreateTrack(
  assetId: string,
  input: { languageCode: string; url: string; name: string },
): Promise<{ id?: string | null }> {
  const response = await muxApiRequest<{ data?: { id?: string | null } }>(
    `/video/v1/assets/${encodeURIComponent(assetId)}/tracks`,
    {
      method: "POST",
      body: JSON.stringify({
        url: input.url,
        type: "text",
        text_type: "subtitles",
        language_code: input.languageCode,
        name: input.name,
      }),
    },
  )

  return response.data ?? {}
}

async function defaultDeleteTrack(
  assetId: string,
  trackId: string,
): Promise<void> {
  await muxApiRequest(
    `/video/v1/assets/${encodeURIComponent(assetId)}/tracks/${encodeURIComponent(trackId)}`,
    {
      method: "DELETE",
    },
  )
}

async function defaultUpdateTrack(
  assetId: string,
  trackId: string,
  input: { languageCode: string; name: string },
): Promise<void> {
  await muxApiRequest(
    `/video/v1/assets/${encodeURIComponent(assetId)}/tracks/${encodeURIComponent(trackId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        language_code: input.languageCode,
        name: input.name,
      }),
    },
  )
}

function createFailedComparison(input: {
  artifactKey: string
  targetLanguage: string
  explanation: string
  generatedPreview?: string
  muxPreview?: string
  muxTrackId?: string
  canOverride?: boolean
  now: string
}): MuxSyncComparison {
  return {
    artifactKey: input.artifactKey,
    targetLanguage: input.targetLanguage,
    muxTargetType: "text_track",
    muxTargetKey: input.targetLanguage,
    status: "failed",
    explanation: input.explanation,
    generatedPreview: input.generatedPreview,
    muxPreview: input.muxPreview,
    muxTrackId: input.muxTrackId,
    canOverride: input.canOverride,
    updatedAt: input.now,
  }
}

export async function syncTranslatedSubtitlesToMux(
  input: {
    jobId: string
    assetId: string
    muxAssetId: string
    translationResults: LanguageResult[]
    previousReport?: MuxSyncReport
  },
  deps: SyncSubtitlesToMuxDeps = {},
): Promise<MuxSyncReport> {
  const retrieveAsset = deps.retrieveAsset ?? defaultRetrieveAsset
  const createTrack = deps.createTrack ?? defaultCreateTrack
  const readArtifactText = deps.readArtifactText ?? defaultReadArtifactText
  const readTrackText = deps.readTrackText ?? defaultReadTrackText
  const buildArtifactUrl =
    deps.buildArtifactUrl ??
    ((params: { jobId: string; artifactKey: string }) =>
      buildMuxArtifactAccessUrl(params))
  const now = deps.now?.() ?? new Date().toISOString()

  const asset = await retrieveAsset(input.muxAssetId)
  const tracks = getSubtitleTracks(asset)
  const comparisons: MuxSyncComparison[] = []

  for (const result of input.translationResults) {
    const artifactKey = `subtitles-${result.lang}`
    const targetLanguage = normalizeLanguageCode(result.lang)

    if (result.status !== "completed") {
      comparisons.push({
        artifactKey,
        targetLanguage,
        muxTargetType: "text_track",
        muxTargetKey: targetLanguage,
        status: "skipped_missing_generated_data",
        explanation:
          result.error != null
            ? `Generated subtitle artifact is unavailable: ${result.error}`
            : "Generated subtitle artifact is unavailable",
        updatedAt: now,
      })
      continue
    }

    let generatedText: string
    try {
      generatedText = await readArtifactText(input.assetId, artifactKey)
    } catch {
      comparisons.push({
        artifactKey,
        targetLanguage,
        muxTargetType: "text_track",
        muxTargetKey: targetLanguage,
        status: "skipped_missing_generated_data",
        explanation: "Generated subtitle artifact is unavailable",
        updatedAt: now,
      })
      continue
    }

    const generatedPreview = buildPreview(generatedText)
    const existingTrack = findSubtitleTrackByLanguage(tracks, targetLanguage)

    if (existingTrack) {
      let muxPreview: string | undefined
      if (existingTrack.url) {
        try {
          muxPreview = buildPreview(await readTrackText(existingTrack.url))
        } catch {
          muxPreview = undefined
        }
      }

      comparisons.push({
        artifactKey,
        targetLanguage,
        muxTargetType: "text_track",
        muxTargetKey: targetLanguage,
        status: "skipped_existing_mux_data",
        explanation: buildExplanationForExistingTrack(targetLanguage),
        generatedPreview,
        muxPreview,
        muxTrackId: existingTrack.id,
        canOverride: existingTrack.status !== "deleted",
        updatedAt: now,
      })
      continue
    }

    try {
      const createdTrack = await createTrack(input.muxAssetId, {
        languageCode: targetLanguage,
        url: buildArtifactUrl({
          jobId: input.jobId,
          artifactKey,
        }),
        name: buildTrackName(targetLanguage),
      })

      comparisons.push({
        artifactKey,
        targetLanguage,
        muxTargetType: "text_track",
        muxTargetKey: targetLanguage,
        status: "synced",
        explanation: `Synced ${targetLanguage} subtitles to Mux`,
        generatedPreview,
        muxTrackId:
          typeof createdTrack.id === "string" ? createdTrack.id : undefined,
        updatedAt: now,
      })
    } catch (error) {
      comparisons.push(
        createFailedComparison({
          artifactKey,
          targetLanguage,
          explanation:
            error instanceof Error
              ? error.message
              : "Failed to sync subtitle track to Mux",
          generatedPreview,
          now,
        }),
      )
    }
  }

  return {
    comparisons,
    overrideHistory: input.previousReport?.overrideHistory ?? [],
    updatedAt: now,
  }
}

export async function applySubtitleOverride(
  input: {
    jobId: string
    assetId: string
    muxAssetId: string
    artifactKey: string
    targetLanguage: string
    previousReport?: MuxSyncReport
  },
  deps: SyncSubtitlesToMuxDeps = {},
): Promise<MuxSyncReport> {
  const retrieveAsset = deps.retrieveAsset ?? defaultRetrieveAsset
  const createTrack = deps.createTrack ?? defaultCreateTrack
  const updateTrack = deps.updateTrack ?? defaultUpdateTrack
  const deleteTrack = deps.deleteTrack ?? defaultDeleteTrack
  const readArtifactText = deps.readArtifactText ?? defaultReadArtifactText
  const readTrackText = deps.readTrackText ?? defaultReadTrackText
  const buildArtifactUrl =
    deps.buildArtifactUrl ??
    ((params: { jobId: string; artifactKey: string }) =>
      buildMuxArtifactAccessUrl(params))
  const now = deps.now?.() ?? new Date().toISOString()

  const targetLanguage = normalizeLanguageCode(input.targetLanguage)
  const canonicalTrackName = buildTrackName(targetLanguage)
  const pendingTrackName = buildPendingOverrideTrackName(
    targetLanguage,
    input.jobId,
  )
  const generatedText = await readArtifactText(input.assetId, input.artifactKey)
  const generatedPreview = buildPreview(generatedText)
  const previousComparison = input.previousReport?.comparisons.find(
    (comparison) =>
      comparison.artifactKey === input.artifactKey &&
      comparison.targetLanguage === targetLanguage,
  )

  const asset = await retrieveAsset(input.muxAssetId)
  const tracks = getSubtitleTracks(asset).filter(
    (track) => track.languageCode === targetLanguage,
  )
  const existingTrack =
    previousComparison?.muxTrackId != null
      ? findSubtitleTrackById(tracks, previousComparison.muxTrackId)
      : findSubtitleTrackByLanguage(tracks, targetLanguage)
  const pendingReplacementTrack = findSubtitleTrackByName(
    tracks,
    pendingTrackName,
  )
  const canonicalReplacementTrack = tracks.find(
    (track) =>
      track.id !== existingTrack?.id && track.name === canonicalTrackName,
  )
  let replacementTrack =
    pendingReplacementTrack ?? canonicalReplacementTrack ?? undefined

  let muxPreview: string | undefined
  if (existingTrack?.url) {
    try {
      muxPreview = buildPreview(await readTrackText(existingTrack.url))
    } catch {
      muxPreview = undefined
    }
  }
  if (!muxPreview) {
    muxPreview = previousComparison?.muxPreview
  }

  if (!replacementTrack) {
    const replacementName =
      existingTrack != null ? pendingTrackName : canonicalTrackName
    const createdTrack = await createTrack(input.muxAssetId, {
      languageCode: targetLanguage,
      url: buildArtifactUrl({
        jobId: input.jobId,
        artifactKey: input.artifactKey,
      }),
      name: replacementName,
    })
    replacementTrack = {
      id:
        typeof createdTrack.id === "string" ? createdTrack.id : "pending-track",
      languageCode: targetLanguage,
      status: "unknown",
      name: replacementName,
    }
  }

  if (existingTrack && existingTrack.id !== replacementTrack.id) {
    await deleteTrack(input.muxAssetId, existingTrack.id)
  }

  if (replacementTrack.name !== canonicalTrackName) {
    if (!replacementTrack.id || replacementTrack.id === "pending-track") {
      throw new Error(
        `Mux replacement subtitle track is missing an id for ${targetLanguage}`,
      )
    }

    await updateTrack(input.muxAssetId, replacementTrack.id, {
      languageCode: targetLanguage,
      name: canonicalTrackName,
    })
  }

  const nextComparison: MuxSyncComparison = {
    artifactKey: input.artifactKey,
    targetLanguage,
    muxTargetType: "text_track",
    muxTargetKey: targetLanguage,
    status: "override_applied",
    explanation: `Replaced existing ${targetLanguage} subtitles on Mux`,
    generatedPreview,
    muxPreview,
    muxTrackId: replacementTrack.id,
    canOverride: true,
    updatedAt: now,
  }

  const priorComparisons = input.previousReport?.comparisons ?? []
  const comparisons = [
    ...priorComparisons.filter(
      (comparison) =>
        !(
          comparison.artifactKey === input.artifactKey &&
          comparison.targetLanguage === targetLanguage
        ),
    ),
    nextComparison,
  ].sort((left, right) =>
    left.targetLanguage.localeCompare(right.targetLanguage),
  )

  const overrideHistory: MuxSyncOverrideAuditEntry[] = [
    ...(input.previousReport?.overrideHistory ?? []),
    {
      artifactKey: input.artifactKey,
      targetLanguage,
      at: now,
      action: "override_subtitle_track",
    },
  ]

  return {
    comparisons,
    overrideHistory,
    updatedAt: now,
  }
}
