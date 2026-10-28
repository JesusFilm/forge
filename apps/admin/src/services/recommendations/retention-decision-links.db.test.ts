import { createHash, randomUUID } from "node:crypto"
import { Prisma, PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import {
  selectExpiredDecisionLinks,
  unlinkExpiredDecisionLinks,
} from "./retention-decision-links"

type Plan = {
  "Node Type": string
  "Relation Name"?: string
  "Actual Rows": number
  "Actual Loops": number
  "Rows Removed by Filter"?: number
  Plans?: Plan[]
}
function heapVisits(plan: Plan): number {
  const here =
    plan["Relation Name"] === "recommendation_personalization_decision" &&
    plan["Node Type"] !== "Index Only Scan"
      ? (plan["Actual Rows"] + (plan["Rows Removed by Filter"] ?? 0)) *
        plan["Actual Loops"]
      : 0
  return (
    here + (plan.Plans ?? []).reduce((sum, child) => sum + heapVisits(child), 0)
  )
}

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "expired decision selection on PostgreSQL",
  () => {
    let db: PrismaClient
    const now = new Date("2026-10-27T00:00:00Z")
    beforeAll(() => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/forge_retention_standalone_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback retention database required")
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 4 }),
      })
    })
    afterAll(async () => db?.$disconnect())

    it.each([
      "sparse_late",
      "stale_fanout",
      "empty_skew",
      "large_empty_prefix",
    ])(
      "avoids unrelated decision scans and limits decision heap reads for %s",
      async (fixture) => {
        await db.$transaction(
          async (tx) => {
            const expiredParents =
              fixture === "large_empty_prefix" ? 100000 : 1100
            const linkedParent = `expired-${String(expiredParents - 1).padStart(8, "0")}`
            await tx.$executeRawUnsafe(
              `CREATE TEMP TABLE recommendation_profile_projection_generation (id text PRIMARY KEY, expires_at timestamptz NOT NULL) ON COMMIT DROP`,
            )
            await tx.$executeRawUnsafe(
              `CREATE INDEX ON recommendation_profile_projection_generation(expires_at)`,
            )
            await tx.$executeRawUnsafe(
              `CREATE TEMP TABLE recommendation_personalization_decision (request_id text PRIMARY KEY, projection_generation_id text, pad text) ON COMMIT DROP`,
            )
            await tx.$executeRawUnsafe(
              `CREATE INDEX ON recommendation_personalization_decision(projection_generation_id)`,
            )
            await tx.$executeRawUnsafe(
              `INSERT INTO recommendation_profile_projection_generation SELECT 'expired-'||lpad(n::text,8,'0'),'2026-10-26' FROM generate_series(1,${expiredParents})n`,
            )
            await tx.$executeRawUnsafe(
              `INSERT INTO recommendation_profile_projection_generation SELECT 'live-'||n,'2026-11-01' FROM generate_series(1,258022)n`,
            )
            const parent =
              fixture === "empty_skew"
                ? Prisma.sql`'live-1'`
                : Prisma.sql`CASE WHEN n%10000<8739 THEN NULL ELSE 'live-'||(n%5716+1) END`
            await tx.$executeRaw(
              Prisma.sql`INSERT INTO recommendation_personalization_decision SELECT 'a'||md5(n::text),${parent},repeat(md5(n::text),6) FROM generate_series(1,182888)n`,
            )
            await tx.$executeRawUnsafe(
              `ANALYZE recommendation_profile_projection_generation`,
            )
            await tx.$executeRawUnsafe(
              `ANALYZE recommendation_personalization_decision`,
            )
            if (fixture === "large_empty_prefix") {
              await tx.$executeRawUnsafe(
                `CREATE TEMP TABLE retained_child (generation_id text PRIMARY KEY REFERENCES recommendation_profile_projection_generation(id), expires_at timestamptz NOT NULL) ON COMMIT DROP`,
              )
              await tx.$executeRawUnsafe(
                `INSERT INTO retained_child SELECT id, '2026-11-01' FROM recommendation_profile_projection_generation WHERE id LIKE 'expired-%'`,
              )
              await tx.$executeRaw(
                Prisma.sql`INSERT INTO recommendation_personalization_decision SELECT 'z'||n,${linkedParent},'late' FROM generate_series(1,7)n`,
              )
            } else if (fixture === "sparse_late") {
              await tx.$executeRawUnsafe(
                `INSERT INTO recommendation_personalization_decision SELECT 'z'||lpad(n::text,32,'0'),'expired-00001099','late' FROM generate_series(1,7)n`,
              )
              // Reproduce overestimated expiry selectivity without falsifying statistics.
              await tx.$executeRawUnsafe(
                `UPDATE recommendation_profile_projection_generation SET expires_at='2026-10-26' WHERE id LIKE 'live-%' AND right(id,1) IN ('1','2','3')`,
              )
              await tx.$executeRawUnsafe(
                `ANALYZE recommendation_profile_projection_generation`,
              )
              await tx.$executeRawUnsafe(
                `UPDATE recommendation_profile_projection_generation SET expires_at='2026-11-01' WHERE id LIKE 'live-%'`,
              )
            } else if (fixture === "stale_fanout") {
              // Do not ANALYZE after adding a large late parent: low estimates must
              // not make the page fetch/sort all of its children before LIMIT.
              await tx.$executeRawUnsafe(
                `INSERT INTO recommendation_personalization_decision SELECT 'z'||md5(n::text),'expired-00001099',repeat(md5(n::text),6) FROM generate_series(1,300000)n`,
              )
            }
            const captured: { sql?: Prisma.Sql } = {}
            const traced = new Proxy(tx, {
              get(target, key, receiver) {
                if (key === "$queryRaw")
                  return (sql: Prisma.Sql) => {
                    captured.sql = sql
                    return target.$queryRaw(sql)
                  }
                return Reflect.get(target, key, receiver)
              },
            })
            const rows = await selectExpiredDecisionLinks(traced, now, 100)
            expect(rows).toHaveLength(
              fixture === "empty_skew"
                ? 0
                : fixture === "sparse_late" || fixture === "large_empty_prefix"
                  ? 7
                  : 100,
            )
            expect(
              rows.every((row) => row.projectionGenerationId === linkedParent),
            ).toBe(true)
            if (!captured.sql)
              throw new Error("Selection query was not captured")
            const [actual] = await tx.$queryRaw<
              Array<{ "QUERY PLAN": Array<{ Plan: Plan }> }>
            >(
              Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured.sql}`,
            )
            expect(
              heapVisits(actual!["QUERY PLAN"][0]!.Plan),
            ).toBeLessThanOrEqual(100)
            if (fixture === "large_empty_prefix") {
              const probes = (plan: Plan): number =>
                (plan["Node Type"] === "Index Only Scan" &&
                plan["Relation Name"] ===
                  "recommendation_personalization_decision"
                  ? plan["Actual Loops"]
                  : 0) +
                (plan.Plans ?? []).reduce(
                  (sum, child) => sum + probes(child),
                  0,
                )
              // LIMIT bounds output, not empty-parent existence probes.
              expect(probes(actual!["QUERY PLAN"][0]!.Plan)).toBe(
                expiredParents,
              )
              expect(
                await tx.$queryRaw`SELECT count(*)::integer AS count FROM retained_child`,
              ).toEqual([{ count: expiredParents }])
            } else if (fixture !== "stale_fanout") {
              // Prisma 6.19.3's original findMany relation strategy, with only the
              // public qualification removed so this transaction's shadows apply.
              const [original] = await tx.$queryRaw<
                Array<{ "QUERY PLAN": Array<{ Plan: Plan }> }>
              >(Prisma.sql`
          EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          SELECT d.request_id FROM recommendation_personalization_decision d
          LEFT JOIN recommendation_profile_projection_generation g ON g.id=d.projection_generation_id
          WHERE g.expires_at<=${now} AND g.id IS NOT NULL ORDER BY d.request_id LIMIT 100 OFFSET 0`)
              expect(
                heapVisits(original!["QUERY PLAN"][0]!.Plan),
              ).toBeGreaterThanOrEqual(182888)
            }
          },
          { timeout: 60000 },
        )
      },
      60000,
    )

    async function fixture(
      generationCount: number,
      linksPerGeneration: number,
    ) {
      const tag = randomUUID(),
        manifestId = randomUUID()
      const expiredAt = new Date(now.getTime() - 1000),
        futureAt = new Date(now.getTime() + 86400000)
      const parents = Array.from(
        { length: generationCount },
        (_, n) => `${tag}-expired-${n}`,
      )
      const emptyParents = Array.from(
        { length: 7 },
        (_, n) => `${tag}-empty-${n}`,
      )
      const future = `${tag}-future`
      await db.recommendationStrategyManifest.create({
        data: {
          id: manifestId,
          strategyVersion: manifestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          generator: "semantic",
          maxItems: 1,
        },
      })
      await db.recommendationProfileProjectionGeneration.createMany({
        data: [...emptyParents, ...parents, future].map((id) => ({
          id,
          manifestId,
          scope: "SESSION",
          sessionDigest: createHash("sha256").update(id).digest("hex"),
          generation: 1,
          projectionVersion: "fixture",
          clusteringVersion: "fixture",
          eligibilityPolicyVersion: "fixture",
          outcomeClassifierVersion: "fixture",
          inputWindowStart: new Date(now.getTime() - 120_000),
          createdAt: new Date(now.getTime() - 120_000),
          inputWindowEnd: expiredAt,
          inputDigest: "b".repeat(64),
          retentionDays: 1,
          expiresAt: id === future ? futureAt : expiredAt,
        })),
      })
      const links = [
        ...parents.flatMap((parent) =>
          Array.from({ length: linksPerGeneration }, () => ({
            id: randomUUID(),
            parent,
          })),
        ),
        { id: randomUUID(), parent: future },
      ]
      await db.recommendationRequest.createMany({
        data: links.map(({ id }) => ({
          id,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId,
          strategyVersion: manifestId,
          classifierVersion: "fixture",
          sessionDigest: "c".repeat(64),
          locale: "en",
          seedMediaId: "fixture",
          expectedItemCount: 0,
          state: "ISSUED",
          result: "EMPTY",
          deliveryJti: randomUUID(),
          signingKid: "fixture",
          createdAt: now,
          issuedAt: now,
          expiresAt: futureAt,
        })),
      })
      await db.recommendationPersonalizationDecision.createMany({
        data: links.map(({ id, parent }) => ({
          requestId: id,
          effectiveManifestId: manifestId,
          lane: "profile_challenger",
          projectionGenerationId: parent,
          projectionScope: "session",
          projectionVersion: "fixture",
          projectionGenerationNumber: 1,
          interestCount: 1,
          expiresAt: futureAt,
        })),
      })
      return {
        parents,
        links,
        future,
        futureAt,
        cleanup: async () => {
          await db.recommendationRequest.deleteMany({
            where: { id: { in: links.map((x) => x.id) } },
          })
          await db.recommendationProfileProjectionGeneration.deleteMany({
            where: { id: { in: [...emptyParents, ...parents, future] } },
          })
        },
      }
    }

    it("drains beyond empty and full parent pages without changing live decisions", async () => {
      const f = await fixture(5, 4)
      try {
        let total = 0
        for (let n = 0; n < 8; n++) {
          const page = await db.$transaction((tx) =>
            unlinkExpiredDecisionLinks(tx, now, 3),
          )
          expect(page.selectedCount).toBeLessThanOrEqual(3)
          expect(page.unlinkedCount).toBe(page.selectedCount)
          total += page.unlinkedCount
          if (page.selectedCount < 3) break
        }
        expect(total).toBe(20)
        expect(
          await db.recommendationPersonalizationDecision.count({
            where: {
              requestId: { in: f.links.map((x) => x.id) },
              projectionGenerationId: null,
            },
          }),
        ).toBe(20)
        expect(
          await db.recommendationPersonalizationDecision.findUniqueOrThrow({
            where: { requestId: f.links.at(-1)!.id },
          }),
        ).toMatchObject({ projectionGenerationId: f.future })
        expect(
          await db.recommendationRequest.count({
            where: { id: { in: f.links.map((x) => x.id) } },
          }),
        ).toBe(21)
      } finally {
        await f.cleanup()
      }
    })

    it("rechecks parent expiry and the exact reference after concurrent changes", async () => {
      const f = await fixture(2, 1)
      try {
        const page = await db.$transaction(async (tx) => {
          const intercepted = new Proxy(tx, {
            get(target, key, receiver) {
              if (key === "$queryRaw")
                return async (sql: Prisma.Sql) => {
                  const rows = await target.$queryRaw(sql)
                  await db.recommendationProfileProjectionGeneration.update({
                    where: { id: f.parents[0] },
                    data: { expiresAt: f.futureAt },
                  })
                  await db.recommendationPersonalizationDecision.update({
                    where: { requestId: f.links[1]!.id },
                    data: { projectionGenerationId: f.future },
                  })
                  return rows
                }
              return Reflect.get(target, key, receiver)
            },
          })
          return unlinkExpiredDecisionLinks(intercepted, now, 100)
        })
        expect(page).toEqual({ selectedCount: 2, unlinkedCount: 0 })
        expect(
          await db.recommendationPersonalizationDecision.findUniqueOrThrow({
            where: { requestId: f.links[0]!.id },
          }),
        ).toMatchObject({ projectionGenerationId: f.parents[0] })
        expect(
          await db.recommendationPersonalizationDecision.findUniqueOrThrow({
            where: { requestId: f.links[1]!.id },
          }),
        ).toMatchObject({ projectionGenerationId: f.future })
      } finally {
        await f.cleanup()
      }
    })
  },
)
