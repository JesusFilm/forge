// GET /api/shorts/videos/[coreId] — per-video shorts eligibility resolution
// for the picker (plan 2026-06-11-002 "API routes"). The picker LIST reuses
// the existing /api/videos coverage read model; this route resolves ONE
// video's Mux asset, live duration, public playback id, and whisper language
// support so the picker can render disabled-with-reason rows.

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { toWhisperLanguage } from "@/lib/whisper-language"

const CORE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

export type ShortsVideoIneligibilityReason =
  | "missing_mux_asset"
  | "playback_not_public"

export type ShortsVideoResolution = {
  coreId: string
  title: string | null
  muxAssetId: string | null
  /** Public-policy playback id only — null when the asset is signed/drm. */
  playbackId: string | null
  durationSec: number | null
  language: { bcp47: string | null; whisper: string | null }
  eligible: boolean
  reason: ShortsVideoIneligibilityReason | null
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

  const language = {
    bcp47: video.primaryLanguageBcp47,
    whisper: toWhisperLanguage(video.primaryLanguageBcp47),
  }

  if (!video.muxAssetId) {
    const resolution: ShortsVideoResolution = {
      coreId,
      title: video.label,
      muxAssetId: null,
      playbackId: null,
      durationSec: null,
      language,
      eligible: false,
      reason: "missing_mux_asset",
    }
    return NextResponse.json(resolution)
  }

  let durationSec: number | null
  let publicPlaybackId: string | null
  try {
    const { getMuxAssetPlayback } = await import("@/services/mux")
    const playback = await getMuxAssetPlayback(video.muxAssetId)
    durationSec = playback.duration
    publicPlaybackId = playback.publicPlaybackId
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not resolve Mux asset ${video.muxAssetId}: ${
          error instanceof Error ? error.message : "unknown Mux error"
        }`,
        reason: "mux_error",
        retryable: true,
      },
      { status: 502 },
    )
  }

  const resolution: ShortsVideoResolution = {
    coreId,
    title: video.label,
    muxAssetId: video.muxAssetId,
    playbackId: publicPlaybackId,
    durationSec,
    language,
    eligible: publicPlaybackId !== null,
    reason: publicPlaybackId === null ? "playback_not_public" : null,
  }

  return NextResponse.json(resolution)
}
