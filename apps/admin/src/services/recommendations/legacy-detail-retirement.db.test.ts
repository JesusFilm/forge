import { randomUUID } from "node:crypto"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createPrismaClient } from "@/db/client"
import { loadRecommendationRequestDetail } from "./admin-ops/detail.service"
import {
  makeHarness,
  input,
  semanticCandidates,
} from "./delivery.service.test-helpers"
import {
  freezeLegacyDetailRetirement,
  runLegacyDetailRetirement,
} from "./legacy-detail-retirement.service"

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
      const stages = await db.recommendationCandidateStageEvidence.count({
        where: { runId: unprotected.id },
      })
      const manifest = await freeze([held.id, unprotected.id], [held.id])
      expect(manifest.candidates.map((c) => c.action).sort()).toEqual([
        "convert",
        "retire",
      ])
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
      expect(
        await runLegacyDetailRetirement(db, manifest, {
          execute: true,
          confirmTarget: manifest.targetDatabaseHash,
        }),
      ).toMatchObject({ status: "already-completed" })
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
  },
)
