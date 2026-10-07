import { randomBytes, randomUUID } from "node:crypto"
import {
  PrismaClient,
  type Prisma,
  RecommendationDeliveryResult,
  RecommendationRequestState,
} from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { attestPrecomputedLaunchCapacity } from "./launch-capacity"

const DAY_MS = 86_400_000

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "live launch capacity evidence on PostgreSQL",
  () => {
    const schema = `precomputed_launch_${randomUUID().replaceAll("-", "")}`
    const generationId = `launch-generation-${randomUUID()}`
    const baselineId = randomUUID()
    const visitId = randomUUID()
    const linkedRequestId = `launch-linked-${randomUUID()}`
    const now = new Date()
    const startsAt = new Date(now.getTime() - 8 * DAY_MS)
    const endsAt = new Date(startsAt.getTime() + 7 * DAY_MS)
    const requestAt = new Date(now.getTime() - 2 * DAY_MS)
    const requestExpiresAt = new Date(now.getTime() + 21 * DAY_MS)
    let admin: Client
    let prisma: PrismaClient

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await admin.query(migration)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient<Prisma.PrismaClientOptions>({
        datasources: { db: { url: url.toString() } },
      })
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          modelId: "gpt-6-astra",
          promptVersion: "native-capacity-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: "b".repeat(64),
          inputCutoff: startsAt,
          expectedSourceCount: 1,
          protocolVersion: 2,
          capacityPreflight: { status: "passed", projectedBytes: 1_000_000 },
          status: "complete",
          completedAt: now,
        },
      })
      await prisma.recommendationPrecomputedBaselineRun.create({
        data: {
          id: baselineId,
          enabled: false,
          verificationAuthority: "live_verified",
          startsAt,
          endsAt,
          controlRoutingDigest: "c".repeat(64),
          actorId: "native-capacity-operator",
          finalReportDigest: "d".repeat(64),
          finalReport: {
            baselineId,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            observedAt: now.toISOString(),
            isFinal: true,
            eligibleVisits: 1,
            clickedVisits: 0,
            visitCtr: 0,
            independentBrowsers: 1,
            visitsPerBrowser: { "1": 1 },
            servedVisits: 0,
            unavailableVisits: 1,
            linkedDeliveryRequests: 1,
            cardClicks: 0,
            evidenceBasis: "verified_incumbent_baseline",
            webRequestHealth: "not_yet_reconciled",
          },
          expiresAt: new Date(endsAt.getTime() + 365 * DAY_MS),
        },
      })
      await prisma.recommendationPrecomputedBaselineVisit.create({
        data: {
          id: visitId,
          runId: baselineId,
          browserUnitDigest: "e".repeat(64),
          sourceVideoId: "source-video",
          locale: "en",
          audioLanguageSlug: "english",
          deliveryResult: "unavailable",
          createdAt: requestAt,
          expiresAt: new Date(now.getTime() + 20 * DAY_MS),
        },
      })
      await createRequest(linkedRequestId)
      await prisma.recommendationPrecomputedBaselineVisitRequest.create({
        data: {
          requestId: linkedRequestId,
          visitId,
          createdAt: requestAt,
          expiresAt: new Date(now.getTime() + 20 * DAY_MS),
        },
      })
    }, 180_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    async function createRequest(
      id: string,
      deliveryDiagnostics?: Prisma.InputJsonObject,
    ) {
      await prisma.recommendationRequest.create({
        data: {
          id,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId: "semantic-transcript-pgvector-v1",
          strategyVersion: "semantic-transcript-pgvector-v1",
          classifierVersion: "origin-traffic-v1",
          sessionDigest: "f".repeat(64),
          seedMediaId: "source-video",
          locale: "en",
          expectedItemCount: 0,
          state: RecommendationRequestState.ISSUED,
          result: RecommendationDeliveryResult.UNAVAILABLE,
          signingKid: "native-capacity-test",
          deliveryDiagnostics,
          createdAt: requestAt,
          issuedAt: requestAt,
          expiresAt: requestExpiresAt,
        },
      })
    }

    async function probe() {
      const [row] = await prisma.$queryRaw<
        Array<{
          cluster_system_id: string
          observed_db_bytes: bigint
          thin_visit_bytes: bigint
        }>
      >`
        SELECT (SELECT system_identifier::text FROM pg_control_system()) AS cluster_system_id,
          pg_database_size(current_database())::bigint AS observed_db_bytes,
          (pg_total_relation_size('recommendation_precomputed_baseline_visit') +
           pg_total_relation_size('recommendation_precomputed_baseline_visit_request'))::bigint AS thin_visit_bytes`
      if (!row) throw new Error("Missing PostgreSQL capacity probe")
      return row
    }

    it("measures unlinked ordinary failures, rejects thin samples, and freezes receipts and live evidence", async () => {
      const initialProbe = await probe()
      const measurement = {
        measuredAt: now.toISOString(),
        clusterSystemId: initialProbe.cluster_system_id,
        observedDbBytes: Number(initialProbe.observed_db_bytes),
        availableBytes: 50_000_000_000,
        reserveBytes: 5_000_000_000,
        projectedBytes: 500_000_000,
        sampleSourceCount: 1,
        sampleBytes: 50_000_000,
        source: "operator_verified_pgdata_df" as const,
      }
      const input = {
        generationId,
        operator: { id: "native-capacity-operator", role: "ADMIN" as const },
        now,
      }
      await expect(
        attestPrecomputedLaunchCapacity(prisma, {
          ...input,
          measurement: {
            ...measurement,
            sampleBytes: Number(initialProbe.thin_visit_bytes),
          },
        }),
      ).rejects.toMatchObject({ code: "invalid_input" })
      expect(
        await prisma.recommendationPrecomputedLaunchCapacityReceipt.count(),
      ).toBe(0)

      const first = await attestPrecomputedLaunchCapacity(prisma, {
        ...input,
        measurement,
      })
      expect(first.status).toBe("passed")
      const firstRow =
        await prisma.recommendationPrecomputedLaunchCapacityReceipt.findUniqueOrThrow(
          { where: { id: first.id } },
        )
      const firstEvidence = firstRow.measurement as {
        ordinaryRowBytes: number
        allTrafficRequestRows: number
      }
      expect(firstEvidence.allTrafficRequestRows).toBe(1)

      await createRequest(`launch-unlinked-failure-${randomUUID()}`, {
        failedAttemptPayload: randomBytes(768).toString("hex"),
      })
      const secondProbe = await probe()
      const second = await attestPrecomputedLaunchCapacity(prisma, {
        ...input,
        measurement: {
          ...measurement,
          observedDbBytes: Number(secondProbe.observed_db_bytes),
        },
      })
      expect(second.status).toBe("passed")
      const secondRow =
        await prisma.recommendationPrecomputedLaunchCapacityReceipt.findUniqueOrThrow(
          { where: { id: second.id } },
        )
      const secondEvidence = secondRow.measurement as {
        ordinaryRowBytes: number
        allTrafficRequestRows: number
      }
      expect(secondEvidence.allTrafficRequestRows).toBe(2)
      expect(secondEvidence.ordinaryRowBytes).toBeGreaterThan(
        firstEvidence.ordinaryRowBytes,
      )
      await expect(
        prisma.recommendationPrecomputedLaunchCapacityReceipt.update({
          where: { id: first.id },
          data: { status: "insufficient" },
        }),
      ).rejects.toThrow()

      const experimentId = `launch-evidence-${randomUUID()}`
      const experimentStartsAt = new Date(now.getTime() + DAY_MS)
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: experimentId,
          generationId,
          controlManifestId: "semantic-transcript-pgvector-v1",
          challengerManifestId: "precomputed-watch-preview-v1",
          controlManifestDigest: "1".repeat(64),
          controlRoutingDigest: "2".repeat(64),
          sourceSetDigest: "b".repeat(64),
          assignmentPolicyVersion: "browser-sha256-50-v1",
          eligibilityPolicyVersion:
            "public-watch-turnstile-verified-browser-v1",
          deliveryPolicyVersion: "saved-or-control-v1",
          configurationDigest: "3".repeat(64),
          liveEvidence: { contractVersion: "precomputed-live-evidence-v1" },
          state: "public_ready",
          startsAt: experimentStartsAt,
          endsAt: new Date(experimentStartsAt.getTime() + 30 * DAY_MS),
          expiresAt: new Date(experimentStartsAt.getTime() + 395 * DAY_MS),
        },
      })
      await expect(
        prisma.recommendationPrecomputedExperiment.update({
          where: { id: experimentId },
          data: { liveEvidence: { contractVersion: "tampered" } },
        }),
      ).rejects.toThrow()
    }, 120_000)
  },
)
