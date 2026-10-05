import { createHash } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { deliverPrecomputedWatchPreview } from "./watch-delivery"
import { readPrecomputedWatchChoices } from "./watch-reader"
import { servedSnapshotValue } from "../served-item-payload"
import { deliverPrecomputedWatchFallback } from "./watch-fallback"
import { RECOMMENDATION_CONTRACTS } from "../contracts"
import type { SemanticRecommendationDelivery } from "../delivery.types"

const caller = {
  id: null,
  role: "CONSUMER_BEARER",
  fleet: false,
  rateLimitBucketKey: "precomputed-preview-native-test",
} as const
const tokenService = {
  activeKid: "preview-test",
  signDeliveryCapability: async ({ itemId }: { itemId: string }) =>
    `test-capability-${itemId}`,
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const choice = (
  targetVideoId: string,
  kind: "direct" | "alternative",
  rank: number,
) => ({
  targetVideoId,
  kind,
  rank,
  relationship: "connected",
  reasonEnglish: "This video explores a clearly connected part of the story.",
  evidence: { basis: "metadata", fields: ["title"] },
})

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "precomputed private Watch delivery on PostgreSQL 18",
  () => {
    let prisma: PrismaClient
    let admin: Client
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const schema = `precomputed_watch_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const sourceVideoId = `watch-source-${suffix}`
    const targets = Array.from(
      { length: 9 },
      (_, index) => `watch-target-${index + 1}-${suffix}`,
    )
    const englishId = `english-${suffix}`
    const spanishId = `spanish-${suffix}`
    let sequence = 0

    async function makeVideo(id: string, audioLanguageId = englishId) {
      await prisma.video.create({
        data: { id, coreId: `core-${id}`, slug: id },
      })
      await prisma.videoLocale.create({
        data: {
          id: `locale-${id}`,
          videoId: id,
          locale: "en",
          title: `Title ${id}`,
          status: "PUBLISHED",
        },
      })
      await prisma.muxVideo.create({
        data: { id: `mux-${id}`, playbackId: `playback-${id}` },
      })
      await prisma.videoDub.create({
        data: {
          id: `dub-${id}`,
          coreId: `dub-core-${id}`,
          videoId: id,
          languageId: audioLanguageId,
          muxVideoId: `mux-${id}`,
          published: true,
        },
      })
    }

    async function makeGeneration(choices: ReturnType<typeof choice>[]) {
      sequence += 1
      const generationId = `watch-generation-${sequence}-${suffix}`
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          modelId: "fixture-astra",
          promptVersion: "fixture-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: digest([sourceVideoId]),
          inputCutoff: new Date("2026-10-05T00:00:00.000Z"),
          expectedSourceCount: 1,
          status: "complete",
          completedAt: new Date(Date.now() + sequence * 1_000),
        },
      })
      await prisma.recommendationPrecomputedSource.create({
        data: {
          generationId,
          sourceVideoId,
          payload: choices,
          acceptedCount: choices.length,
          submissionDigest: digest(choices),
        },
      })
      return generationId
    }

    const input = (overrides: Record<string, unknown> = {}) => ({
      seedMediaId: sourceVideoId,
      locale: "en",
      audioLanguageSlug: "english",
      sessionDigest: "b".repeat(64),
      caller,
      ...overrides,
    })

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await admin.query(migration)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      })
      await prisma.language.createMany({
        data: [
          { id: englishId, coreId: `core-${englishId}`, slug: "english" },
          { id: spanishId, coreId: `core-${spanishId}`, slug: "spanish" },
        ],
      })
      for (const id of [sourceVideoId, ...targets]) await makeVideo(id)
      await prisma.videoDub.create({
        data: {
          id: `source-spanish-${suffix}`,
          coreId: `source-spanish-core-${suffix}`,
          videoId: sourceVideoId,
          languageId: spanishId,
          muxVideoId: `mux-${sourceVideoId}`,
          published: true,
        },
      })
    }, 120_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("serves six after filtering every stored edge, including an alternative, with packed bindings", async () => {
      await makeGeneration([
        ...targets
          .slice(0, 7)
          .map((id, index) => choice(id, "direct", index + 1)),
        ...targets
          .slice(7)
          .map((id, index) => choice(id, "alternative", index + 1)),
      ])
      await prisma.videoDub.update({
        where: { id: `dub-${targets[1]}` },
        data: { published: false },
      })
      await prisma.video.update({
        where: { id: targets[2] },
        data: { restrictViewPlatforms: ["watch"] },
      })
      const delivery = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(delivery.result).toBe("served")
      expect(delivery.items.map((item) => item.targetMediaId)).toEqual([
        targets[0],
        targets[3],
        targets[4],
        targets[5],
        targets[6],
        targets[7],
      ])
      expect(delivery.items[5]?.candidateGenerator).toBe("precomputed")
      const saved = await prisma.recommendationRequest.findUniqueOrThrow({
        where: { id: delivery.requestId! },
        include: { items: true },
      })
      expect(saved.experimentAssignmentId).toBeNull()
      expect(saved.strategyVersion).toBe("precomputed-watch-preview-v1")
      expect(saved.servedItemPayload).toMatchObject({ version: 1 })
      expect(saved.items).toHaveLength(6)
      const alternative = servedSnapshotValue(
        saved.servedItemPayload,
        saved.items.find((item) => item.position === 5)!,
      )
      expect(alternative.candidateProvenance).toMatchObject({
        kind: "alternative",
        rank: 1,
      })
      expect(
        saved.items.every(
          (item) =>
            JSON.stringify(item.presentation) === "{}" &&
            JSON.stringify(item.candidateProvenance) === "{}",
        ),
      ).toBe(true)
      expect(JSON.stringify(saved.servedItemPayload)).not.toContain(
        "reasonEnglish",
      )
      expect(JSON.stringify(saved.servedItemPayload)).not.toContain("evidence")
    })

    it("keeps a one-card snapshot inline and hides an explicitly empty source", async () => {
      await makeGeneration([choice(targets[0], "direct", 1)])
      const one = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(one.items).toHaveLength(1)
      expect(one.items[0]).toMatchObject({
        canonicalHref: `/watch/${targets[0]}.html`,
        playbackId: `playback-${targets[0]}`,
      })
      const oneSaved = await prisma.recommendationRequest.findUniqueOrThrow({
        where: { id: one.requestId! },
        include: { items: true },
      })
      expect(oneSaved.servedItemPayload).toBeNull()
      expect(oneSaved.items[0]?.presentation).toMatchObject({
        videoSlug: targets[0],
      })

      await makeGeneration([])
      const empty = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(empty).toMatchObject({
        result: "empty",
        reason: "no_connections",
        items: [],
      })
      expect(empty.requestId).toBeTruthy()
      expect(
        await prisma.recommendationRequest.findUnique({
          where: { id: empty.requestId! },
        }),
      ).toMatchObject({ expectedItemCount: 0, result: "EMPTY" })
    })

    it("treats changed exact audio as valid empty but an absent source row as technical", async () => {
      const generationId = await makeGeneration([
        choice(targets[0], "direct", 1),
      ])
      const spanish = await deliverPrecomputedWatchPreview(
        prisma,
        input({ audioLanguageSlug: "spanish" }),
        tokenService,
      )
      expect(spanish).toMatchObject({
        result: "empty",
        reason: "no_playable_connections",
        generationId,
      })
      const missing = await deliverPrecomputedWatchPreview(
        prisma,
        input({ seedMediaId: targets[8] }),
        tokenService,
      )
      expect(missing).toMatchObject({
        result: "unavailable",
        reason: "not_in_generation",
        requestId: null,
      })
    })

    it("does not serve a failed source from an otherwise complete generation", async () => {
      const generationId = await makeGeneration([])
      await prisma.recommendationPrecomputedSource.update({
        where: {
          generationId_sourceVideoId: { generationId, sourceVideoId },
        },
        data: { status: "failed", failureCode: "fixture_source_failed" },
      })
      expect(await readPrecomputedWatchChoices(prisma, input())).toMatchObject({
        state: "source_incomplete",
        generationId,
      })
      const delivery = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(delivery).toMatchObject({
        result: "unavailable",
        reason: "source_incomplete",
        generationId,
        requestId: null,
        items: [],
      })
    })

    it("fails closed for private authorization and changed seed publication", async () => {
      await expect(
        deliverPrecomputedWatchPreview(
          prisma,
          input({ caller: null }),
          tokenService,
        ),
      ).rejects.toThrow("Web consumer authentication required")
      await prisma.videoLocale.update({
        where: { id: `locale-${sourceVideoId}` },
        data: { status: "DRAFT" },
      })
      const denied = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(denied).toMatchObject({
        result: "unavailable",
        reason: "source_unavailable",
        requestId: null,
      })
      expect((await readPrecomputedWatchChoices(prisma, input())).state).toBe(
        "source_unavailable",
      )
    })

    it("guards incumbent recovery with current source publication and exact audio", async () => {
      await prisma.videoLocale.update({
        where: { id: `locale-${sourceVideoId}` },
        data: { status: "PUBLISHED" },
      })
      const incumbent = vi.fn(
        async (): Promise<SemanticRecommendationDelivery> => ({
          contractVersion: RECOMMENDATION_CONTRACTS.delivery,
          surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
          strategyVersion: RECOMMENDATION_CONTRACTS.strategy,
          classifierVersion: RECOMMENDATION_CONTRACTS.outcome,
          requestId: null,
          result: "empty",
          reason: null,
          expiresAt: null,
          items: [],
        }),
      )
      await deliverPrecomputedWatchFallback(prisma, input(), incumbent)
      expect(incumbent).toHaveBeenCalledWith(
        expect.objectContaining({
          eligibleHuman: false,
          consentReceiptDigest: null,
          profileTokenDigest: null,
        }),
      )
      incumbent.mockClear()
      await prisma.videoLocale.update({
        where: { id: `locale-${sourceVideoId}` },
        data: { status: "DRAFT" },
      })
      expect(
        await deliverPrecomputedWatchFallback(prisma, input(), incumbent),
      ).toMatchObject({
        result: "unavailable",
        reason: "source_unavailable",
      })
      expect(incumbent).not.toHaveBeenCalled()
    })
  },
)
