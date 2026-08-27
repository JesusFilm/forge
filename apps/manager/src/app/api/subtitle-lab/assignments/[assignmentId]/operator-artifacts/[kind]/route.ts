import { NextResponse } from "next/server"
import { z } from "zod"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { BOUNDED_ID } from "@/features/subtitle-lab/subtitle-lab-contract"
import {
  privateNoStoreJson,
  requireSubtitleLabOperator,
  subtitleLabNotFound,
} from "@/features/subtitle-lab/subtitle-lab-route"
import { readVerifiedSubtitleEvalArtifact } from "@/services/subtitle-eval-artifacts"
import { getMuxAssetPlayback, getPlaybackUrl } from "@/services/mux"

const operatorArtifactKindSchema = z.enum([
  "source",
  "reference",
  "candidate",
  "video-context",
])

export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string; kind: string }> },
) {
  const session = await requireSubtitleLabOperator(request)
  if (session instanceof NextResponse) return subtitleLabNotFound()
  const params = await context.params
  const kind = operatorArtifactKindSchema.safeParse(params.kind)
  if (!BOUNDED_ID.safeParse(params.assignmentId).success || !kind.success) {
    return subtitleLabNotFound()
  }
  try {
    const client = await SubtitleLabAdminClient.configured()
    const assignment = await client.getOperatorAssignment(params.assignmentId)
    if (!assignment) return subtitleLabNotFound()

    if (kind.data === "video-context") {
      if (
        assignment.clipStartSeconds == null ||
        assignment.clipEndSeconds == null ||
        assignment.clipEndSeconds <= assignment.clipStartSeconds
      ) {
        return blockedVideoContext("VIDEO_CONTEXT_UNAVAILABLE")
      }
      const video = await client.getVideoPlaybackCandidate(
        assignment.videoId,
        assignment.editionIdentity,
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
          startSeconds: assignment.clipStartSeconds,
          endSeconds: assignment.clipEndSeconds,
        },
      })
    }

    const track =
      kind.data === "source"
        ? assignment.sourceTrack
        : kind.data === "reference"
          ? assignment.referenceTrack
          : assignment.candidateTrack
    if (track.mediaType !== "text/vtt") return subtitleLabNotFound()
    const locator = await client.operatorTrackLocator(
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
