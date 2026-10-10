// POST /api/enrich — Create enrichment jobs for existing videos.
// Accepts selected Admin/Core video IDs plus requested target language IDs from
// the coverage UI. The route derives the source audio language per video from
// Admin metadata, then normalizes only real language codes into the workflow.

import { NextResponse } from "next/server"
import pLimit from "p-limit"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { getCmsGateway, readMockCmsState } from "@/cms/gateway"
import type {
  AutomationRefreshMode,
  AutomationTemplate,
} from "@/features/agents/automation-contract"
import { buildAutomationKey } from "@/features/agents/eligibility"
import { buildInitialTranscriptionRoutingReport } from "@/lib/transcription-routing-report"
import { createJob, updateJob } from "@/lib/state"
import { getEnrichmentMaterializationTarget } from "@/lib/enrichment-materialization"
import { deriveEnrichLanguagePlan } from "@/lib/enrich-language"
import { redactSourceUrlForMetadata } from "@/lib/video-sources"
import {
  buildMuxSourceLanguagePriority,
  resolveCmsLanguageCode,
} from "@/lib/mux-language"
import { ensureGeneratedSubtitlesForAsset } from "@/services/mux"
import { isAudioCleanupConfigured } from "@/services/audioCleanup"
import {
  materializeEnrichmentTargetForJob,
  type MaterializeEnrichmentTargetResult,
} from "@/services/stageClone"
import { launchVideoEnrichment } from "@/workflows/launchVideoEnrichment"
import type { JobArtifactManifest } from "@/types/job"

const enrichSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(100),
  targetLanguageIds: z.array(z.string().min(1)).max(10).optional(),
  languages: z.array(z.string().min(1)).max(10).optional(),
})

type VideoNode = {
  documentId: string
  requestedId?: string
  coreId?: string | null
  title?: string | null
  label?: string | null
  primaryLanguage?: LanguageNode | null
  variants?: Parameters<typeof materializeEnrichmentTargetForJob>[0]["variants"]
}

type LanguageNode = {
  id?: string | null
  coreId?: string | null
  bcp47?: string | null
  iso3?: string | null
}

type ReadyMaterialization = Extract<
  MaterializeEnrichmentTargetResult,
  { status: "ready" }
>

export const ENRICH_CREATE_CONCURRENCY = 4

export type AutomationJobMetadata = {
  automationDocumentId: string
  automationRunDocumentId: string
  template: AutomationTemplate
  refreshMode: AutomationRefreshMode
  targetLanguageIds: string[]
}

export type CreateEnrichmentJobsInput = {
  videoIds: string[]
  targetLanguageIds?: string[]
  languages?: string[]
  automation?: AutomationJobMetadata
}

export type CreateEnrichmentJobsResult = {
  created: number
  failed: number
  jobs: Array<{ videoId: string; jobId: string }>
  errors?: Array<{ videoId: string; error: string }>
}

export class EnrichmentJobCreationError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: Record<string, unknown>,
  ) {
    super(String(responseBody.error ?? "Failed to create enrichment jobs"))
    this.name = "EnrichmentJobCreationError"
  }
}

export async function mapWithConcurrencyLimit<T, TResult>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const limit = pLimit(Math.max(1, concurrency))
  return Promise.all(items.map((item) => limit(() => mapper(item))))
}

function languageNodeFrom(
  value: LanguageNode | null | undefined,
): LanguageNode | null {
  if (!value) return null

  return {
    id: value.id ?? null,
    coreId: value.coreId ?? null,
    bcp47: value.bcp47 ?? null,
    iso3: value.iso3 ?? null,
  }
}

function addLanguageMapEntry(
  languageMap: Map<string, LanguageNode>,
  key: string | null | undefined,
  language: LanguageNode,
) {
  const normalizedKey = key?.trim()
  if (!normalizedKey) return
  languageMap.set(normalizedKey, language)
}

async function buildLanguageMap(): Promise<Map<string, LanguageNode>> {
  const gateway = getCmsGateway()
  const languageGeo = await gateway.getLanguageGeo()
  const languageMap = new Map<string, LanguageNode>()

  for (const rawLanguage of languageGeo.languages ?? []) {
    const language = rawLanguage as LanguageNode
    const normalized: LanguageNode = {
      id: language.id ?? null,
      coreId: language.coreId ?? null,
      bcp47: language.bcp47 ?? null,
      iso3: language.iso3 ?? null,
    }
    addLanguageMapEntry(languageMap, normalized.id, normalized)
    addLanguageMapEntry(languageMap, normalized.coreId, normalized)
    addLanguageMapEntry(languageMap, normalized.bcp47, normalized)
    addLanguageMapEntry(languageMap, normalized.iso3, normalized)
  }

  return languageMap
}

