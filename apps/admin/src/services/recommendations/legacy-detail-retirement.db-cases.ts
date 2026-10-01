import { createHash, randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createPrismaClient } from "@/db/client"
import { loadRecommendationRequestDetail } from "./admin-ops/detail.service"
import {
  makeHarness,
  input,
  semanticCandidates,
} from "./delivery.service.test-helpers"
import {
  freezeLegacyDetailRetirement,
  hasCompletedLegacyDetailRetirementReceipt,
  runLegacyDetailRetirement,
} from "./legacy-detail-retirement.service"
import { freezeConversionManifest } from "./legacy-candidate-trace-conversion.service"

// Fixture IDs are synthetic. The real immutable-digest validator is exercised
// separately; never place private production IDs in tests or source.
vi.mock("./legacy-quality-holds", () => ({
  assertOriginalQualityHolds: vi.fn(),
}))

describe.skipIf(process.env.RECOMMENDATION_DB_TEST !== "1")(
  "protected legacy detail retirement PostgreSQL proof",
  () => {
    const db = createPrismaClient("main")
    const controller = new Client({
      connectionString: process.env.DATABASE_URL,
    })
    const seeds: string[] = []
    const cutoff = new Date(Date.now() - 86_400_000).toISOString()
    const holds = {
      qualitySelectorSha256:
        "c983ec02830d1b2df637c04e47fd75bdd66c26bd4e0caba0c38ff851561589a1",
      qualityRunIds: Array.from({ length: 64 }, (_, i) => `quality-${i}`),
      activeInvestigationRunIds: [] as string[],
    }
    beforeAll(async () => {
      await controller.connect()
    })
    afterAll(async () => {
      await db.recommendationRequest.deleteMany({
        where: { seedMediaId: { in: seeds } },
      })
      await db.$disconnect()
      await controller.end()
    })
    async function fixture() {
      const harness = makeHarness({
        database: db,
        candidateTraceFormat: "legacy",
      })
      harness.retrieve.mockResolvedValue(semanticCandidates(3))
      const seed = `retirement-${randomUUID()}`
      seeds.push(seed)
      const delivered = await harness.service.deliver(input(seed))
      expect(delivered.result).toBe("served")
      const run = await db.recommendationCandidateRun.findUniqueOrThrow({
        where: { requestId: delivered.requestId! },
      })
      await db.$executeRaw`UPDATE recommendation_request
        SET created_at=clock_timestamp()-interval '2 days' WHERE id=${run.requestId}`
      await db.$executeRaw`UPDATE recommendation_candidate_run
        SET created_at=clock_timestamp()-interval '2 days' WHERE id=${run.id}`
      return run
    }
    async function freeze(
      runIds: string[],
      activeInvestigationRunIds: string[] = [],
    ) {
      return freezeLegacyDetailRetirement(db, {
        runIds,
        createdBefore: cutoff,
        holds: { ...holds, activeInvestigationRunIds },
      })
    }

    it("converts held full detail, retires unprotected detail, and preserves issuance, items, expiry and audit", async () => {
      const held = await fixture()
      const unprotected = await fixture()
      const before = await loadRecommendationRequestDetail(db, {
        requestId: held.requestId,
        actorDigest: "b".repeat(64),
      })
      const items = await db.recommendationServedItem.findMany({
        where: { requestId: held.requestId },
      })
      const unprotectedItems = await db.recommendationServedItem.findMany({
        where: { requestId: unprotected.requestId },
      })
      const [rootsBefore] = await db.$queryRaw<Array<{ digest: string }>>`
        SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text) AS digest
        FROM recommendation_request r
        WHERE r.id IN (${held.requestId}, ${unprotected.requestId})
      `
      const [stagesBefore] = await db.$queryRaw<Array<{ snapshot: string }>>`
        SELECT jsonb_agg(to_jsonb(e) ORDER BY e.stage,e.ordinal)::text AS snapshot
        FROM recommendation_candidate_stage_evidence e WHERE e.run_id=${held.id}
      `
      const stages = await db.recommendationCandidateStageEvidence.count({
        where: { runId: unprotected.id },
      })
      const manifest = await freeze([held.id, unprotected.id], [held.id])
      expect(manifest.candidates.map((c) => c.action).sort()).toEqual([
        "convert",
        "retire",
      ])
      const { digest: v2Digest, ...v1Body } = {
        ...manifest,
        version: 1 as const,
      }
      const v1Manifest = {
        ...v1Body,
        digest: createHash("sha256")
          .update(JSON.stringify(v1Body))
          .digest("hex"),
      }
      expect(v1Manifest.digest).not.toBe(v2Digest)
      expect(
        await hasCompletedLegacyDetailRetirementReceipt(db, v1Manifest),
      ).toBe(false)
      expect(await runLegacyDetailRetirement(db, v1Manifest)).toMatchObject({
        status: "dry-run",
      })
      expect(await runLegacyDetailRetirement(db, manifest)).toMatchObject({
        status: "dry-run",
        rows: expect.any(Number),
      })
      expect(
        await runLegacyDetailRetirement(db, manifest, {
          execute: true,
          confirmTarget: manifest.targetDatabaseHash,
        }),
      ).toMatchObject({ status: "completed", converted: 1, retired: 1 })
      const heldAfter = await db.recommendationCandidateRun.findUniqueOrThrow({
        where: { id: held.id },
      })
      const retiredAfter =
        await db.recommendationCandidateRun.findUniqueOrThrow({
          where: { id: unprotected.id },
        })
      expect(heldAfter.traceFormatVersion).toBe(1)
      expect(heldAfter.legacyDetailRetiredAt).toBeNull()
      expect(heldAfter.expiresAt).toEqual(held.expiresAt)
      expect(retiredAfter.traceFormatVersion).toBeNull()
      expect(retiredAfter.legacyDetailRetiredAt).toBeInstanceOf(Date)
      expect(retiredAfter.nominatedCount).toBe(unprotected.nominatedCount)
      expect(retiredAfter.expiresAt).toEqual(unprotected.expiresAt)
      const [rootsAfter] = await db.$queryRaw<Array<{ digest: string }>>`
        SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text) AS digest
        FROM recommendation_request r
        WHERE r.id IN (${held.requestId}, ${unprotected.requestId})
      `
      expect(rootsAfter.digest).toBe(rootsBefore.digest)
      const [encoded] = await db.$queryRaw<Array<{ snapshot: string }>>`
        SELECT jsonb_agg(jsonb_build_object(
          'id', v->'id', 'run_id', c.id, 'stage', v->'stage', 'ordinal', v->'ordinal',
          'candidate_key', v->'candidateKey', 'target_media_id', v->'targetMediaId',
          'source_generator', v->'sourceGenerator', 'source_rank', v->'sourceRank',
          'source_score', v->'sourceScore', 'normalized_score', v->'normalizedScore',
          'rrf_score', v->'rrfScore', 'deterministic_score', v->'deterministicScore',
          'final_position', v->'finalPosition', 'reason_codes', v->'reasonCodes',
          'source_evidence', v->'sourceEvidence',
          'created_at', (v->>'createdAt')::timestamptz,
          'expires_at', c.expires_at
        ) ORDER BY v->>'stage',(v->>'ordinal')::integer)::text AS snapshot
        FROM recommendation_candidate_run c,
          jsonb_array_elements(c.trace_payload->'stages') v
        WHERE c.id=${held.id}
      `
      expect(encoded.snapshot).toBe(stagesBefore.snapshot)
      expect(
        await db.recommendationCandidateStageEvidence.count({
          where: { runId: { in: [held.id, unprotected.id] } },
        }),
      ).toBe(0)
      const heldDetail = await loadRecommendationRequestDetail(db, {
        requestId: held.requestId,
        actorDigest: "b".repeat(64),
      })
      expect(heldDetail?.candidateExecution).toEqual(before?.candidateExecution)
      const retiredDetail = await loadRecommendationRequestDetail(db, {
        requestId: unprotected.requestId,
        actorDigest: "b".repeat(64),
      })
      expect(retiredDetail?.candidateExecution?.stages).toEqual([])
      expect(
        retiredDetail?.candidateExecution?.legacyDetailRetiredAt,
      ).toBeInstanceOf(Date)
      expect(retiredDetail?.candidateExecution?.counts.nominated).toBe(
        unprotected.nominatedCount,
      )
      expect(
        await db.recommendationServedItem.findMany({
          where: { requestId: held.requestId },
        }),
      ).toEqual(items)
      expect(
        await db.recommendationServedItem.findMany({
          where: { requestId: unprotected.requestId },
        }),
      ).toEqual(unprotectedItems)
      expect(
        await db.recommendationTraceAccessAudit.count({
          where: { requestId: held.requestId },
        }),
      ).toBeGreaterThan(0)
      expect(stages).toBeGreaterThan(0)
      const [receipt] = await db.$queryRaw<
        Array<{
          converted_runs: number
          retired_runs: number
          stage_rows_deleted: number
        }>
      >`SELECT converted_runs, retired_runs, stage_rows_deleted
        FROM recommendation_legacy_detail_retirement_run
        WHERE manifest_digest=${manifest.digest}`
      expect(receipt).toEqual({
        converted_runs: 1,
        retired_runs: 1,
        stage_rows_deleted: manifest.candidates.reduce((n, c) => n + c.rows, 0),
      })
      await expect(db.$executeRaw`
        INSERT INTO recommendation_candidate_stage_evidence
          (id, run_id, stage, ordinal, candidate_key, expires_at)
        VALUES ('retired-late-stage', ${unprotected.id}, 'nominated', 0,
          'retired-late-candidate', ${unprotected.expiresAt})
      `).rejects.toThrow("retired")
      await expect(db.$executeRaw`
        INSERT INTO recommendation_candidate_stage_evidence
          (id, run_id, stage, ordinal, candidate_key, expires_at)
        VALUES ('compact-late-stage', ${held.id}, 'nominated', 20,
          'compact-late-candidate', ${held.expiresAt})
      `).rejects.toThrow("compact")
      expect(
        await runLegacyDetailRetirement(db, manifest, {
          execute: true,
          confirmTarget: manifest.targetDatabaseHash,
        }),
      ).toMatchObject({ status: "already-completed" })
      expect(
        await hasCompletedLegacyDetailRetirementReceipt(db, manifest),
      ).toBe(true)
      await db.recommendationRequest.delete({ where: { id: held.requestId } })
      await db.recommendationRequest.delete({
        where: { id: unprotected.requestId },
      })
      expect(
        await db.recommendationCandidateRun.count({
          where: { id: { in: [held.id, unprotected.id] } },
        }),
      ).toBe(0)
    })

    it("preserves every stored observation for an incomplete unprotected run", async () => {
      const run = await fixture()
      await db.$executeRaw`UPDATE recommendation_candidate_run
        SET evidence_complete=false WHERE id=${run.id}`
      const [before] = await db.$queryRaw<
        Array<{ stage_count: bigint; stage_digest: string }>
      >`SELECT count(*) AS stage_count,
          md5(jsonb_agg(to_jsonb(e) ORDER BY e.stage,e.ordinal)::text) AS stage_digest
        FROM recommendation_candidate_stage_evidence e WHERE e.run_id=${run.id}`
      const manifest = await freeze([run.id])
      expect(manifest.version).toBe(2)
      expect(manifest.candidates[0]?.action).toBe("preserve")
      expect(
        await runLegacyDetailRetirement(db, manifest, {
          execute: true,
          confirmTarget: manifest.targetDatabaseHash,
        }),
      ).toMatchObject({ status: "completed", converted: 1, retired: 0 })
      const after = await db.recommendationCandidateRun.findUniqueOrThrow({
        where: { id: run.id },
      })
      expect(after.evidenceComplete).toBe(false)
      expect(after.traceFormatVersion).toBe(1)
      expect(after.legacyDetailRetiredAt).toBeNull()
      expect(after.expiresAt).toEqual(run.expiresAt)
      expect(
        await db.recommendationCandidateStageEvidence.count({
          where: { runId: run.id },
        }),
      ).toBe(0)
      const [decoded] = await db.$queryRaw<
        Array<{ stage_count: bigint; stage_digest: string }>
      >`SELECT count(*) AS stage_count,
          md5(jsonb_agg(to_jsonb(e) ORDER BY e.stage,e.ordinal)::text) AS stage_digest
        FROM recommendation_candidate_run c
        CROSS JOIN LATERAL jsonb_array_elements(c.trace_payload->'stages') v
        CROSS JOIN LATERAL jsonb_populate_record(
          NULL::recommendation_candidate_stage_evidence,
          jsonb_build_object('id', v->'id', 'run_id', c.id,
            'stage', v->'stage', 'ordinal', v->'ordinal',
            'candidate_key', v->'candidateKey',
            'target_media_id', v->'targetMediaId',
            'source_generator', v->'sourceGenerator',
            'source_rank', v->'sourceRank', 'source_score', v->'sourceScore',
            'normalized_score', v->'normalizedScore',
            'rrf_score', v->'rrfScore',
            'deterministic_score', v->'deterministicScore',
            'final_position', v->'finalPosition',
            'reason_codes', v->'reasonCodes',
            'source_evidence', v->'sourceEvidence',
            'created_at', v->'createdAt',
            'expires_at', c.expires_at)) AS e
        WHERE c.id=${run.id}`
      expect(decoded).toEqual(before)
    })

    it("protects a late access link and rejects unrepresentable or changed sources", async () => {
      const linked = await fixture()
      const manifest = await freeze([linked.id])
      await loadRecommendationRequestDetail(db, {
        requestId: linked.requestId,
        actorDigest: "c".repeat(64),
      })
      await expect(
        runLegacyDetailRetirement(db, manifest, {
          execute: true,
          confirmTarget: manifest.targetDatabaseHash,
        }),
      ).rejects.toThrow("Protection changed")
      expect(
        await db.recommendationCandidateStageEvidence.count({
          where: { runId: linked.id },
        }),
      ).toBeGreaterThan(0)
      const malformed = await fixture()
      await db.$executeRaw`UPDATE recommendation_candidate_stage_evidence
        SET created_at=date_trunc('milliseconds',created_at)+interval '1 microsecond'
        WHERE run_id=${malformed.id}`
      await expect(freeze([malformed.id])).rejects.toThrow(
        "cannot be represented",
      )
      const changed = await fixture()
      const frozen = await freeze([changed.id])
      await db.$executeRaw`UPDATE recommendation_candidate_stage_evidence
        SET source_evidence='[{"changed":true}]'::jsonb
        WHERE run_id=${changed.id} AND stage='nominated' AND ordinal=0`
      await expect(
        runLegacyDetailRetirement(db, frozen, {
          execute: true,
          confirmTarget: frozen.targetDatabaseHash,
        }),
      ).rejects.toThrow("fingerprint")
    })

    it("converts owner-linked legacy detail and rejects an owner link added after freeze", async () => {
      const owner = await fixture()
      await db.recommendationRequest.update({
        where: { id: owner.requestId },
        data: { ownerReleaseId: randomUUID(), ownerReleaseGeneration: 1 },
      })
      const stageCount = await db.recommendationCandidateStageEvidence.count({
        where: { runId: owner.id },
      })
      const manifest = await freeze([owner.id])
      expect(manifest.candidates[0]?.action).toBe("convert")
      expect(
        await runLegacyDetailRetirement(db, manifest, {
          execute: true,
          confirmTarget: manifest.targetDatabaseHash,
        }),
      ).toMatchObject({ status: "completed", converted: 1, retired: 0 })
      const converted = await db.recommendationCandidateRun.findUniqueOrThrow({
        where: { id: owner.id },
      })
      expect(converted.traceFormatVersion).toBe(1)
      expect(converted.legacyDetailRetiredAt).toBeNull()
      expect(
        await db.recommendationCandidateStageEvidence.count({
          where: { runId: owner.id },
        }),
      ).toBe(0)
      const detail = await loadRecommendationRequestDetail(db, {
        requestId: owner.requestId,
        actorDigest: "d".repeat(64),
      })
      expect(detail?.candidateExecution?.stages).toHaveLength(stageCount)

      const late = await fixture()
      const frozen = await freeze([late.id])
      expect(frozen.candidates[0]?.action).toBe("retire")
      await db.recommendationRequest.update({
        where: { id: late.requestId },
        data: { ownerReleaseId: randomUUID(), ownerReleaseGeneration: 2 },
      })
      await expect(
        runLegacyDetailRetirement(db, frozen, {
          execute: true,
          confirmTarget: frozen.targetDatabaseHash,
        }),
      ).rejects.toThrow("Protection changed")
      expect(
        await db.recommendationCandidateStageEvidence.count({
          where: { runId: late.id },
        }),
      ).toBeGreaterThan(0)

      await db.$executeRaw`UPDATE recommendation_request
        SET created_at=clock_timestamp()-interval '20 days' WHERE id=${late.requestId}`
      await db.$executeRaw`UPDATE recommendation_candidate_run
        SET created_at=clock_timestamp()-interval '20 days' WHERE id=${late.id}`
      await expect(
        freezeConversionManifest(db, {
          runIds: [late.id],
          createdBefore: new Date(Date.now() - 15 * 86_400_000).toISOString(),
          holds,
        }),
      ).rejects.toThrow("ineligible")
    })

    it("backs off from retention and rolls back all updates on a deletion mismatch", async () => {
      const first = await fixture()
      const second = await fixture()
      const manifest = await freeze([first.id, second.id])
      await controller.query("BEGIN")
      await controller.query("SELECT pg_advisory_xact_lock(368000001)")
      try {
        expect(
          await runLegacyDetailRetirement(db, manifest, {
            execute: true,
            confirmTarget: manifest.targetDatabaseHash,
          }),
        ).toMatchObject({ status: "retention-busy" })
      } finally {
        await controller.query("ROLLBACK")
      }
      const name = `retirement_block_${randomUUID().replaceAll("-", "")}`
      await controller.query(
        `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END'`,
      )
      await controller.query(
        `CREATE TRIGGER "${name}" BEFORE DELETE ON recommendation_candidate_stage_evidence
        FOR EACH ROW WHEN (OLD.run_id='${second.id.replaceAll("'", "''")}')
        EXECUTE FUNCTION "${name}"()`,
      )
      try {
        await expect(
          runLegacyDetailRetirement(db, manifest, {
            execute: true,
            confirmTarget: manifest.targetDatabaseHash,
          }),
        ).rejects.toThrow("count mismatch")
        for (const run of [first, second]) {
          const current = await db.recommendationCandidateRun.findUniqueOrThrow(
            {
              where: { id: run.id },
            },
          )
          expect(current.legacyDetailRetiredAt).toBeNull()
          expect(
            await db.recommendationCandidateStageEvidence.count({
              where: { runId: run.id },
            }),
          ).toBeGreaterThan(0)
        }
      } finally {
        await controller.query(
          `DROP TRIGGER "${name}" ON recommendation_candidate_stage_evidence`,
        )
        await controller.query(`DROP FUNCTION "${name}"()`)
      }
    })

    it("blocks a stage INSERT started during retirement and keeps retired state immutable", async () => {
      const run = await fixture()
      await controller.query("BEGIN")
      await controller.query(
        "UPDATE recommendation_candidate_run SET legacy_detail_retired_at=now() WHERE id=$1",
        [run.id],
      )
      const insertion = db.$executeRaw`
        INSERT INTO recommendation_candidate_stage_evidence
          (id, run_id, stage, ordinal, candidate_key, expires_at)
        VALUES (${"late-" + randomUUID()}, ${run.id}, 'nominated', 20,
          'late-candidate', ${run.expiresAt})
      `
      try {
        const state = await Promise.race([
          insertion.then(
            () => "done",
            () => "error",
          ),
          new Promise<"pending">((resolve) =>
            setTimeout(() => resolve("pending"), 100),
          ),
        ])
        expect(state).toBe("pending")
      } finally {
        await controller.query("COMMIT")
      }
      await expect(insertion).rejects.toThrow("retired")
      await expect(db.$executeRaw`
        UPDATE recommendation_candidate_run
        SET legacy_detail_retired_at=NULL WHERE id=${run.id}
      `).rejects.toThrow("immutable")
      await expect(db.$executeRaw`
        UPDATE recommendation_candidate_run
        SET trace_format_version=1, trace_payload='{"stages":[]}'::jsonb
        WHERE id=${run.id}
      `).rejects.toThrow()
      const current = await db.recommendationCandidateRun.findUniqueOrThrow({
        where: { id: run.id },
      })
      expect(current.legacyDetailRetiredAt).toBeInstanceOf(Date)
      expect(current.traceFormatVersion).toBeNull()
    })

    it("waits for an in-flight stage writer and refuses retirement after its source changes", async () => {
      const run = await fixture()
      const manifest = await freeze([run.id])
      const before = await db.recommendationCandidateStageEvidence.count({
        where: { runId: run.id },
      })
      await controller.query("BEGIN")
      await controller.query(
        "INSERT INTO recommendation_candidate_stage_evidence " +
          "(id, run_id, stage, ordinal, candidate_key, expires_at) " +
          "VALUES ($1, $2, 'nominated', 20, 'in-flight-candidate', $3)",
        ["in-flight-" + randomUUID(), run.id, run.expiresAt],
      )
      const retirement = runLegacyDetailRetirement(db, manifest, {
        execute: true,
        confirmTarget: manifest.targetDatabaseHash,
      })
      try {
        const state = await Promise.race([
          retirement.then(
            () => "done",
            () => "error",
          ),
          new Promise<"pending">((resolve) =>
            setTimeout(() => resolve("pending"), 100),
          ),
        ])
        expect(state).toBe("pending")
      } finally {
        await controller.query("COMMIT")
      }
      await expect(retirement).rejects.toThrow()
      expect(
        await db.recommendationCandidateStageEvidence.count({
          where: { runId: run.id },
        }),
      ).toBe(before + 1)
      expect(
        (
          await db.recommendationCandidateRun.findUniqueOrThrow({
            where: { id: run.id },
          })
        ).legacyDetailRetiredAt,
      ).toBeNull()
    })

    it("preserves detail when an Admin read reaches its audit before retirement", async () => {
      const run = await fixture()
      const manifest = await freeze([run.id])
      let reachedAudit!: () => void
      let releaseAudit!: () => void
      const auditReached = new Promise<void>((resolve) => {
        reachedAudit = resolve
      })
      const auditRelease = new Promise<void>((resolve) => {
        releaseAudit = resolve
      })
      const readerDb = {
        $transaction: (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel: Prisma.TransactionIsolationLevel },
        ) =>
          db.$transaction(
            (tx) =>
              callback(
                new Proxy(tx, {
                  get(target, property, receiver) {
                    if (property === "recommendationTraceAccessAudit")
                      return {
                        create: async (
                          args: Parameters<
                            typeof target.recommendationTraceAccessAudit.create
                          >[0],
                        ) => {
                          reachedAudit()
                          await auditRelease
                          return target.recommendationTraceAccessAudit.create(
                            args,
                          )
                        },
                      }
                    return Reflect.get(target, property, receiver)
                  },
                }),
              ),
            options,
          ),
      }
      const read = loadRecommendationRequestDetail(readerDb as never, {
        requestId: run.requestId,
        actorDigest: "d".repeat(64),
      })
      await auditReached
      const retirement = runLegacyDetailRetirement(db, manifest, {
        execute: true,
        confirmTarget: manifest.targetDatabaseHash,
      })
      try {
        expect(
          await Promise.race([
            retirement.then(
              () => "done",
              () => "error",
            ),
            new Promise<"pending">((resolve) =>
              setTimeout(() => resolve("pending"), 100),
            ),
          ]),
        ).toBe("pending")
      } finally {
        releaseAudit()
      }
      const detail = await read
      expect(detail?.candidateExecution?.stages.length).toBeGreaterThan(0)
      await expect(retirement).rejects.toThrow("Protection changed")
      expect(
        await db.recommendationCandidateStageEvidence.count({
          where: { runId: run.id },
        }),
      ).toBeGreaterThan(0)
    })

    it("restarts a stale Admin read after retirement wins the request lock", async () => {
      const run = await fixture()
      const manifest = await freeze([run.id])
      let reachedDeletion!: () => void
      let releaseDeletion!: () => void
      const deletionReached = new Promise<void>((resolve) => {
        reachedDeletion = resolve
      })
      const deletionRelease = new Promise<void>((resolve) => {
        releaseDeletion = resolve
      })
      const retiringDb = {
        $queryRaw: db.$queryRaw,
        $transaction: (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: {
            isolationLevel: Prisma.TransactionIsolationLevel
            timeout: number
          },
        ) =>
          db.$transaction(
            (tx) =>
              callback(
                new Proxy(tx, {
                  get(target, property, receiver) {
                    if (property === "$executeRaw")
                      return async (
                        query: Prisma.Sql | TemplateStringsArray,
                        ...values: unknown[]
                      ) => {
                        const sql = "sql" in query ? query.sql : query.join("?")
                        if (
                          sql.includes(
                            "DELETE FROM recommendation_candidate_stage_evidence",
                          )
                        ) {
                          reachedDeletion()
                          await deletionRelease
                        }
                        return target.$executeRaw(query as never, ...values)
                      }
                    return Reflect.get(target, property, receiver)
                  },
                }),
              ),
            options,
          ),
      }
      const retirement = runLegacyDetailRetirement(
        retiringDb as never,
        manifest,
        {
          execute: true,
          confirmTarget: manifest.targetDatabaseHash,
        },
      )
      await deletionReached
      let attempts = 0
      const readerDb = {
        $transaction: (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel: Prisma.TransactionIsolationLevel },
        ) => {
          attempts++
          return db.$transaction(callback, options)
        },
      }
      const read = loadRecommendationRequestDetail(readerDb as never, {
        requestId: run.requestId,
        actorDigest: "e".repeat(64),
      })
      try {
        expect(
          await Promise.race([
            read.then(
              () => "done",
              () => "error",
            ),
            new Promise<"pending">((resolve) =>
              setTimeout(() => resolve("pending"), 100),
            ),
          ]),
        ).toBe("pending")
      } finally {
        releaseDeletion()
      }
      await expect(retirement).resolves.toMatchObject({ status: "completed" })
      const detail = await read
      expect(attempts).toBe(2)
      expect(detail?.candidateExecution?.legacyDetailRetiredAt).toBeInstanceOf(
        Date,
      )
      expect(detail?.candidateExecution?.stages).toEqual([])
    })
  },
)
