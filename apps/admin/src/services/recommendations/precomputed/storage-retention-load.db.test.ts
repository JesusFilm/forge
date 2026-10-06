import { createHash, randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { purgeExpiredRecommendationRequests } from "../retention.service"
import { servedSnapshotValue } from "../served-item-payload"

const PEAK_RECORDED_REQUESTS = 6_715
const DAY = 86_400_000
const now = new Date("2026-10-06T12:00:00.000Z")
const createdAt = new Date(now.getTime() - 35 * DAY)
const expiresAt = new Date(createdAt.getTime() + 28 * DAY)
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex")
const watchedTables = [
  "recommendation_request",
  "recommendation_served_item",
  "recommendation_candidate_run",
  "recommendation_selection",
  "recommendation_precomputed_visit",
  "recommendation_precomputed_visit_request",
  "recommendation_precomputed_ctr_archived_visit",
  "recommendation_precomputed_ctr_cluster",
  "recommendation_precomputed_ctr_totals",
] as const

describe.skipIf(
  env.RECOMMENDATION_DB_TEST !== "1" ||
    process.env.PRECOMPUTED_STORAGE_LOAD_TEST !== "1",
)(
  "one observed-peak-day synthetic precomputed retention load on PostgreSQL",
  () => {
    let prisma: PrismaClient
    let admin: Client
    const schema = `precomputed_load_${Date.now()}_${randomUUID().replaceAll("-", "")}`
    const suffix = randomUUID()
    const generationId = `load-generation-${suffix}`
    const experimentId = `load-experiment-${suffix}`
    const sourceVideoId = `load-source-${suffix}`

    async function relationBytes() {
      const rows = await prisma.$queryRaw<
        Array<{ name: string; bytes: bigint }>
      >`
      SELECT names.name, pg_total_relation_size(to_regclass(names.name))::bigint AS bytes
      FROM unnest(${watchedTables}::text[]) AS names(name)`
      return Object.fromEntries(
        rows.map((row) => [row.name, Number(row.bytes)]),
      )
    }

    async function walLsn() {
      const [row] = await prisma.$queryRaw<Array<{ lsn: string }>>`
      SELECT pg_current_wal_insert_lsn()::text AS lsn`
      return row.lsn
    }

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
      await prisma.video.create({
        data: {
          id: sourceVideoId,
          coreId: `core-${sourceVideoId}`,
          slug: sourceVideoId,
        },
      })
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          protocolVersion: 2,
          modelId: "gpt-6-astra",
          promptVersion: "load-fixture-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: "b".repeat(64),
          inputCutoff: createdAt,
          expectedSourceCount: 1,
          inputMode: "content_only",
          inputSnapshotMode: "observed_fenced",
          status: "complete",
          completedAt: new Date(createdAt.getTime() - DAY),
        },
      })
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: experimentId,
          generationId,
          controlManifestId: "semantic-transcript-pgvector-v1",
          challengerManifestId: "precomputed-watch-preview-v1",
          controlManifestDigest: "c".repeat(64),
          controlRoutingDigest: "d".repeat(64),
          sourceSetDigest: "b".repeat(64),
          assignmentPolicyVersion: "load-fixture-v1",
          eligibilityPolicyVersion: "load-fixture-v1",
          deliveryPolicyVersion: "load-fixture-v1",
          configurationDigest: "e".repeat(64),
          state: "closed",
          startsAt: new Date(createdAt.getTime() - DAY),
          endsAt: new Date(createdAt.getTime() + DAY),
          expiresAt: new Date(now.getTime() + DAY),
        },
      })
    }, 120_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query("ROLLBACK").catch(() => undefined)
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("archives expired packed/inline requests, visits, candidates, and synthetic actions under the ordinary five-second runner", async () => {
      const before = await relationBytes()
      const lsnBefore = await walLsn()
      const writeStarted = performance.now()
      let itemCount = 0
      let actionCount = 0
      // One observed peak day's recorded requests is a scenario input, not an
      // eligible-human-visit denominator. Five or six cards approximate the
      // observed 196,999 / 38,458 items/request without claiming actual mix.
      for (let offset = 0; offset < PEAK_RECORDED_REQUESTS; offset += 100) {
        const batch = Array.from(
          { length: Math.min(100, PEAK_RECORDED_REQUESTS - offset) },
          (_, index) => {
            const sequence = offset + index
            const id = `load-request-${sequence}-${suffix}`
            const visitId = randomUUID()
            const count = sequence < 820 ? 6 : 5
            const packed = sequence % 2 === 0
            const clicked = sequence % 10 === 0 // synthetic 10% action scenario
            const items = Array.from({ length: count }, (_, position) => {
              const itemId = `c${digest(`${suffix}:${sequence}:${position}`).slice(0, 24)}`
              return {
                id: itemId,
                requestId: id,
                position,
                targetMediaId: `load-target-${position}`,
                canonicalHref: `/watch/load-target-${position}.html`,
                candidateGenerator: "semantic",
                candidateProvenance: packed ? {} : { generator: "fixture" },
                presentation: packed ? {} : { label: `Video ${position}` },
                expiresAt,
              }
            })
            return { sequence, id, visitId, count, packed, clicked, items }
          },
        )
        itemCount += batch.reduce((sum, row) => sum + row.count, 0)
        actionCount += batch.filter((row) => row.clicked).length
        await prisma.$transaction(
          async (tx) => {
            await tx.recommendationRequest.createMany({
              data: batch.map((row) => ({
                id: row.id,
                contractVersion: "semantic-recommendation-v1",
                surfaceVersion: "watch-below-player-v1",
                manifestId: "semantic-transcript-pgvector-v1",
                strategyVersion: "semantic-transcript-pgvector-v1",
                classifierVersion: "legacy-position-v0",
                sessionDigest: digest(`session:${row.sequence}:${suffix}`),
                seedMediaId: sourceVideoId,
                locale: "en",
                expectedItemCount: row.count,
                ...(row.packed
                  ? {
                      servedItemPayload: {
                        version: 1,
                        items: Object.fromEntries(
                          row.items.map((item) => [
                            item.id,
                            {
                              presentation: { label: `Video ${item.position}` },
                              candidateProvenance: { generator: "fixture" },
                            },
                          ]),
                        ),
                      },
                    }
                  : {}),
                state: "ISSUED",
                result: "SERVED",
                deliveryJti: randomUUID(),
                signingKid: "fixture",
                privatePrecomputedVisitId: row.visitId,
                createdAt,
                issuedAt: createdAt,
                expiresAt,
              })),
            })
            await tx.recommendationServedItem.createMany({
              data: batch.flatMap((row) => row.items),
            })
            await tx.recommendationCandidateRun.createMany({
              data: batch.map((row) => ({
                requestId: row.id,
                purpose: "watch",
                contextVersion: "fixture-v1",
                generatorVersion: "fixture-v1",
                unionVersion: "fixture-v1",
                eligibilityVersion: "fixture-v1",
                rankerVersion: "fixture-v1",
                composerVersion: "fixture-v1",
                candidateEligibilityParity: "passed",
                rankerParity: "passed",
                nominatedCount: row.count,
                canonicalizedCount: row.count,
                deduplicatedCount: row.count,
                rejectedCount: 0,
                scoredCount: row.count,
                orderedCount: row.count,
                requestedCount: row.count,
                composedCount: row.count,
                evidenceComplete: true,
                createdAt,
                expiresAt,
              })),
            })
            await tx.recommendationPrecomputedVisit.createMany({
              data: batch.map((row) => ({
                id: row.visitId,
                experimentId,
                browserUnitDigest: digest(`browser:${row.sequence}:${suffix}`),
                sourceVideoId,
                locale: "en",
                audioLanguageSlug: "english",
                eligibility: "eligible",
                qualification: "unverified_browser",
                arm:
                  row.sequence % 2 === 0
                    ? ("CHALLENGER" as const)
                    : ("CONTROL" as const),
                createdAt,
                expiresAt,
              })),
            })
            await tx.recommendationPrecomputedVisitRequest.createMany({
              data: batch.map((row) => ({
                requestId: row.id,
                visitId: row.visitId,
                createdAt,
                expiresAt,
              })),
            })
            await tx.recommendationSelection.createMany({
              data: batch
                .filter((row) => row.clicked)
                .map((row) => ({
                  requestId: row.id,
                  itemId: row.items[0].id,
                  capabilityJti: randomUUID(),
                  eventId: randomUUID(),
                  payloadDigest: digest(`payload:${row.sequence}:${suffix}`),
                  claimNonceDigest: digest(`nonce:${row.sequence}:${suffix}`),
                  handoffExpiresAt: expiresAt,
                  occurredAt: createdAt,
                  receivedAt: createdAt,
                  expiresAt,
                })),
            })
          },
          { timeout: 15_000 },
        )
      }
      const writeMs = performance.now() - writeStarted
      const [{ bytes: writeWalBytes }] = await prisma.$queryRaw<
        Array<{ bytes: bigint }>
      >`
      SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), ${lsnBefore}::pg_lsn)::bigint AS bytes`
      const loaded = await relationBytes()
      expect(await prisma.recommendationRequest.count()).toBe(
        PEAK_RECORDED_REQUESTS,
      )
      expect(await prisma.recommendationServedItem.count()).toBe(itemCount)
      expect(await prisma.recommendationSelection.count()).toBe(actionCount)
      const sample = await prisma.recommendationRequest.findUniqueOrThrow({
        where: { id: `load-request-0-${suffix}` },
        include: { items: true },
      })
      expect(
        servedSnapshotValue(sample.servedItemPayload, sample.items[0])
          .presentation,
      ).toEqual({ label: `Video ${sample.items[0].position}` })

      const cleanupStarted = performance.now()
      const durations: number[] = []
      const statuses: string[] = []
      for (let run = 0; run < 150; run++) {
        if (
          (await prisma.recommendationRequest.count()) === 0 &&
          (await prisma.recommendationPrecomputedVisit.count()) === 0
        )
          break
        const started = performance.now()
        const result = await purgeExpiredRecommendationRequests(prisma, now)
        durations.push(performance.now() - started)
        statuses.push(result.status)
        expect(["succeeded", "yielded"]).toContain(result.status)
      }
      const cleanupMs = performance.now() - cleanupStarted
      expect(await prisma.recommendationRequest.count()).toBe(0)
      expect(await prisma.recommendationServedItem.count()).toBe(0)
      expect(await prisma.recommendationCandidateRun.count()).toBe(0)
      expect(await prisma.recommendationSelection.count()).toBe(0)
      expect(await prisma.recommendationPrecomputedVisit.count()).toBe(0)
      expect(await prisma.recommendationPrecomputedVisitRequest.count()).toBe(0)
      expect(
        await prisma.recommendationPrecomputedCtrArchivedVisit.count(),
      ).toBe(PEAK_RECORDED_REQUESTS)
      const after = await relationBytes()
      expect(after.recommendation_request).toBeGreaterThan(0)
      console.info(
        "precomputed_peak_day_retention_fixture",
        JSON.stringify({
          basis:
            "synthetic_one_observed_peak_request_day_not_verified_human_visits",
          requestRoots: PEAK_RECORDED_REQUESTS,
          servedItems: itemCount,
          packedRequests: Math.ceil(PEAK_RECORDED_REQUESTS / 2),
          legacyRequests: Math.floor(PEAK_RECORDED_REQUESTS / 2),
          selectionActions: actionCount,
          visits: PEAK_RECORDED_REQUESTS,
          writeMs: Math.round(writeMs),
          writeWalBytes: Number(writeWalBytes),
          cleanupMs: Math.round(cleanupMs),
          cleanupRuns: durations.length,
          cleanupStatusCounts: Object.fromEntries(
            [...new Set(statuses)].map((status) => [
              status,
              statuses.filter((value) => value === status).length,
            ]),
          ),
          maxCleanupRunMs: Math.round(Math.max(...durations)),
          relationBytesBefore: before,
          relationBytesLoaded: loaded,
          relationBytesAfterDelete: after,
        }),
      )
    }, 600_000)
  },
)
