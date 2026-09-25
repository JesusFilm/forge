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
const PUSH_PREFIX = "push_identity_db_"

async function seedPushRows(viewerDigest: string): Promise<void> {
  await prisma.pushRegistration.create({
    data: {
      id: `${PUSH_PREFIX}reg`,
      expoPushToken: `${PUSH_PREFIX}token`,
      testDeviceId: `${PUSH_PREFIX}device`,
      viewerDigest,
      platform: "IOS",
      appBuild: "1.0.0",
      appLanguageSlug: "english",
      phoneLocale: "en-NZ",
      timeZone: "Pacific/Auckland",
      countrySource: "EDGE",
    },
  })
  await prisma.pushCampaign.create({
    data: {
      id: `${PUSH_PREFIX}campaign`,
      status: "SENT",
      destinationKind: "SERIES",
      destinationSlug: "life-of-jesus",
    },
  })
  await prisma.pushDelivery.create({
    data: {
      id: `${PUSH_PREFIX}delivery`,
      nonce: `${PUSH_PREFIX}nonce`,
      campaignId: `${PUSH_PREFIX}campaign`,
      registrationId: `${PUSH_PREFIX}reg`,
      localDay: new Date("2026-09-21T00:00:00.000Z"),
      languageSlug: "english",
      timeZone: "Pacific/Auckland",
      status: "HANDED_OFF",
    },
  })
  await prisma.pushOpen.create({
    data: {
      id: `${PUSH_PREFIX}open`,
      deliveryId: `${PUSH_PREFIX}delivery`,
      campaignId: `${PUSH_PREFIX}campaign`,
      registrationId: `${PUSH_PREFIX}reg`,
      viewerDigest,
      receivedAt: new Date(),
    },
  })
  await prisma.pushAttribution.create({
    data: {
      id: `${PUSH_PREFIX}attribution`,
      episodeId: `${PUSH_PREFIX}episode`,
      openId: `${PUSH_PREFIX}open`,
      campaignId: `${PUSH_PREFIX}campaign`,
      registrationId: `${PUSH_PREFIX}reg`,
      viewerDigest,
      mediaId: "video_1",
      attributedAt: new Date(),
    },
  })
}

async function readPushRows() {
  const where = { id: { startsWith: PUSH_PREFIX } }
  const registration = await prisma.pushRegistration.findUnique({
    where: { id: `${PUSH_PREFIX}reg` },
    select: { viewerDigest: true, status: true },
  })
  return {
    viewerDigest: registration?.viewerDigest ?? null,
    registrations: await prisma.pushRegistration.count({ where }),
    opens: await prisma.pushOpen.count({ where }),
    attributions: await prisma.pushAttribution.count({ where }),
    registrationStatus: registration?.status ?? null,
  }
}

async function cleanPushRows(): Promise<void> {
  const where = { id: { startsWith: PUSH_PREFIX } }
  await prisma.pushAttribution.deleteMany({ where })
  await prisma.pushOpen.deleteMany({ where })
  await prisma.pushDelivery.deleteMany({ where })
  await prisma.pushCampaign.deleteMany({ where })
  await prisma.pushRegistration.deleteMany({ where })
}
const erasures = vi.spyOn(
  RecommendationProfileService.prototype,
  "completeErasure",
)
afterAll(async () => {
  await cleanPushRows()
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
    it("ends the push link on a delete and leaves it on a withdraw", async () => {
      const viewer = await service.bootstrap(caller)
      handles.push(viewer.viewerToken)
      const viewerDigest = createHash("sha256")
        .update(viewer.viewerToken)
        .digest("hex")
      await seedPushRows(viewerDigest)

      await service.transition(caller, { ...viewer, action: "withdraw" })

      // A consent withdrawal is not an erasure: push attribution is product
      // analytics, so every push row stays exactly as it was.
      expect(await readPushRows()).toEqual({
        viewerDigest,
        registrations: 1,
        opens: 1,
        attributions: 1,
        registrationStatus: "ACTIVE",
      })

      await service.transition(caller, { ...viewer, action: "grant" })
      await service.transition(caller, { ...viewer, action: "delete" })

      expect(await readPushRows()).toEqual({
        viewerDigest: null,
        registrations: 1,
        opens: 0,
        attributions: 0,
        registrationStatus: "ACTIVE",
      })
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
