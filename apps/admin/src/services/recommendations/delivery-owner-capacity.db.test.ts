import { createHash, randomUUID } from "node:crypto"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { RecommendationInputError } from "./errors"
import { createRecommendationDeliveryDependencies } from "./delivery.factory"
import { RecommendationDeliveryService } from "./delivery.service"
import { seedOwnerCapacityPopulation } from "./delivery-owner-capacity.test-helper"
import { publishCowatchShadowGeneration } from "./cowatch/projection.service"
import {
  composeDeliveryOwnerCowatch,
  resolveDeliveryOwnerAuthority,
} from "./delivery-owner.service"
import {
  makeHarness,
  personalizedInput,
  profileCandidateResult,
  semanticCandidates,
} from "./delivery.service.test-helpers"
import { RecommendationOwnerReleaseOperator } from "./promotion/owner-operator"
import { createRecommendationPromotionService } from "./promotion/service"
import { OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID } from "./promotion/manifest"

type TableSnapshot = {
  table: string
  rows: number
  heapBytes: number
  indexBytes: number
  toastBytes: number
  auxiliaryBytes: number
  totalBytes: number
}
async function snapshot(client: Client): Promise<TableSnapshot[]> {
  const tables = await client.query<{
    table: string
    heapBytes: string
    indexBytes: string
    toastBytes: string
    tableBytes: string
    totalBytes: string
  }>(`
    SELECT c.relname AS table, pg_relation_size(c.oid)::text AS "heapBytes", pg_indexes_size(c.oid)::text AS "indexBytes",
      CASE WHEN c.reltoastrelid=0 THEN 0 ELSE pg_total_relation_size(c.reltoastrelid) END::text AS "toastBytes",
      pg_table_size(c.oid)::text AS "tableBytes", pg_total_relation_size(c.oid)::text AS "totalBytes"
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`)
  return Promise.all(
    tables.rows.map(async (table) => {
      const count = await client.query<{ rows: string }>(
        `SELECT count(*)::text AS rows FROM "${table.table.replaceAll('"', '""')}"`,
      )
      const heapBytes = Number(table.heapBytes),
        toastBytes = Number(table.toastBytes)
      return {
        table: table.table,
        rows: Number(count.rows[0].rows),
        heapBytes,
        toastBytes,
        indexBytes: Number(table.indexBytes),
        auxiliaryBytes: Number(table.tableBytes) - heapBytes - toastBytes,
        totalBytes: Number(table.totalBytes),
      }
    }),
  )
}
function difference(before: TableSnapshot[], after: TableSnapshot[]) {
  const tables = after
    .map((row) => {
      const prior = before.find((entry) => entry.table === row.table)!
      return {
        table: row.table,
        rows: row.rows - prior.rows,
        heapBytes: row.heapBytes - prior.heapBytes,
        indexBytes: row.indexBytes - prior.indexBytes,
        toastBytes: row.toastBytes - prior.toastBytes,
        auxiliaryBytes: row.auxiliaryBytes - prior.auxiliaryBytes,
        totalBytes: row.totalBytes - prior.totalBytes,
      }
    })
    .filter((row) => row.rows !== 0 || row.totalBytes !== 0)
  return {
    tables,
    rowsAdded: tables.reduce((sum, row) => sum + row.rows, 0),
    totalBytes: tables.reduce((sum, row) => sum + row.totalBytes, 0),
  }
}
async function measure<T>(client: Client, work: () => Promise<T>) {
  await client.query("CHECKPOINT")
  const before = await snapshot(client)
  const walBefore = (
    await client.query<{ lsn: string }>(
      "SELECT pg_current_wal_insert_lsn()::text AS lsn",
    )
  ).rows[0].lsn
  const started = performance.now()
  const value = await work()
  const elapsedMs = performance.now() - started
  const walBytes = Number(
    (
      await client.query<{ bytes: string }>(
        "SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), $1::pg_lsn)::text AS bytes",
        [walBefore],
      )
    ).rows[0].bytes,
  )
  return {
    value,
    metrics: {
      ...difference(before, await snapshot(client)),
      walBytes,
      elapsedMs,
    },
  }
}
function latency(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    firstRequestMs: values[0],
    subsequentMedianMs: [...values.slice(1)].sort((a, b) => a - b)[
      Math.floor((values.length - 1) / 2)
    ],
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
    samples: values.length,
  }
}

