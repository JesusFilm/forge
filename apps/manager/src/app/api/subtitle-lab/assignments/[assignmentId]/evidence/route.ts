import { NextResponse } from "next/server"

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

export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const session = await requireSubtitleLabReviewer(request)
  if (session instanceof NextResponse) return session
  const { assignmentId } = await context.params
  if (!BOUNDED_ID.safeParse(assignmentId).success) return subtitleLabNotFound()

  try {
    const client = await SubtitleLabAdminClient.configured()
    const detail = await client.reviewerDetail(session, assignmentId)
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

    const tracks = [detail.sourceTrack, detail.trackA, detail.trackB]
    if (tracks.some((track) => track.mediaType !== "text/vtt")) {
      return subtitleLabNotFound()
    }
    const locators = await Promise.all(
      tracks.map((track) =>
        client.reviewerTrackLocator(session, assignmentId, track.contentId),
      ),
    )
    if (locators.some((locator) => locator?.mediaType !== "text/vtt")) {
      return subtitleLabNotFound()
    }
    const bytes = await Promise.all(
      locators.map((locator) => {
        if (!locator) throw new Error("Missing reviewer track")
        const byteLength = Number(locator.byteLength)
        if (!Number.isSafeInteger(byteLength)) {
          throw new Error("Invalid reviewer track length")
        }
        return readVerifiedSubtitleEvalArtifact({
          objectKey: locator.objectKey,
          sha256: locator.sha256,
          byteLength,
        })
      }),
    )

    return privateNoStoreJson({
      detail,
      sourceVtt: new TextDecoder().decode(bytes[0]),
      trackAVtt: new TextDecoder().decode(bytes[1]),
      trackBVtt: new TextDecoder().decode(bytes[2]),
      video: await reviewerVideoContext(client, detail),
    })
  } catch {
    return subtitleLabNotFound()
  }
}

async function reviewerVideoContext(
  client: SubtitleLabAdminClient,
  detail: {
    videoId: string
    editionIdentity: string
    clipStartSeconds: number | null
    clipEndSeconds: number | null
  },
) {
  if (
    detail.clipStartSeconds == null ||
    detail.clipEndSeconds == null ||
    detail.clipEndSeconds <= detail.clipStartSeconds
  ) {
    return { status: "blocked" as const, reason: "VIDEO_CONTEXT_UNAVAILABLE" }
  }
  const video = await client.getVideoPlaybackCandidate(
    detail.videoId,
    detail.editionIdentity,
  )
  if (!video) {
    return { status: "blocked" as const, reason: "VIDEO_CONTEXT_UNAVAILABLE" }
  }
  const playback = await getMuxAssetPlayback(video.muxAssetId).catch(() => null)
  if (
    !playback ||
    playback.assetId !== video.muxAssetId ||
    playback.status !== "ready" ||
    !playback.publicPlaybackId ||
    playback.publicPlaybackId !== video.playbackId
  ) {
    return { status: "blocked" as const, reason: "PLAYBACK_UNAVAILABLE" }
  }
  return {
    status: "ready" as const,
    playbackId: playback.publicPlaybackId,
    playbackUrl: getPlaybackUrl(playback.publicPlaybackId),
    durationSeconds: playback.duration ?? video.durationSeconds,
    clip: {
      startSeconds: detail.clipStartSeconds,
      endSeconds: detail.clipEndSeconds,
    },
  }
}
