import { afterAll, describe, expect, it, vi } from "vitest"
import { prisma } from "@/db/client"
import {
  RecommendationViewerService,
  resolveRecommendationIdentity,
} from "./viewer-identity.service"
import { RecommendationProfileService } from "./profile.service"
import { createHash } from "node:crypto"
vi.mock("./profiles/job", () => ({
  dispatchRecommendationProfileProjection: vi.fn(async () => undefined),
}))
const caller = {
  id: null,
  role: "CONSUMER_BEARER" as const,
  fleet: true,
  rateLimitBucketKey: "local-fleet",
}
const service = new RecommendationViewerService(prisma)
const handles: string[] = []
const erasures = vi.spyOn(
  RecommendationProfileService.prototype,
  "completeErasure",
)
afterAll(async () => {
  for (const token of handles) {
    await prisma.recommendationViewer.deleteMany({
      where: { tokenDigest: createHash("sha256").update(token).digest("hex") },
    })
  }
  await Promise.allSettled(erasures.mock.results.map((result) => result.value))
  await prisma.$disconnect()
})
describe.skipIf(process.env.RECOMMENDATION_DB_TEST !== "1")(
  "cookie-free viewer lifecycle",
  () => {
    it("bootstraps a profile, preserves session continuity, resets history and keeps opt-out", async () => {
      const viewer = await service.bootstrap(caller)
      handles.push(viewer.viewerToken)
      expect(viewer.viewerToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const initial = await service.resolve(
        caller,
        viewer.viewerToken,
        viewer.sessionToken,
      )
      expect(initial.profileTokenDigest).toBeTruthy()
      expect(
        await service.transition(caller, { ...viewer, action: "status" }),
      ).toMatchObject({ personalization: true })
      await service.transition(caller, { ...viewer, action: "reset" })
      const reset = await service.resolve(
        caller,
        viewer.viewerToken,
        viewer.sessionToken,
      )
      expect(reset.profileTokenDigest).not.toBe(initial.profileTokenDigest)
      expect(reset.sessionDigest).toBe(initial.sessionDigest)
      await service.transition(caller, { ...viewer, action: "withdraw" })
      expect(
        await service.transition(caller, { ...viewer, action: "status" }),
      ).toMatchObject({ personalization: false })
      expect(
        (await service.resolve(caller, viewer.viewerToken, viewer.sessionToken))
          .profileTokenDigest,
      ).toBeNull()
      await service.transition(caller, { ...viewer, action: "grant" })
      expect(
        await service.transition(caller, { ...viewer, action: "status" }),
      ).toMatchObject({ personalization: true })
      await service.transition(caller, { ...viewer, action: "delete" })
      expect(
        await service.transition(caller, { ...viewer, action: "status" }),
      ).toMatchObject({ personalization: false })
    })
    it("refuses raw digest authority from fleet clients and unknown handles", async () => {
      await expect(
        resolveRecommendationIdentity(prisma, caller, {
          sessionDigest: "a".repeat(64),
        }),
      ).rejects.toThrow()
      await expect(
        service.resolve(caller, "a".repeat(43), "b".repeat(43)),
      ).rejects.toThrow()
      await expect(service.bootstrap(null)).rejects.toThrow()
    })
  },
)
