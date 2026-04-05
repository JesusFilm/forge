// POST /api/enrich — Create enrichment jobs for existing CMS videos.
// Accepts selected video core IDs plus requested target language IDs from the
// coverage UI. The route derives the source audio language per video from CMS
// metadata, then normalizes only real language codes into the workflow.

import { after } from "next/server"
import { NextResponse } from "next/server"
import pLimit from "p-limit"
import { z } from "zod"
import { graphql, type ResultOf } from "@forge/graphql"
import { authenticateRequest } from "@/lib/auth"
import { createJob, updateJob } from "@/lib/state"
import { deriveEnrichLanguagePlan } from "@/lib/enrich-language"
import { redactSourceUrlForMetadata } from "@/lib/video-sources"
import {
  buildMuxSourceLanguagePriority,
  resolveCmsLanguageCode,
} from "@/lib/mux-language"
import { createStageCloneForJob } from "@/services/stageClone"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"
import getClient from "@/cms/client"

const enrichSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(100),
  targetLanguageIds: z.array(z.string().max(10)).max(10).optional(),
  languages: z.array(z.string().max(10)).max(10).optional(),
})

export const GET_VIDEOS_WITH_MUX = graphql(`
  query GetVideosWithMux($filters: VideoFiltersInput) {
    videos(filters: $filters, pagination: { pageSize: 100 }) {
      documentId
      coreId
      title
      primaryLanguage {
        coreId
        bcp47
        iso3
      }
      variants(pagination: { limit: -1 }) {
        aiGenerated
        language {
          coreId
          bcp47
          iso3
        }
        muxVideo {
          assetId
          playbackId
        }
        downloads(pagination: { limit: -1 }) {
          url
        }
      }
    }
  }
`)

const GET_LANGUAGES = graphql(`
  query GetLanguagesForEnrich($filters: LanguageFiltersInput) {
    languages(filters: $filters, pagination: { pageSize: 10 }) {
      coreId
      bcp47
      iso3
    }
  }
`)

type VideoNode = NonNullable<
  ResultOf<typeof GET_VIDEOS_WITH_MUX>["videos"][number]
>

type LanguageNode = NonNullable<
  ResultOf<typeof GET_LANGUAGES>["languages"][number]
>

export const ENRICH_CREATE_CONCURRENCY = 4

