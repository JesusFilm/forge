// POST /api/enrich — Create enrichment jobs for existing CMS videos.
// Accepts an array of video core IDs and target language codes.
// Looks up the Mux asset for each video's first variant and creates
// an enrichment job + kicks off the workflow.

import { after } from "next/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { graphql, type ResultOf } from "@forge/graphql"
import { authenticateRequest } from "@/lib/auth"
import { createJob, updateJob } from "@/lib/state"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"
import getClient from "@/cms/client"

const enrichSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(100),
  languages: z.array(z.string().max(10)).max(10),
})

const GET_VIDEOS_WITH_MUX = graphql(`
  query GetVideosWithMux($filters: VideoFiltersInput) {
    videos(filters: $filters, pagination: { pageSize: 100 }) {
      documentId
      coreId
      title
      variants {
        muxVideo {
          assetId
          playbackId
        }
      }
    }
  }
`)

type VideoNode = NonNullable<
  ResultOf<typeof GET_VIDEOS_WITH_MUX>["videos"][number]
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

  const { videoIds, languages } = parsed.data
  const client = getClient()

  // Look up videos and their Mux assets
  let videos: VideoNode[]
  try {
    const result = await client.query({
      query: GET_VIDEOS_WITH_MUX,
      variables: {
        filters: { coreId: { in: videoIds } },
      },
      fetchPolicy: "no-cache",
    })
    videos = (result.data?.videos ?? []).filter(
      (v): v is VideoNode => v != null,
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

  for (const video of videos) {
    const coreId = video.coreId
    if (!coreId) {
      continue
    }
    // Find the first variant with a Mux asset
    const variant = (video.variants ?? []).find((v) => v?.muxVideo?.assetId)

    if (!variant?.muxVideo) {
      errors.push({ videoId: coreId, error: "No Mux asset found" })
      continue
    }

    const muxAssetId = variant.muxVideo.assetId
    const muxPlaybackId = variant.muxVideo.playbackId ?? ""

    if (!muxAssetId) {
      errors.push({ videoId: coreId, error: "No Mux asset ID found" })
      continue
    }

    try {
      const job = await createJob(muxAssetId, muxPlaybackId, languages, {
        options: { notifyCms: true },
        videoDocumentId: video.documentId,
      })
      jobs.push({ videoId: coreId, jobId: job.id })

      // Run enrichment in the background after the response is sent
      after(async () => {
        try {
          await runVideoEnrichment({
            jobId: job.id,
            assetId: job.muxAssetId,
            muxAssetId,
            language: languages[0],
            translateTo: languages.slice(1),
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
