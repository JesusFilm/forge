// POST /api/enrich — Create enrichment jobs for existing CMS videos.
// Accepts an array of video gateway IDs and target language codes.
// Looks up the Mux asset for each video's first variant and creates
// an enrichment job + kicks off the workflow.

import { after } from "next/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { gql } from "@apollo/client"
import { authenticateRequest } from "@/lib/auth"
import { createJob, updateJob } from "@/lib/state"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"
import getClient from "@/cms/client"

const enrichSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(100),
  languages: z.array(z.string().max(10)).max(10),
})

// Untyped — queries across multiple types
const GET_VIDEOS_WITH_MUX = gql`
  query GetVideosWithMux($filters: VideoFiltersInput) {
    videos(filters: $filters, pagination: { pageSize: 100 }) {
      documentId
      gatewayId
      title
      variants {
        muxVideo {
          assetId
          playbackId
        }
      }
    }
  }
`

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let videos: any[]
  try {
    const result = await client.query({
      query: GET_VIDEOS_WITH_MUX,
      variables: {
        filters: { gatewayId: { in: videoIds } },
      },
      fetchPolicy: "no-cache",
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    videos = (result.data as any)?.videos ?? []
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
    const gatewayId = video.gatewayId as string
    // Find the first variant with a Mux asset
    const variant = (video.variants ?? []).find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (v: any) => v.muxVideo?.assetId,
    )

    if (!variant?.muxVideo) {
      errors.push({ videoId: gatewayId, error: "No Mux asset found" })
      continue
    }

    const muxAssetId = variant.muxVideo.assetId as string
    const muxPlaybackId = (variant.muxVideo.playbackId as string) ?? ""

    try {
      const job = await createJob(muxAssetId, muxPlaybackId, languages)
      jobs.push({ videoId: gatewayId, jobId: job.id })

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
      errors.push({
        videoId: gatewayId,
        error: err instanceof Error ? err.message : "Unknown error",
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
