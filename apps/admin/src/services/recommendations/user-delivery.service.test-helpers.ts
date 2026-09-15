import { vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { UserRecommendationDeliveryService } from "./user-delivery.service"
import {
  makeHarness,
  profileCandidateResult,
} from "./delivery.service.test-helpers"

export function video(index: number) {
  return {
    videoId: `video-${index}`,
    videoCoreId: `core-${String(index).padStart(3, "0")}`,
    videoTitle: `Video ${index}`,
    videoSlug: `video-${index}`,
    imageUrl: "https://image.test/poster.jpg",
    description: "A video",
    playbackId: "mux",
    generator: "curated" as const,
    poolVersion: "v1",
    poolKey: "start",
  }
}
export function userDeliveryHarness(
  primaryCount: number,
  prisma?: PrismaClient,
) {
  const h = makeHarness()
  const nominations = Array.from({ length: primaryCount }, (_, index) => {
    const v = video(index),
      base = profileCandidateResult.nominations[0]
    return {
      ...base,
      targetMediaId: v.videoId,
      canonicalIdentity: {
        ...base.canonicalIdentity,
        videoId: v.videoId,
        videoCoreId: v.videoCoreId,
        videoTitle: v.videoTitle,
      },
      presentation: { ...base.presentation, ...v },
    }
  })
  h.retrieveProfile.mockResolvedValue(
    primaryCount ? { ...profileCandidateResult, nominations } : null,
  )
  const curated = vi.fn(async () => ({
    version: "v1",
    items: Array.from({ length: 30 }, (_, index) => video(index + 10)),
  }))
  const history = vi.fn(
    async () => [] as { mediaId: string; completed: boolean }[],
  )
  const service = new UserRecommendationDeliveryService({
    prisma: prisma ?? (h.prisma as unknown as PrismaClient),
    enabled: true,
    admission: { acquire: h.acquire, release: h.release },
    getServingState: h.getServingState,
    tokenService: {
      activeKid: "kid",
      signDeliveryCapability: h.signDeliveryCapability,
    },
    retrieve: h.retrieve,
    recheckCached: h.recheckCached,
    authorizeProfile: h.authorizeProfile,
    retrieveProfile: h.retrieveProfile,
    curated,
    history,
  })
  return { ...h, curated, history, service }
}