async function readAdminEnrichmentVideos(
  videoIds: string[],
): Promise<VideoNode[]> {
  const gateway = getCmsGateway()
  if (gateway.mode !== "admin") {
    throw new EnrichmentJobCreationError(410, {
      error:
        "Direct enrichment creation from the retired CMS video model is no longer available.",
    })
  }

  const adminVideos = await gateway.getVideosForEnrichment(videoIds)

  return adminVideos.map((video) => {
    const requestedId =
      videoIds.find(
        (videoId) =>
          videoId === video.documentId ||
          (video.coreId != null && videoId === video.coreId),
      ) ??
      video.coreId ??
      video.documentId

    return {
      documentId: video.documentId,
      requestedId,
      coreId: video.coreId,
      title: video.title ?? null,
      label: video.label ?? null,
      primaryLanguage: languageNodeFrom(video.primaryLanguage),
      variants: (video.variants ?? []).map((variant) => ({
        language: languageNodeFrom(variant?.language),
        muxVideo: variant?.muxVideo
          ? {
              assetId: variant.muxVideo.assetId ?? null,
              playbackId: variant.muxVideo.playbackId ?? null,
            }
          : null,
        downloads: (variant?.downloads ?? []).map((download) => ({
          url: download?.url ?? null,
        })),
      })),
    }
  })
}

export function buildMaterializationMetadata(params: {
  materialization: ReadyMaterialization
  actualSourceLanguage?: {
    coreId?: string | null
    bcp47?: string | null
    iso3?: string | null
  } | null
  actualSourceLanguageCode: string
  primaryRequestedTargetLanguageCode?: string
  requestedTargetLanguageIds: string[]
  resolvedTargetLanguageCodes: string[]
}): Record<string, unknown> {
  const {
    materialization,
    actualSourceLanguage,
    actualSourceLanguageCode,
    primaryRequestedTargetLanguageCode,
    requestedTargetLanguageIds,
    resolvedTargetLanguageCodes,
  } = params
  const sourceInputMetadata = materialization.sourceInputUrl
    ? redactSourceUrlForMetadata(materialization.sourceInputUrl)
    : {}

  const baseMetadata = {
    mode: materialization.materializationMode,
    sourceVideoCoreId: materialization.sourceVideoCoreId,
    sourceMuxAssetId: materialization.sourceMuxAssetId,
    sourceMuxPlaybackId: materialization.sourceMuxPlaybackId ?? "",
    sourceInputType: materialization.sourceInputType,
    sourceLanguageId: actualSourceLanguage?.coreId ?? "",
    sourceLanguageCode: actualSourceLanguageCode,
    primaryRequestedTargetLanguageCode:
      primaryRequestedTargetLanguageCode ?? "",
    requestedTargetLanguageIds,
    resolvedTargetLanguageCodes,
    resolvedMuxSubtitleLanguageCode: materialization.sourceLanguageCode,
    sourceSelectionPolicy: "requested-or-fallback-mux-supported",
    sourceSelectionReason: materialization.sourceSelectionReason,
    sourceSelectionAttemptedCodes:
      materialization.sourceSelectionAttemptedCodes,
    sourceEnvironment: "mux-production",
  }

  if (materialization.materializationMode === "snapshot_to_stage_clone") {
    return {
      ...sourceInputMetadata,
      ...baseMetadata,
      targetEnvironment: "mux-stage",
      stageMuxAssetId: materialization.targetMuxAssetId,
      stageMuxPlaybackId: materialization.targetMuxPlaybackId,
    }
  }

  return {
    ...sourceInputMetadata,
    ...baseMetadata,
    targetEnvironment: "mux-production",
    reusedMuxAssetId: materialization.targetMuxAssetId,
    reusedMuxPlaybackId: materialization.targetMuxPlaybackId,
  }
}

