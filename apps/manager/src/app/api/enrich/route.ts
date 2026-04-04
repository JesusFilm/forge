// POST /api/enrich — Create enrichment jobs for existing CMS videos.
// Accepts selected video core IDs plus requested target language IDs from the
// coverage UI. The route derives the source audio language per video from CMS
// metadata, then normalizes only real language codes into the workflow.

import { after } from "next/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { graphql, type ResultOf } from "@forge/graphql"
import { authenticateRequest } from "@/lib/auth"
import { createJob, updateJob } from "@/lib/state"
import { deriveEnrichLanguagePlan } from "@/lib/enrich-language"
import { redactSourceUrlForMetadata } from "@/lib/video-sources"
import {
  resolveCmsLanguageCode,
  resolveMuxSubtitleLanguageCode,
} from "@/lib/mux-language"
import { createStageCloneForJob } from "@/services/stageClone"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"
import getClient from "@/cms/client"

const enrichSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(100),
  targetLanguageIds: z.array(z.string().max(10)).max(10).optional(),
  languages: z.array(z.string().max(10)).max(10).optional(),
})

const GET_VIDEOS_WITH_MUX = graphql(`
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
      variants {
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

  for (const video of videos) {
    const coreId = video.coreId
    if (!coreId) {
      continue
    }
    const languagePlan = deriveEnrichLanguagePlan(
      {
        primaryLanguage: video.primaryLanguage ?? null,
        variants: video.variants ?? [],
      },
      targetLanguageIds,
      languageMap,
    )
    const stageClone = await createStageCloneForJob(
      {
        coreId,
        variants: video.variants ?? [],
      },
      {
        preferredSourceLanguageId:
          languagePlan.sourceLanguage?.coreId ?? undefined,
      },
    )

    if (stageClone.status !== "ready") {
      const error =
        stageClone.status === "unsupported"
          ? stageClone.reason === "no_variant_with_mux"
            ? "No Mux-backed video variant found"
            : stageClone.reason === "no_materializable_source_url"
              ? "No downloadable MP4 source available for QA enrichment"
              : "Source requires manual copy before QA enrichment"
          : stageClone.message
      errors.push({ videoId: coreId, error })
      continue
    }

    try {
      const actualSourceLanguage =
        stageClone.sourceLanguage ?? languagePlan.sourceLanguage
      const actualSourceLanguageCode =
        resolveCmsLanguageCode(actualSourceLanguage) ?? "auto"
      const actualMuxSubtitleLanguageCode =
        resolveMuxSubtitleLanguageCode(actualSourceLanguage)

      const job = await createJob(
        stageClone.stageMuxAssetId,
        stageClone.stageMuxPlaybackId,
        languagePlan.targetLanguageCodes,
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
              requestedTargetLanguageIds: targetLanguageIds,
              resolvedTargetLanguageCodes: languagePlan.targetLanguageCodes,
              resolvedMuxSubtitleLanguageCode: actualMuxSubtitleLanguageCode,
              sourceEnvironment: "mux-production",
              targetEnvironment: "mux-stage",
              stageMuxAssetId: stageClone.stageMuxAssetId,
              stageMuxPlaybackId: stageClone.stageMuxPlaybackId,
            },
          },
        },
      })
      jobs.push({ videoId: coreId, jobId: job.id })

      // Run enrichment in the background after the response is sent
      after(async () => {
        try {
          await runVideoEnrichment({
            jobId: job.id,
            assetId: job.muxAssetId,
            muxAssetId: stageClone.stageMuxAssetId,
            language: actualSourceLanguageCode,
            translateTo: languagePlan.targetLanguageCodes,
            initialArtifacts: updatedJob?.artifacts ?? job.artifacts,
          })
        } catch (err: unknown) {
          console.error(`Enrichment failed for job ${job.id}:`, err)
          await updateJob(job.id, { status: "failed" }).catch(console.error)
        }
      })
    } catch (err) {
      console.error(
        `[api/enrich] Failed to create enrichment job for video ${coreId}:`,
        err,
      )
      errors.push({
        videoId: coreId,
        error: "Failed to create enrichment job",
      })
    }
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
