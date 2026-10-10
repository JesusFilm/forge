import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createPrismaClient } from "@/db/client"
import { loadRecommendationRequestDetail } from "./admin-ops/detail.service"
import { purgeExpiredRecommendationRequests } from "./retention.service"
import {
  makeHarness,
  input,
  semanticCandidates,
} from "./delivery.service.test-helpers"
import {
  conversionManifestDigest,
  convertLegacyCandidateTraces,
  freezeConversionManifest,
} from "./legacy-candidate-trace-conversion.service"

// Full migrations on an explicitly owned disposable DB only. Root serializes
// execution; these tests never touch production or alter ordinary retention.
describe.skipIf(process.env.RECOMMENDATION_DB_TEST !== "1")(
  "legacy trace conversion PostgreSQL proof",
  () => {
    const db = createPrismaClient("main")
    const controller = new Client({
      connectionString: process.env.DATABASE_URL,
    })
    const seeds: string[] = []
    const cutoff = new Date(Date.now() - 15 * 86_400_000).toISOString()
    const holds = {
      qualitySelectorSha256: "a".repeat(64),
      qualityRunIds: Array.from({ length: 64 }, (_, i) => `quality-${i}`),
      activeInvestigationRunIds: [],
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
      const seed = `conversion-${randomUUID()}`
      seeds.push(seed)
      const delivered = await harness.service.deliver(input(seed))
      expect(delivered.result).toBe("served")
      const run = await db.recommendationCandidateRun.findUniqueOrThrow({
        where: { requestId: delivered.requestId! },
      })
      await db.$executeRaw`UPDATE recommendation_request SET created_at=clock_timestamp()-interval '20 days' WHERE id=${run.requestId}`
      await db.$executeRaw`UPDATE recommendation_candidate_run SET created_at=clock_timestamp()-interval '20 days' WHERE id=${run.id}`
      return run
    }
    async function freeze(runId: string) {
      return freezeConversionManifest(db, {
        runIds: [runId],
        createdBefore: cutoff,
        holds,
      })
    }

    it("preserves every typed stage field, nested JSON, parent rows and full reader detail; dry run and restart do not delete", async () => {
      const run = await fixture()
      await db.$executeRaw`UPDATE recommendation_candidate_stage_evidence
      SET source_evidence='[{"generator":"semantic","rank":1,"evidence":{"number":9007199254740993123456789,"nullable":null,"nested":[0.12345678901234567890123]}}]'::jsonb
      WHERE run_id=${run.id} AND stage='nominated' AND ordinal=0`
      const before = await loadRecommendationRequestDetail(db, {
        requestId: run.requestId,
        actorDigest: "a".repeat(64),
      })
      // Reader writes an access audit, which is intentionally an exclusion. Remove
      // only this test's audit to compare the two encodings in a disposable DB.
      await db.recommendationTraceAccessAudit.deleteMany({
        where: { requestId: run.requestId },
      })
      const [stages] = await db.$queryRaw<Array<{ snapshot: string }>>`
      SELECT jsonb_agg(to_jsonb(e) ORDER BY stage,ordinal)::text AS snapshot
      FROM recommendation_candidate_stage_evidence e WHERE run_id=${run.id}`
      const itemsBefore = await db.recommendationServedItem.findMany({
        where: { requestId: run.requestId },
      })
      const manifest = await freeze(run.id)
      expect(await convertLegacyCandidateTraces(db, manifest)).toMatchObject({
        status: "dry-run",
        converted: 0,
        skipped: 0,
      })
      expect(
        await db.recommendationCandidateStageEvidence.count({
          where: { runId: run.id },
        }),
      ).toBe(manifest.candidates[0].rows)
      expect(
        await convertLegacyCandidateTraces(db, manifest, {
          execute: true,
          confirmTarget: manifest.targetDatabaseHash,
        }),
      ).toMatchObject({ converted: 1 })
      const converted = await db.recommendationCandidateRun.findUniqueOrThrow({
        where: { id: run.id },
      })
      expect(converted.traceFormatVersion).toBe(1)
      expect(converted.expiresAt).toEqual(run.expiresAt)
      expect(
        await db.recommendationCandidateStageEvidence.count({
          where: { runId: run.id },
        }),
      ).toBe(0)
      const after = await loadRecommendationRequestDetail(db, {
        requestId: run.requestId,
        actorDigest: "a".repeat(64),
      })
      expect(after?.candidateExecution).toEqual(before?.candidateExecution)
      expect(
        await db.recommendationServedItem.findMany({
          where: { requestId: run.requestId },
        }),
      ).toEqual(itemsBefore)
      const [encoded] = await db.$queryRaw<
        Array<{ snapshot: string }>
      >(Prisma.sql`
      SELECT jsonb_agg(jsonb_build_object(
        'id', v->'id', 'run_id', c.id, 'stage', v->'stage', 'ordinal', v->'ordinal',
        'candidate_key', v->'candidateKey', 'target_media_id', v->'targetMediaId',
        'source_generator', v->'sourceGenerator', 'source_rank', v->'sourceRank',
        'source_score', v->'sourceScore', 'normalized_score', v->'normalizedScore',
        'rrf_score', v->'rrfScore', 'deterministic_score', v->'deterministicScore',
        'final_position', v->'finalPosition', 'reason_codes', v->'reasonCodes',
        'source_evidence', v->'sourceEvidence', 'created_at', (v->>'createdAt')::timestamptz,
        'expires_at', c.expires_at
      ) ORDER BY v->>'stage',(v->>'ordinal')::integer)::text AS snapshot
      FROM recommendation_candidate_run c, jsonb_array_elements(c.trace_payload->'stages') v WHERE c.id=${run.id}
    `)
      expect(encoded.snapshot).toBe(stages.snapshot)
      expect(
        await convertLegacyCandidateTraces(db, manifest, {
          execute: true,
          confirmTarget: manifest.targetDatabaseHash,
        }),
      ).toMatchObject({ converted: 0, skipped: 1 })
    })

    it("rejects ineligible counters, timestamp precision, incomplete and curated evidence without modifying stages", async () => {
      for (const change of [
        "counter",
        "precision",
        "incomplete",
        "curated",
      ] as const) {
        const run = await fixture()
        if (change === "counter")
          await db.$executeRaw`UPDATE recommendation_candidate_run SET nominated_count=nominated_count+1 WHERE id=${run.id}`
        if (change === "precision")
          await db.$executeRaw`UPDATE recommendation_candidate_stage_evidence SET created_at=date_trunc('milliseconds',created_at)+interval '1 microsecond' WHERE run_id=${run.id}`
        if (change === "incomplete")
          await db.$executeRaw`UPDATE recommendation_candidate_run SET evidence_complete=false WHERE id=${run.id}`
        if (change === "curated")
          await db.$executeRaw`UPDATE recommendation_candidate_run SET generator_version='seeded-curated-empty-fallback-v1' WHERE id=${run.id}`
        await expect(freeze(run.id)).rejects.toThrow("ineligible")
        expect(
          (
            await db.recommendationCandidateRun.findUniqueOrThrow({
              where: { id: run.id },
            })
          ).traceFormatVersion,
        ).toBeNull()
        expect(
          await db.recommendationCandidateStageEvidence.count({
            where: { runId: run.id },
          }),
        ).toBeGreaterThan(0)
      }
    })

    it("preserves database expiry guards instead of manufacturing invalid source rows", async () => {
      const run = await fixture()
      await expect(
        db.$executeRaw`UPDATE recommendation_request SET expires_at=expires_at-interval '1 second' WHERE id=${run.requestId}`,
      ).rejects.toThrow("immutable")
      await expect(
        db.$executeRaw`UPDATE recommendation_candidate_stage_evidence SET expires_at=expires_at-interval '1 second' WHERE run_id=${run.id}`,
      ).rejects.toThrow("expiry")
      const manifest = await freeze(run.id)
      expect(await convertLegacyCandidateTraces(db, manifest)).toMatchObject({
        status: "dry-run",
        skipped: 0,
      })
    })

    it("rechecks holds, target and late access evidence", async () => {
      const run = await fixture()
      const manifest = await freeze(run.id)
      await expect(
        convertLegacyCandidateTraces(db, manifest, {
          execute: true,
          confirmTarget: "wrong",
        }),
      ).rejects.toThrow("confirmation")
      const held = {
        ...manifest,
        holds: { ...manifest.holds, activeInvestigationRunIds: [run.id] },
      }
      const { digest: previousDigest, ...body } = held
      expect(previousDigest).toBe(manifest.digest)
      held.digest = conversionManifestDigest(body)
      await expect(convertLegacyCandidateTraces(db, held)).rejects.toThrow()
      await loadRecommendationRequestDetail(db, {
        requestId: run.requestId,
        actorDigest: "a".repeat(64),
      })
      expect(
        await convertLegacyCandidateTraces(db, manifest, {
          execute: true,
          confirmTarget: manifest.targetDatabaseHash,
        }),
      ).toMatchObject({ converted: 0, skipped: 1 })
    })

    it("rolls back the whole manifest when the second deletion count disagrees", async () => {
      const runs = [await fixture(), await fixture()].sort((a, b) =>
        a.id.localeCompare(b.id),
      )
      const run = runs[1]
      const manifest = await freezeConversionManifest(db, {
        runIds: runs.map((item) => item.id),
        createdBefore: cutoff,
        holds,
      })
      const name = `conversion_block_${randomUUID().replaceAll("-", "")}`
      await controller.query(
        `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END'`,
      )
      await controller.query(
        `CREATE TRIGGER "${name}" BEFORE DELETE ON recommendation_candidate_stage_evidence FOR EACH ROW WHEN (OLD.run_id='${run.id.replaceAll("'", "''")}') EXECUTE FUNCTION "${name}"()`,
      )
      try {
        await expect(
          convertLegacyCandidateTraces(db, manifest, {
            execute: true,
            confirmTarget: manifest.targetDatabaseHash,
          }),
        ).rejects.toThrow("count mismatch")
        for (const candidate of manifest.candidates) {
          expect(
            (
              await db.recommendationCandidateRun.findUniqueOrThrow({
                where: { id: candidate.runId },
              })
            ).tracePayload,
          ).toBeNull()
          expect(
            await db.recommendationCandidateStageEvidence.count({
              where: { runId: candidate.runId },
            }),
          ).toBe(candidate.rows)
        }
      } finally {
        await controller.query(
          `DROP TRIGGER "${name}" ON recommendation_candidate_stage_evidence`,
        )
        await controller.query(`DROP FUNCTION "${name}"()`)
      }
    })

    it("backs off under the retention advisory lock and safely skips a root purged by real retention", async () => {
      const run = await fixture()
      const manifest = await freeze(run.id)
      await controller.query("BEGIN")
      await controller.query("SELECT pg_advisory_xact_lock(368000001)")
      try {
        expect(
          await convertLegacyCandidateTraces(db, manifest, {
            execute: true,
            confirmTarget: manifest.targetDatabaseHash,
          }),
        ).toMatchObject({ status: "retention-busy", converted: 0 })
      } finally {
        await controller.query("ROLLBACK")
      }
      // The production root lifecycle is immutable. Exercise the real retention
      // entrypoint with a future clock, only after proving this disposable database
      // contains no request roots outside this suite's owned fixture seeds.
      expect(
        await db.recommendationRequest.count({
          where: { seedMediaId: { notIn: seeds } },
        }),
      ).toBe(0)
      const purged = await purgeExpiredRecommendationRequests(
        db,
        new Date(run.expiresAt.getTime() + 1_000),
        100,
      )
      expect(purged.rootsDeleted).toBeGreaterThan(0)
      expect(
        await db.recommendationCandidateRun.findUnique({
          where: { id: run.id },
        }),
      ).toBeNull()
      expect(
        await convertLegacyCandidateTraces(db, manifest, {
          execute: true,
          confirmTarget: manifest.targetDatabaseHash,
        }),
      ).toMatchObject({ converted: 0, skipped: 1 })
    })
  },
)