export async function createEnrichmentJobs(
  input: CreateEnrichmentJobsInput,
): Promise<CreateEnrichmentJobsResult> {
  const { videoIds } = input
  const targetLanguageIds = input.targetLanguageIds ?? input.languages ?? []
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const jobs: Array<{ videoId: string; jobId: string }> = []
    const errors: Array<{ videoId: string; error: string }> = []

    for (const videoId of videoIds) {
      const video = mockState.readModels.videoCoverage.find(
        (candidate) =>
          candidate.coreId === videoId || candidate.documentId === videoId,
      )
      if (!video) {
        errors.push({ videoId, error: "Video not found in mock dataset" })
        continue
      }

      const job = await createJob(
        `mock-${video.coreId ?? video.documentId}-asset`,
        `mock-${video.coreId ?? video.documentId}-playback`,
        targetLanguageIds,
        {
          videoDocumentId: video.documentId,
          sourceMediaTitle: video.title ?? undefined,
          initialArtifacts: {
            transcriptionRouting: {
              kind: "metadata",
              data: buildInitialTranscriptionRoutingReport({
                sourceInputUrl: `mock://${video.documentId}`,
              }) as unknown as Record<string, unknown>,
            },
            ...(input.automation
              ? {
                  automation: {
                    kind: "metadata" as const,
                    data: input.automation as unknown as Record<
                      string,
                      unknown
                    >,
                  },
                }
              : {}),
          },
        },
      )

      jobs.push({ videoId, jobId: job.id })
    }

    return {
      created: jobs.length,
      failed: errors.length,
      jobs,
      ...(errors.length > 0 ? { errors } : {}),
    }
  }

  const videos = await readAdminEnrichmentVideos(videoIds)
  const languageMap = await buildLanguageMap()

  const jobs: Array<{ videoId: string; jobId: string }> = []
  const errors: Array<{ videoId: string; error: string }> = []
  const foundVideoIds = new Set<string>()
  for (const video of videos) {
    if (video.documentId) foundVideoIds.add(video.documentId)
    if (video.coreId) foundVideoIds.add(video.coreId)
    if (video.requestedId) foundVideoIds.add(video.requestedId)
  }

  const normalizedTargets = deriveEnrichLanguagePlan(
    {},
    targetLanguageIds,
    languageMap,
  )
  const primaryRequestedTargetLanguageCode =
    normalizedTargets.targetLanguageCodes[0]
  const sourceLanguagePriorityCodes = buildMuxSourceLanguagePriority(
    primaryRequestedTargetLanguageCode,
  )
  const materializationTarget = getEnrichmentMaterializationTarget()

  if (normalizedTargets.unresolvedTargetLanguageIds.length > 0) {
    throw new EnrichmentJobCreationError(400, {
      error: "Could not resolve one or more requested target languages",
      unresolvedTargetLanguageIds:
        normalizedTargets.unresolvedTargetLanguageIds,
    })
  }

  for (const requestedVideoId of videoIds) {
    if (!foundVideoIds.has(requestedVideoId)) {
      errors.push({ videoId: requestedVideoId, error: "Video not found" })
    }
  }

  const perVideoResults = await mapWithConcurrencyLimit(
    videos,
    ENRICH_CREATE_CONCURRENCY,
    async (video) => {
      const coreId = video.coreId
      if (!coreId) {
        return {
          videoId: video.requestedId ?? video.documentId,
          error: "Video missing Core ID",
        }
      }
      const resultVideoId = video.requestedId ?? coreId

      const materialization = await materializeEnrichmentTargetForJob(
        {
          coreId,
          variants: video.variants ?? [],
        },
        {
          materializationTarget,
          sourceLanguagePriorityCodes,
          requestedTargetLanguageCode: primaryRequestedTargetLanguageCode,
        },
      )

      if (materialization.status !== "ready") {
        const error =
          materialization.status === "unsupported"
            ? materialization.reason === "no_variant_with_mux"
              ? "No Mux-backed video variant found"
              : materialization.reason === "no_materializable_source_url"
                ? "No downloadable MP4 source available for QA enrichment"
                : materialization.reason ===
                    "no_mux_supported_downloadable_source"
                  ? "No downloadable source available in a Mux-supported language"
                  : materialization.reason === "no_reusable_mux_asset"
                    ? "No reusable Mux asset available for direct enrichment"
                    : "Source requires manual copy before QA enrichment"
            : materialization.message
        return { videoId: resultVideoId, error }
      }

      try {
        if (materialization.materializationMode === "direct_mux_asset_reuse") {
          await ensureGeneratedSubtitlesForAsset(
            materialization.targetMuxAssetId,
            materialization.sourceLanguageCode,
          )
        }

        const actualSourceLanguage = materialization.sourceLanguage
        const actualSourceLanguageCode =
          resolveCmsLanguageCode(actualSourceLanguage) ??
          materialization.sourceLanguageCode
        const automationArtifact: JobArtifactManifest = input.automation
          ? {
              automation: {
                kind: "metadata" as const,
                data: {
                  automationDocumentId: input.automation.automationDocumentId,
                  automationRunDocumentId:
                    input.automation.automationRunDocumentId,
                  template: input.automation.template,
                  refreshMode: input.automation.refreshMode,
                  targetLanguageIds: input.automation.targetLanguageIds,
                  videoDocumentId: video.documentId,
                  automationKey: buildAutomationKey({
                    template: input.automation.template,
                    videoDocumentId: video.documentId,
                    targetLanguageIds: input.automation.targetLanguageIds,
                  }),
                },
              },
            }
          : {}

        const job = await createJob(
          materialization.targetMuxAssetId,
          materialization.targetMuxPlaybackId,
          normalizedTargets.targetLanguageCodes,
          {
            videoDocumentId: video.documentId,
            sourceMediaTitle: video.title ?? undefined,
            initialArtifacts: {
              transcriptionRouting: {
                kind: "metadata",
                data: buildInitialTranscriptionRoutingReport({
                  sourceInputUrl: materialization.sourceInputUrl,
                }) as unknown as Record<string, unknown>,
              },
              ...automationArtifact,
            },
          },
        )
        const updatedJob = await updateJob(job.id, {
          artifacts: {
            ...job.artifacts,
            ...automationArtifact,
            materialization: {
              kind: "metadata",
              data: buildMaterializationMetadata({
                materialization,
                actualSourceLanguage,
                actualSourceLanguageCode,
                primaryRequestedTargetLanguageCode,
                requestedTargetLanguageIds: targetLanguageIds,
                resolvedTargetLanguageCodes:
                  normalizedTargets.targetLanguageCodes,
              }),
            },
          },
        })

        try {
          await launchVideoEnrichment({
            jobId: job.id,
            assetId: job.muxAssetId,
            muxAssetId: materialization.targetMuxAssetId,
            playbackId: materialization.targetMuxPlaybackId,
            language: materialization.sourceLanguageCode,
            translateTo: normalizedTargets.targetLanguageCodes,
            runAudioCleanup: isAudioCleanupConfigured(),
            initialArtifacts: updatedJob?.artifacts ?? job.artifacts,
            videoDocumentId: video.documentId,
            videoTitle: video.title ?? undefined,
            videoLabel: video.label ?? undefined,
            requestedTranscriptionProvider: "automatic",
          })
        } catch (err: unknown) {
          console.error(`Enrichment failed for job ${job.id}:`, err)
          await updateJob(job.id, { status: "failed" }).catch(console.error)

          return {
            videoId: resultVideoId,
            error: "Failed to launch enrichment workflow.",
          }
        }

        return { videoId: resultVideoId, jobId: job.id }
      } catch (err) {
        console.error(
          `[api/enrich] Failed to create enrichment job for video ${coreId}:`,
          err,
        )
        return {
          videoId: resultVideoId,
          error:
            err instanceof Error
              ? err.message
              : "Failed to create enrichment job",
        }
      }
    },
  )

  for (const result of perVideoResults) {
    if (!result) {
      continue
    }

    if ("jobId" in result && typeof result.jobId === "string") {
      jobs.push({ videoId: result.videoId, jobId: result.jobId })
      continue
    }

    errors.push(result)
  }

  return {
    created: jobs.length,
    failed: errors.length,
    jobs,
    errors: errors.length > 0 ? errors : undefined,
  }
}

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = enrichSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  let result: CreateEnrichmentJobsResult
  try {
    result = await createEnrichmentJobs(parsed.data)
  } catch (error) {
    if (error instanceof EnrichmentJobCreationError) {
      return NextResponse.json(error.responseBody, { status: error.status })
    }
    throw error
  }

  return NextResponse.json(result, { status: 201 })
}