function measurementSourceDigests() {
  return Object.fromEntries(
    [
      "delivery-owner-capacity.db.test.ts",
      "delivery-owner-capacity.test-helper.ts",
      "delivery-owner.service.ts",
      "delivery.service.ts",
      "delivery.factory.ts",
      "promotion/owner-authority.ts",
      "promotion/owner-operator.ts",
      "promotion/manifest.ts",
      "cowatch/projection.service.ts",
    ].map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(new URL(file, import.meta.url)))
        .digest("hex"),
    ]),
  )
}

describe.skipIf(
  env.RECOMMENDATION_DB_TEST !== "1" ||
    process.env.RECOMMENDATION_OWNER_CAPACITY !== "1",
)("bounded complete direct delivery capacity", () => {
  let admin: Client
  const children: string[] = []
  beforeAll(async () => {
    const url = new URL(env.DATABASE_URL)
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.pathname !== "/forge_capacity" ||
      url.search ||
      url.hash
    )
      throw new RecommendationInputError(
        "Owned loopback forge_capacity fixture required",
      )
    admin = new Client({ connectionString: url.toString() })
    await admin.connect()
  })
  afterAll(async () => {
    for (const name of children)
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin?.end()
  })
  it("measures 100 complete 64-nomination/six-card requests per matched arm", async () => {
    const measuredSourceSha256 = measurementSourceDigests()
    const arms: Record<string, unknown> = {}
    for (const arm of ["incumbent", "direct"] as const) {
      const name = `owner_capacity_${randomUUID().replaceAll("-", "")}`
      await admin.query(`CREATE DATABASE "${name}"`)
      children.push(name)
      const url = new URL(env.DATABASE_URL)
      url.pathname = `/${name}`
      const client = new Client({ connectionString: url.toString() })
      await client.connect()
      const db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 1 }),
      })
      try {
        const migrations = new URL(
          "../../../prisma/migrations/",
          import.meta.url,
        )
        for (const directory of readdirSync(migrations)
          .filter((name) => /^\d{4}_/.test(name))
          .sort())
          await client.query(
            readFileSync(
              new URL(`${directory}/migration.sql`, migrations),
              "utf8",
            ),
          )
        const source = await seedOwnerCapacityPopulation(db)
        const graph = await measure(client, () =>
          publishCowatchShadowGeneration(db, new Date(), source.sourceWindow),
        )
        expect(graph.value.status).toBe("published")
        expect(graph.value.generation).toBeTruthy()
        const graphCounts =
          await db.recommendationCowatchGeneration.findUniqueOrThrow({
            where: { id: graph.value.generation! },
          })
        expect(graphCounts.sourceCount).toBe(70)
        const actor = { id: "capacity-fixture-owner", role: "ADMIN" as const }
        const promotion = createRecommendationPromotionService(db)
        const initialPointer =
          await db.recommendationPromotionPointer.findUniqueOrThrow({
            where: { id: "recommendation-promotion-pointer" },
          })
        const stopped = await promotion.setKillSwitch({
          actor,
          expectedPointerGeneration: initialPointer.generation,
          enabled: true,
          reason: "capacity_fixture_stop",
        })
        const cleared = await promotion.setKillSwitch({
          actor,
          expectedPointerGeneration: stopped.generation,
          enabled: false,
          reason: "capacity_fixture_resume",
        })
        const operator = new RecommendationOwnerReleaseOperator({ prisma: db })
        const operation = {
          actor,
          authenticatedAt: new Date(),
          operationId: randomUUID(),
          expectedPointerGeneration: cleared.generation,
          graphGenerationId: graph.value.generation!,
        }
        const release = await measure(client, async () => {
          const prepared = await operator.prepare(operation)
          expect(prepared.status).toBe("prepared")
          return operator.activate({
            ...operation,
            bindingDigest: prepared.bindingDigest,
          })
        })
        expect(release.value.status).toBe("active")
        const composedCounts: Array<{
          nominated: number
          eligible: number
          cowatchNominated: number
          stages: number
        }> = []
        const compose = vi.fn(
          async (input: Parameters<typeof composeDeliveryOwnerCowatch>[1]) => {
            const result = await composeDeliveryOwnerCowatch(db, input)
            if (result.status === "composed")
              composedCounts.push({
                nominated: result.platform.evidence.filter(
                  (row) => row.stage === "nominated",
                ).length,
                eligible: result.platform.ordered.length,
                cowatchNominated: result.platform.evidence.filter(
                  (row) =>
                    row.stage === "nominated" &&
                    row.sourceGenerator === "directional-cowatch",
                ).length,
                stages: result.platform.evidence.length,
              })
            return result
          },
        )
        const harness = makeHarness({
          database: db,
          candidateTraceFormat: "compact",
          profileComparison: true,
          owner: {
            resolveOwnerAuthority: (input) =>
              resolveDeliveryOwnerAuthority(db, input),
            composeOwnerCowatch: compose,
          },
        })
        harness.retrieve.mockResolvedValue(
          semanticCandidates(36).map((row, index) => ({
            ...row,
            themes: Array.from(
              { length: 16 },
              (_, theme) => `theme-${(index + theme) % 24}`,
            ),
          })),
        )
        const base = profileCandidateResult.nominations[0]!
        harness.retrieveProfile.mockResolvedValue({
          ...profileCandidateResult,
          projection: {
            ...profileCandidateResult.projection,
            id: source.projection.id,
            scope: "durable",
            generation: 1,
            inputDigest: source.projection.inputDigest,
            publishedAt: source.projection.publishedAt,
            expiresAt: source.expiresAt,
            sessionIntentPresent: false,
          },
          nominations: Array.from({ length: 28 }, (_, index) => {
            const suffix = String(index).padStart(3, "0"),
              id = `profile-capacity-${suffix}`,
              title = `Profile capacity title ${suffix}`
            return {
              ...base,
              nominationKey: `profile:0:1:${id}`,
              targetMediaId: id,
              canonicalIdentity: {
                ...base.canonicalIdentity,
                videoId: id,
                videoCoreId: `profile-core-${suffix}`,
                videoTitle: title,
              },
              presentation: {
                ...base.presentation,
                videoSlug: id,
                videoTitle: title,
                themes: Array.from(
                  { length: 16 },
                  (_, theme) => `theme-${(index + theme) % 24}`,
                ),
              },
              source: {
                ...base.source,
                rank: index + 1,
                score: 0.92 - index * 0.005,
                evidence: { ...base.source.evidence, interestKind: "durable" },
              },
            }
          }),
        })
        const input = {
          ...personalizedInput(source.mediaA),
          sessionDigest: source.sessionDigest,
          profileTokenDigest: source.profile.tokenDigest!,
          consentReceiptDigest: source.consentReceiptDigest,
          clientDeliveryContract: arm === "direct" ? "cowatch-mmr-v1" : null,
        }
        // Include the production authorization/session-link mutation. Only
        // external retrieval, admission, serving-state and signing are stubs.
        const service = new RecommendationDeliveryService({
          ...createRecommendationDeliveryDependencies(db),
          candidateTraceFormat: "compact",
          admission: { acquire: harness.acquire, release: harness.release },
          getServingState: harness.getServingState,
          retrieve: harness.retrieve,
          recheckCached: harness.recheckCached,
          retrieveProfile: harness.retrieveProfile,
          resolveRecentContext: harness.resolveRecentContext,
          loadViewingModeAffinity: harness.loadViewingModeAffinity,
          assignExperiment: harness.assignExperiment,
          assignProfileExperiment: harness.assignProfileExperiment,
          composeOwnerCowatch: compose,
          tokenService: {
            activeKid: "active-kid",
            signDeliveryCapability: harness.signDeliveryCapability,
          },
          now: () => new Date(),
          nowMilliseconds: Date.now,
          newId: randomUUID,
        })
        const elapsed: number[] = []
        const requestIds: string[] = []
        let coSelected = 0
        const delivery = await measure(client, async () => {
          for (let index = 0; index < 100; index++) {
            const started = performance.now(),
              result = await service.deliver(input)
            elapsed.push(performance.now() - started)
            expect(result.result).toBe("served")
            expect(result.items).toHaveLength(6)
            expect(result.personalization?.executionMode).toBe(
              arm === "direct"
                ? "cowatch_mmr_personalized"
                : "hybrid_personalized",
            )
            if (arm === "direct")
              expect(result.personalization?.effectiveManifestId).toBe(
                OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
              )
            requestIds.push(result.requestId!)
            coSelected += result.items.filter(
              (item) => item.candidateGenerator === "directional-cowatch",
            ).length
          }
        })
        const runs = await db.recommendationCandidateRun.findMany({
          where: { requestId: { in: requestIds } },
          select: {
            nominatedCount: true,
            canonicalizedCount: true,
            deduplicatedCount: true,
            rejectedCount: true,
            scoredCount: true,
            orderedCount: true,
            requestedCount: true,
            composedCount: true,
          },
        })
        expect(runs).toHaveLength(100)
        expect(
          runs.every(
            (run) => run.nominatedCount === 64 && run.composedCount === 6,
          ),
        ).toBe(true)
        expect(elapsed.every((ms) => ms < 1_500)).toBe(true)
        if (arm === "direct") {
          expect(composedCounts).toHaveLength(100)
          expect(
            composedCounts.every(
              (row) =>
                row.nominated === 64 &&
                row.eligible === 64 &&
                row.cowatchNominated === 12,
            ),
          ).toBe(true)
          expect(coSelected).toBeGreaterThan(0)
        }
        const forbiddenEvidence = {
          studies: await db.recommendationStudy.count(),
          assignments: await db.recommendationExperimentAssignment.count(),
          evaluations: await db.recommendationShadowEvaluation.count(),
          compositionProtocols:
            await db.recommendationCompositionProtocol.count(),
        }
        expect(
          Object.values(forbiddenEvidence).every((count) => count === 0),
        ).toBe(true)
        const payload = (
          await client.query(
            `SELECT avg(octet_length(trace_payload::text))::float8 AS "meanJsonBytes", avg(pg_column_size(trace_payload))::float8 AS "meanStoredColumnBytes" FROM recommendation_candidate_run WHERE request_id=ANY($1::text[])`,
            [requestIds],
          )
        ).rows[0]
        arms[arm] = {
          requests: 100,
          semanticInput: 36,
          profileInput: 28,
          profileLineageContributions: 1,
          nominatedPerRequest: 64,
          composedPerRequest: 6,
          cowatchNominatedPerRequest: arm === "direct" ? 12 : 0,
          cowatchSelectedTotal: coSelected,
          graph: {
            ...graph.metrics,
            sourceCount: graphCounts.sourceCount,
            contributionCount: graphCounts.contributionCount,
            edgeCount: graphCounts.edgeCount,
          },
          release: release.metrics,
          delivery: {
            ...delivery.metrics,
            latency: latency(elapsed),
            bytesPerRequest: delivery.metrics.totalBytes / 100,
            walBytesPerRequest: delivery.metrics.walBytes / 100,
            payload,
          },
          noStudyEvidence: forbiddenEvidence,
          stageCounts: runs[0],
        }
      } finally {
        await db.$disconnect()
        await client.end()
      }
    }
    const server = (
      await admin.query(
        "SELECT version() AS version, current_setting('full_page_writes') AS full_page_writes, current_setting('default_toast_compression') AS toast_compression, current_setting('autovacuum') AS autovacuum, current_setting('checkpoint_timeout') AS checkpoint_timeout",
      )
    ).rows[0]
    expect(measurementSourceDigests()).toEqual(measuredSourceSha256)
    const receipt = {
      collectedAt: new Date().toISOString(),
      fixture: "isolated-local-2cpu-2gib-postgresql",
      measuredSourceSha256,
      databasePoolConnections: 1,
      server,
      arms,
      method:
        "Fresh child database per arm; identical source/catalog/profile setup; explicit checkpoint before each measured phase; all public table row/allocation deltas including heap, indexes, TOAST and forks; WAL insert-LSN delta on otherwise idle owned instance.",
      boundaries: [
        "Actual graph publisher, source qualification, authenticated operator, profile authorization/session-link refresh, live graph hydration/scoring, ranker/MMR, authority fences, issuance and request/trace persistence.",
        "Semantic/profile candidate retrieval, admission, serving-state retrieval, recent history, initial viewing-mode and token signing use existing synthetic harness inputs; live co-watch viewing-mode query is real.",
        "First request means first client path after setup, not cold database cache; no concurrent request load. JSON uses sixteen synthetic labels on semantic/profile candidates; identifiers are typical fixture widths, not maximum allowed widths.",
        "No viewer impression/playback/learning events are emitted; their future costs are excluded. Zero experiment/study/shadow/composition evidence rows. Existing source/catalog/profile setup and bootstrap stop/clear excluded from per-request and release deltas.",
        "Allocation is page-granular and includes reusable slack. WAL is a whole isolated-instance interval and includes full-page images after explicit checkpoints; it is not a production per-request WAL forecast. Graph is 70 sources/390 contributions/78 edges, not maximum population capacity; profile lineage has one contribution, not the 64-source maximum.",
      ],
      productionClearance: false,
    }
    writeFileSync(
      "/tmp/forge-direct-live-capacity.json",
      JSON.stringify(receipt, null, 2) + "\n",
    )
    console.info(JSON.stringify(receipt))
  }, 240_000)
})
