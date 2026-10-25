import type { PrismaClient, WatchEvent } from "@prisma/client"

import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError, NotFoundError } from "@/services/errors"

export type CreateWatchEventInput = {
  videoId: string
  videoDubId?: string | null
  languageId?: string | null
  eventType: "download" | "meaningful_playback"
  positionSeconds?: number | null
  durationSeconds?: number | null
  progress?: number | null
  requestSessionId?: string | null
  occurredAt?: string | null
}

export class WatchEventService {
  constructor(private readonly prisma: PrismaClient) {}

  async create({
    user,
    input,
  }: {
    user: Principal | null
    input: CreateWatchEventInput
  }): Promise<WatchEvent> {
    if (!hasPermission(user, "write:watch-events") || !user?.id) {
      throw new ForbiddenError()
    }

    await this.assertVideoExists(input.videoId)
    if (input.videoDubId) {
      await this.assertVideoDubMatchesVideo(input.videoDubId, input.videoId)
    }

    return this.prisma.watchEvent.create({
      data: {
        authSubject: user.id,
        eventType: input.eventType,
        videoId: input.videoId,
        videoDubId: input.videoDubId ?? null,
        languageId: input.languageId ?? null,
        positionSeconds: boundedNonNegativeInt(input.positionSeconds),
        durationSeconds: boundedNonNegativeInt(input.durationSeconds),
        progress: boundedProgress(input.progress),
        requestSessionId: cleanOptionalString(input.requestSessionId),
        occurredAt: parseOccurredAt(input.occurredAt),
      },
    })
  }

  private async assertVideoExists(videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, deletedAt: null },
      select: { id: true },
    })
    if (!video) {
      throw new NotFoundError("Video", videoId)
    }
  }

  private async assertVideoDubMatchesVideo(
    videoDubId: string,
    videoId: string,
  ) {
    const dub = await this.prisma.videoDub.findFirst({
      where: { id: videoDubId, videoId, deletedAt: null },
      select: { id: true },
    })
    if (!dub) {
      throw new NotFoundError("VideoDub", videoDubId)
    }
  }
}

/**
 * Account-deletion erasure (R5): removes the subject's analytics log.
 * Standalone (not on WatchEventService) because the caller is the internal
 * server-to-server route, which imports functions rather than services.
 */
export async function deleteWatchEventsForUser(
  prisma: Pick<PrismaClient, "watchEvent">,
  authSubject: string,
) {
  const result = await prisma.watchEvent.deleteMany({
    where: { authSubject },
  })
  return { deletedCount: result.count }
}

function boundedNonNegativeInt(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

function boundedProgress(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

function cleanOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function parseOccurredAt(value: string | null | undefined) {
  if (!value) return new Date()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}