export async function mapWithConcurrencyLimit<T, TResult>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const limit = pLimit(Math.max(1, concurrency))
  return Promise.all(items.map((item) => limit(() => mapper(item))))
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

  const { videoIds } = parsed.data
  const targetLanguageIds =
    parsed.data.targetLanguageIds ?? parsed.data.languages ?? []
  const client = getClient()

  // Look up videos and their Mux assets
  let videos: VideoNode[]
  let languageMap = new Map<string, LanguageNode>()
  try {
    const [videosResult, languagesResult] = await Promise.all([
      client.query({
        query: GET_VIDEOS_WITH_MUX,
        variables: {
          filters: { coreId: { in: videoIds } },
        },
        fetchPolicy: "no-cache",
      }),
      targetLanguageIds.length > 0
        ? client.query({
            query: GET_LANGUAGES,
            variables: {
              filters: { coreId: { in: targetLanguageIds } },
            },
            fetchPolicy: "no-cache",
          })
        : Promise.resolve({ data: { languages: [] } }),
    ])
    videos = (videosResult.data?.videos ?? []).filter(
      (v): v is VideoNode => v != null,
    )
    languageMap = new Map(
      (languagesResult.data?.languages ?? [])
        .filter((language): language is LanguageNode => language != null)
        .map((language) => [language.coreId, language]),
    )
  } catch (error) {
    console.error("[api/enrich] Failed to look up videos:", error)
    return NextResponse.json(
      { error: "Failed to look up videos" },
      { status: 502 },
    )
  }

  const jobs: Array<{ videoId: string; jobId: string }> = []
  const errors: Array<{ videoId: string; error: string }> = []
  const foundVideoIds = new Set(
    videos.map((video) => video.coreId).filter(Boolean),
  )

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

  if (normalizedTargets.unresolvedTargetLanguageIds.length > 0) {
    return NextResponse.json(
      {
        error: "Could not resolve one or more requested target languages",
        unresolvedTargetLanguageIds:
          normalizedTargets.unresolvedTargetLanguageIds,
      },
      { status: 400 },
    )
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
        return null
      }

      const stageClone = await createStageCloneForJob(
        {
          coreId,
          variants: video.variants ?? [],
        },
        {
          sourceLanguagePriorityCodes,
          requestedTargetLanguageCode: primaryRequestedTargetLanguageCode,
        },
      )

      if (stageClone.status !== "ready") {
        const error =
          stageClone.status === "unsupported"
            ? stageClone.reason === "no_variant_with_mux"
              ? "No Mux-backed video variant found"
              : stageClone.reason === "no_materializable_source_url"
                ? "No downloadable MP4 source available for QA enrichment"
                : stageClone.reason === "no_mux_supported_downloadable_source"
                  ? "No downloadable source available in a Mux-supported language"
                  : "Source requires manual copy before QA enrichment"
            : stageClone.message
        return { videoId: coreId, error }
      }

      try {
        const actualSourceLanguage = stageClone.sourceLanguage
        const actualSourceLanguageCode =
          resolveCmsLanguageCode(actualSourceLanguage) ??
          stageClone.sourceLanguageCode

        const job = await createJob(
          stageClone.stageMuxAssetId,
          stageClone.stageMuxPlaybackId,
          normalizedTargets.targetLanguageCodes,
          { videoDocumentId: video.documentId },
        )
        const updatedJob = await updateJob(job.id, {
          artifacts: {
            ...job.artifacts,
            materialization: {
              kind: "metadata",
              data: {
                ...redactSourceUrlForMetadata(stageClone.sourceInputUrl),
                mode: "snapshot_to_stage_clone",
                sourceVideoCoreId: stageClone.sourceVideoCoreId,
                sourceMuxAssetId: stageClone.sourceMuxAssetId,
                sourceMuxPlaybackId: stageClone.sourceMuxPlaybackId ?? "",
                sourceInputType: stageClone.sourceInputType,
                sourceLanguageId: actualSourceLanguage?.coreId ?? "",
                sourceLanguageCode: actualSourceLanguageCode,
                primaryRequestedTargetLanguageCode:
                  primaryRequestedTargetLanguageCode ?? "",
                requestedTargetLanguageIds: targetLanguageIds,
                resolvedTargetLanguageCodes:
                  normalizedTargets.targetLanguageCodes,
                resolvedMuxSubtitleLanguageCode: stageClone.sourceLanguageCode,
                sourceSelectionPolicy: "requested-or-fallback-mux-supported",
                sourceSelectionReason: stageClone.sourceSelectionReason,
                sourceSelectionAttemptedCodes:
                  stageClone.sourceSelectionAttemptedCodes,
                sourceEnvironment: "mux-production",
                targetEnvironment: "mux-stage",
                stageMuxAssetId: stageClone.stageMuxAssetId,
                stageMuxPlaybackId: stageClone.stageMuxPlaybackId,
              },
            },
          },
        })

        // Run enrichment in the background after the response is sent
        after(async () => {
          try {
            await runVideoEnrichment({
              jobId: job.id,
              assetId: job.muxAssetId,
              muxAssetId: stageClone.stageMuxAssetId,
              language: stageClone.sourceLanguageCode,
              translateTo: normalizedTargets.targetLanguageCodes,
              initialArtifacts: updatedJob?.artifacts ?? job.artifacts,
            })
          } catch (err: unknown) {
            console.error(`Enrichment failed for job ${job.id}:`, err)
            await updateJob(job.id, { status: "failed" }).catch(console.error)
          }
        })

        return { videoId: coreId, jobId: job.id }
      } catch (err) {
        console.error(
          `[api/enrich] Failed to create enrichment job for video ${coreId}:`,
          err,
        )
        return {
          videoId: coreId,
          error: "Failed to create enrichment job",
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

  return NextResponse.json(
    {
      created: jobs.length,
      failed: errors.length,
      jobs,
      errors: errors.length > 0 ? errors : undefined,
    },
    { status: 201 },
  )
}
