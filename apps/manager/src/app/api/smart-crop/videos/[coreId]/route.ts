// GET /api/smart-crop/videos/[coreId] - resolve an admin video selected from
// the Smart Crop picker to the source Mux asset ID. Unlike Shorts Studio, Smart
// Crop keeps playback resolution in the create-job route and does not impose a
// public-playback-only gate here.

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"

const CORE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const ASSET_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

export type SmartCropVideoIneligibilityReason =
  | "missing_mux_asset"
  | "invalid_mux_asset"

export type SmartCropVideoResolution = {
  coreId: string
  title: string | null
  muxAssetId: string | null
  eligible: boolean
  reason: SmartCropVideoIneligibilityReason | null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ coreId: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { coreId: rawCoreId } = await params
  const coreId = decodeURIComponent(rawCoreId)
  if (!CORE_ID_PATTERN.test(coreId)) {
    return NextResponse.json(
      {
        error:
          "coreId must contain only alphanumeric characters, hyphens, and underscores",
      },
      { status: 400 },
    )
  }

  const { lookupVideosByCoreIdFromAdmin } =
    await import("@/lib/admin-video-lookup")
  const envelope = await lookupVideosByCoreIdFromAdmin([coreId])
  if (!envelope.ok) {
    if (envelope.reason === "config_missing") {
      const mockResponse = await resolveMockVideo(coreId)
      if (mockResponse) return mockResponse
    }

    const status = envelope.reason === "config_missing" ? 503 : 502
    return NextResponse.json(
      {
        error: "admin video lookup failed",
        reason:
          envelope.reason === "config_missing"
            ? "config_missing"
            : "admin_unreachable",
        upstreamReason: envelope.reason,
        messages: envelope.messages,
        retryable: envelope.retryable,
      },
      { status },
    )
  }

  const video = envelope.data.get(coreId)
  if (!video) {
    return NextResponse.json(
      {
        error: `No admin video found for coreId ${coreId}`,
        reason: "video_not_found",
      },
      { status: 404 },
    )
  }

  if (!video.muxAssetId) {
    return NextResponse.json({
      coreId,
      title: video.label,
      muxAssetId: null,
      eligible: false,
      reason: "missing_mux_asset",
    } satisfies SmartCropVideoResolution)
  }

  if (!ASSET_ID_PATTERN.test(video.muxAssetId)) {
    return NextResponse.json({
      coreId,
      title: video.label,
      muxAssetId: null,
      eligible: false,
      reason: "invalid_mux_asset",
    } satisfies SmartCropVideoResolution)
  }

  return NextResponse.json({
    coreId,
    title: video.label,
    muxAssetId: video.muxAssetId,
    eligible: true,
    reason: null,
  } satisfies SmartCropVideoResolution)
}

async function resolveMockVideo(coreId: string): Promise<NextResponse | null> {
  try {
    const { getCmsGateway } = await import("@/cms/gateway")
    const gateway = getCmsGateway()
    if (gateway.mode !== "mock" || !gateway.readMockState) {
      return null
    }

    const state = await gateway.readMockState()
    const video = state.readModels.videoCoverage.find(
      (candidate) => candidate.coreId === coreId,
    )
    if (!video) {
      return NextResponse.json(
        {
          error: `No mock video found for coreId ${coreId}`,
          reason: "video_not_found",
        },
        { status: 404 },
      )
    }

    const job = state.readModels.jobs.find(
      (candidate) => candidate.videoDocumentId === video.documentId,
    )
    if (!job?.muxAssetId) {
      return NextResponse.json({
        coreId,
        title: video.title ?? video.slug,
        muxAssetId: null,
        eligible: false,
        reason: "missing_mux_asset",
      } satisfies SmartCropVideoResolution)
    }

    if (!ASSET_ID_PATTERN.test(job.muxAssetId)) {
      return NextResponse.json({
        coreId,
        title: video.title ?? video.slug,
        muxAssetId: null,
        eligible: false,
        reason: "invalid_mux_asset",
      } satisfies SmartCropVideoResolution)
    }

    return NextResponse.json({
      coreId,
      title: video.title ?? video.slug,
      muxAssetId: job.muxAssetId,
      eligible: true,
      reason: null,
    } satisfies SmartCropVideoResolution)
  } catch {
    return null
  }
}
