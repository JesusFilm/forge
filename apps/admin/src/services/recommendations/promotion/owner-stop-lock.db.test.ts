import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { compositionGraphFixture } from "../composition/graph.test-fixture"
import { compositionDigest } from "../composition/policy"
import {
  COWATCH_FROZEN_TRIAL_MODE,
  qualifyCowatchTrialAuthority,
} from "../cowatch/trial-authority.service"
import { prepareOwnerReleaseBinding } from "./owner-authority"
import { createRecommendationPromotionService } from "./service"

const day = 86_400_000
function latch() {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "qualification yields to legacy emergency stop on owned PostgreSQL",
  () => {
    const databaseName = `owner_stop_${randomUUID().replaceAll("-", "")}`
    let admin: Client, observer: Client, db: PrismaClient
    let created = false
    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback forge_test fixture required")
      admin = new Client({ connectionString: url.toString() })
      await admin.connect()
      await admin.query(`CREATE DATABASE "${databaseName}"`)
      created = true
      url.pathname = `/${databaseName}`
      observer = new Client({ connectionString: url.toString() })
      await observer.connect()
      const root = new URL("../../../../prisma/migrations/", import.meta.url)
      for (const name of readdirSync(root)
        .filter((name) => /^\d{4}_/.test(name))
        .sort())
        await observer.query(
          readFileSync(new URL(`${name}/migration.sql`, root), "utf8"),
        )
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 3 }),
      })
    }, 120_000)
    afterAll(async () => {
      await db?.$disconnect()
      await observer?.end()
      if (admin) {
        if (created)
          await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
        await admin.end()
      }
    })

    it("refuses preparation immediately while real stop commits its source graph fence", async () => {
      const now = new Date()
      const createdAt = new Date(now.getTime() - 10 * day)
      const expiresAt = new Date(now.getTime() + 16 * day)
      const experiment = await db.recommendationExperiment.findUniqueOrThrow({
        where: { id: "semantic-aa-v1" },
      })
      const assignment = await db.recommendationExperimentAssignment.create({
        data: {
          experimentId: experiment.id,
          unitKind: "ANONYMOUS_SESSION",
          unitDigest: compositionDigest(randomUUID()),
          arm: "CONTROL",
          assignmentProbability: 0.5,
          configurationDigest: experiment.configurationDigest,
          assignedAt: createdAt,
          expiresAt,
        },
      })
      const itemId = randomUUID()
      const mediaId = `native-stop-${randomUUID()}`
      const request = await db.recommendationRequest.create({
        data: {
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId: experiment.controlManifestId,
          strategyVersion: "semantic-transcript-pgvector-v1",
          classifierVersion: "legacy-position-v0",
          sessionDigest: compositionDigest(randomUUID()),
          seedMediaId: "native-stop-seed",
          locale: "en",
          expectedItemCount: 1,
          result: "SERVED",
          experimentAssignmentId: assignment.id,
          createdAt,
          expiresAt,
          items: {
            create: {
              id: itemId,
              position: 0,
              targetMediaId: mediaId,
              canonicalHref: `/watch/${mediaId}`,
              candidateGenerator: "semantic-transcript-candidate-v1",
              candidateProvenance: {},
              presentation: {},
              capabilityJti: randomUUID(),
              signingKid: "owned-fixture",
              expiresAt,
            },
          },
        },
      })
      const selection = await db.recommendationSelection.create({
        data: {
          requestId: request.id,
          itemId,
          capabilityJti: randomUUID(),
          eventId: randomUUID(),
          payloadDigest: compositionDigest(randomUUID()),
          claimNonceDigest: compositionDigest(randomUUID()),
          handoffExpiresAt: expiresAt,
          occurredAt: createdAt,
          expiresAt,
        },
      })
      const graph = await compositionGraphFixture(db, {
        ...request,
        itemId,
        mediaId,
        selectionId: selection.id,
      })
      await db.$transaction((tx) =>
        prepareOwnerReleaseBinding(
          tx,
          { graphGenerationId: graph.generationId },
          graph.now,
        ),
      )
      const held = latch()
      const proceed = latch()
      const preparation = db.$transaction(
        async (tx) => {
          // Synchronization only: take the same first lock before allowing stop
          // to acquire its pointer and reach the real slate-fence trigger.
          await tx.$queryRaw`SELECT id FROM recommendation_cowatch_generation WHERE id = ${graph.generationId}::char(64) FOR UPDATE`
          held.release()
          await proceed.promise
          return prepareOwnerReleaseBinding(
            tx,
            { graphGenerationId: graph.generationId },
            graph.now,
          )
        },
        { timeout: 10_000 },
      )
      const refused = expect(preparation).rejects.toThrow(
        "could not obtain lock",
      )
      await held.promise
      const pointer = await db.recommendationPromotionPointer.findUniqueOrThrow(
        {
          where: { id: "recommendation-promotion-pointer" },
        },
      )
      const stop = createRecommendationPromotionService(db).setKillSwitch({
        actor: { id: "native-stop-operator", role: "ADMIN" },
        expectedPointerGeneration: pointer.generation,
        enabled: true,
        reason: "native_concurrent_stop",
      })
      // Attach rejection handling before observing the database wait state.
      const stopped = expect(stop).resolves.toMatchObject({
        enabled: true,
        changed: true,
      })
      try {
        const deadline = Date.now() + 3_000
        let stopWaitingForGraph = false
        do {
          const waiting = await observer.query<{ waiting: boolean }>(`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid()
                AND wait_event_type = 'Lock'
                AND query LIKE '%INSERT INTO recommendation_promotion_slate_fence%'
            ) AS waiting
          `)
          stopWaitingForGraph = waiting.rows[0]?.waiting === true
          if (!stopWaitingForGraph)
            await new Promise((resolve) => setTimeout(resolve, 10))
        } while (!stopWaitingForGraph && Date.now() < deadline)
        expect(stopWaitingForGraph).toBe(true)
      } finally {
        proceed.release()
      }
      await refused
      await stopped
      expect(
        (
          await db.recommendationCowatchGeneration.findUniqueOrThrow({
            where: { id: graph.generationId },
          })
        ).invalidatedAt,
      ).not.toBeNull()
      expect(
        await db.recommendationPromotionSlateFence.count({
          where: { requestId: request.id },
        }),
      ).toBe(1)
      expect(
        (
          await db.recommendationExperiment.findUniqueOrThrow({
            where: { id: experiment.id },
          })
        ).state,
      ).toBe("CLOSED")
    }, 15_000)

    it("also refuses trial qualification when the stop pointer is locked", async () => {
      const graph = await compositionGraphFixture(db)
      const generation =
        await db.recommendationCowatchGeneration.findUniqueOrThrow({
          where: { id: graph.generationId },
        })
      await observer.query("BEGIN")
      await observer.query(
        "SELECT id FROM recommendation_promotion_pointer FOR UPDATE",
      )
      try {
        await expect(
          qualifyCowatchTrialAuthority(
            db,
            {
              mode: COWATCH_FROZEN_TRIAL_MODE,
              studyId: randomUUID(),
              experimentGeneration: 1,
              protocolDigest: "a".repeat(64),
              manifestId: "fixture",
              manifestDigest: "b".repeat(64),
              graphGenerationId: graph.generationId,
              sourceWindow: {
                version: "episode-event-window-v1",
                windowStart: generation.windowStart!,
                windowEnd: generation.windowEnd,
                evaluationAsOf: generation.evaluationAsOf!,
              },
              calibrationCompletedAt: graph.now,
              enrollmentEnd: new Date(graph.now.getTime() + day),
              trialValidUntil: new Date(
                graph.now.getTime() + day + 30 * 3_600_000,
              ),
              shadowEvaluationId: randomUUID(),
              shadowDecisionId: randomUUID(),
            },
            graph.now,
          ),
        ).rejects.toThrow("could not obtain lock")
        expect(await db.recommendationCowatchTrialAuthority.count()).toBe(0)
      } finally {
        await observer.query("ROLLBACK")
      }
    })
  },
)
