import { NextResponse } from "next/server"
import { z } from "zod"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { BOUNDED_ID } from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  privateNoStoreJson,
  requireSubtitleLabReviewer,
  subtitleLabNotFound,
} from "@/features/subtitle-lab/subtitle-lab-route"
import { hasReviewerLanguageGrant } from "@/lib/auth"
import { readVerifiedSubtitleEvalArtifact } from "@/services/subtitle-eval-artifacts"
import { getMuxAssetPlayback, getPlaybackUrl } from "@/services/mux"

const artifactKindSchema = z.enum([
  "source",
  "track-a",
  "track-b",
  "video-context",
])

export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string; kind: string }> },
) {
  const session = await requireSubtitleLabReviewer(request)
  if (session instanceof NextResponse) return session
  const params = await context.params
  const kind = artifactKindSchema.safeParse(params.kind)
  if (!BOUNDED_ID.safeParse(params.assignmentId).success || !kind.success) {
    return subtitleLabNotFound()
  }
  try {
    const client = await SubtitleLabAdminClient.configured()
    const detail = await client.reviewerDetail(session, params.assignmentId)
    if (
      !detail ||
      !hasReviewerLanguageGrant(
        session,
        detail.targetLanguageId,
        detail.targetLanguageSlug,
      )
    ) {
      return subtitleLabNotFound()
    }
    if (kind.data === "video-context") {
      if (
        detail.clipStartSeconds == null ||
        detail.clipEndSeconds == null ||
        detail.clipEndSeconds <= detail.clipStartSeconds
      ) {
        return blockedVideoContext("VIDEO_CONTEXT_UNAVAILABLE")
      }
      const video = await client.getVideoPlaybackCandidate(
        detail.videoId,
        detail.editionIdentity,
      )
      if (!video) return blockedVideoContext("VIDEO_CONTEXT_UNAVAILABLE")
      const playback = await getMuxAssetPlayback(video.muxAssetId).catch(
        () => null,
      )
      if (
        !playback ||
        playback.assetId !== video.muxAssetId ||
        playback.status !== "ready" ||
        !playback.publicPlaybackId ||
        playback.publicPlaybackId !== video.playbackId
      ) {
        return blockedVideoContext("PLAYBACK_UNAVAILABLE")
      }
      return privateNoStoreJson({
        status: "ready",
        playbackId: playback.publicPlaybackId,
        playbackUrl: getPlaybackUrl(playback.publicPlaybackId),
        durationSeconds: playback.duration ?? video.durationSeconds,
        clip: {
          startSeconds: detail.clipStartSeconds,
          endSeconds: detail.clipEndSeconds,
        },
      })
    }
    const track =
      kind.data === "source"
        ? detail.sourceTrack
        : kind.data === "track-a"
          ? detail.trackA
          : detail.trackB
    if (track.mediaType !== "text/vtt") return subtitleLabNotFound()
    const locator = await client.reviewerTrackLocator(
      session,
      params.assignmentId,
      track.contentId,
    )
    if (!locator || locator.mediaType !== "text/vtt") {
      return subtitleLabNotFound()
    }
    const byteLength = Number(locator.byteLength)
    if (!Number.isSafeInteger(byteLength)) return subtitleLabNotFound()
    const bytes = await readVerifiedSubtitleEvalArtifact({
      objectKey: locator.objectKey,
      sha256: locator.sha256,
      byteLength,
    })
    return new Response(new TextDecoder().decode(bytes), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${kind.data}.vtt"`,
        "content-type": "text/vtt; charset=utf-8",
        pragma: "no-cache",
        vary: "Cookie",
        "x-content-type-options": "nosniff",
      },
    })
  } catch {
    return subtitleLabNotFound()
  }
}

function blockedVideoContext(
  reason: "VIDEO_CONTEXT_UNAVAILABLE" | "PLAYBACK_UNAVAILABLE",
) {
  return privateNoStoreJson({ status: "blocked", reason })
}
