import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import { loadRecommendationRequestDetail } from "./admin-ops/detail.service"
import { purgeExpiredRecommendationRequests } from "./retention.service"
import {
  makeHarness,
  input,
  semanticCandidates,
} from "./delivery.service.test-helpers"

const sql = readFileSync(
  new URL("./sql/reclaim-empty-legacy-stage-relation.sql", import.meta.url),
  "utf8",
)
const lockEnd = sql.indexOf("DO $reclamation$")
const beforeAssertion = sql.slice(0, lockEnd)
const afterLock = sql.slice(lockEnd)
const enabled = env.RECOMMENDATION_DB_TEST === "1"

function disposableDatabaseUrl(value: string): URL {
  const url = new URL(value)
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^\/forge_legacy_reclamation_[a-z0-9_]+$/.test(url.pathname) ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "Reclamation proof requires its own loopback forge_legacy_reclamation_* database without query parameters or fragments",
    )
  }
  return url
}

it("rejects connection-query destination overrides without creating a client", () => {
  for (const override of [
    "host=remote.example",
    "port=5432",
    "database=other",
    "dbname=other",
    "service=production",
  ]) {
    expect(() =>
      disposableDatabaseUrl(
        `postgresql://test:test@127.0.0.1:55455/forge_legacy_reclamation_guard?${override}`,
      ),
    ).toThrow("without query parameters")
  }
})

// This proof truncates a whole relation: require an explicitly named, loopback
// disposable database, not merely the general real-DB test opt-in.
describe.skipIf(!enabled)(
  "empty legacy stage reclamation PostgreSQL proof",
  () => {
    const url = disposableDatabaseUrl(
      enabled
        ? env.DATABASE_URL
        : "postgresql://test:test@127.0.0.1/forge_legacy_reclamation_skipped",
    )
    // Import the singleton-bearing module only after destination validation.
    let db: PrismaClient
    const controller = new Client({ connectionString: url.toString() })
    const seeds: string[] = []
    const evaluations: string[] = []
    async function cleanup() {
      await controller.query("ROLLBACK")
      await db.recommendationRequest.deleteMany({
        where: { seedMediaId: { in: seeds } },
      })
      await db.recommendationControlEvaluation.deleteMany({
        where: { id: { in: evaluations } },
      })
      expect(await db.recommendationCandidateStageEvidence.count()).toBe(0)
    }
    beforeAll(async () => {
      const { createPrismaClient } = await import("@/db/client")
      db = createPrismaClient("main")
      await controller.connect()
      // Refuse pre-existing request data even if someone gave a shared DB a matching name.
      expect(await db.recommendationRequest.count()).toBe(0)
    })
    beforeEach(cleanup)
    afterAll(async () => {
      try {
        await cleanup()
      } finally {
        try {
          await db.$disconnect()
        } finally {
          await controller.end()
        }
      }
    })
    async function fixture(format: "legacy" | "compact", count = 6) {
      const harness = makeHarness({
        database: db,
        candidateTraceFormat: format,
      })
      harness.retrieve.mockResolvedValue(semanticCandidates(count))
      const seed = `reclamation-${randomUUID()}`
      seeds.push(seed)
      const delivered = await harness.service.deliver(input(seed))
      expect(delivered.result).toBe("served")
      return db.recommendationCandidateRun.findUniqueOrThrow({
        where: { requestId: delivered.requestId! },
      })
    }
    async function snapshot(requestId: string) {
      const detail = await loadRecommendationRequestDetail(db, {
        requestId,
        actorDigest: "a".repeat(64),
      })
      expect(detail).not.toBeNull()
      const rows = await controller.query<{ snapshot: string }>(
        `
      SELECT jsonb_build_object(
        'request',to_jsonb(r), 'runs',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM recommendation_candidate_run c WHERE request_id=r.id),
        'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM recommendation_served_item i WHERE request_id=r.id),
        'stages',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM recommendation_candidate_stage_evidence e JOIN recommendation_candidate_run c ON c.id=e.run_id WHERE c.request_id=r.id),
        'selections',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM recommendation_selection s WHERE request_id=r.id),
        'episodes',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM recommendation_playback_episode p WHERE request_id=r.id),
        'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM recommendation_outcome_revision o WHERE request_id=r.id),
        'evaluations',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM recommendation_control_evaluation v)
      )::text AS snapshot FROM recommendation_request r WHERE r.id=$1`,
        [requestId],
      )
      return { detail, stored: rows.rows[0].snapshot }
    }
    async function allocation() {
      const result = await controller.query<{
        bytes: string
        filenode: number
      }>(`
      SELECT pg_total_relation_size('public.recommendation_candidate_stage_evidence')::text AS bytes,
      pg_relation_filenode('public.recommendation_candidate_stage_evidence') AS filenode`)
      return {
        bytes: Number(result.rows[0].bytes),
        filenode: result.rows[0].filenode,
      }
    }
    async function connection() {
      const client = new Client({ connectionString: url.toString() })
      await client.connect()
      return client
    }
    // Deterministic database coordination, not a sleep that assumes a query reached its lock.
    async function waitForLock(client: Client) {
      const { rows } = await client.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      )
      return rows[0].pid
    }
    async function assertWaiting(pid: number) {
      const deadline = Date.now() + 800
      while (Date.now() < deadline) {
        const { rows } = await controller.query<{ waiting: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting",
          [pid],
        )
        if (rows[0].waiting) return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error("Expected a blocked relation-lock request")
    }

    it("refuses nonempty evidence with every stage and parent unchanged", async () => {
      const run = await fixture("legacy")
      const before = await snapshot(run.requestId)
      await expect(controller.query(sql)).rejects.toMatchObject({
        code: "P0001",
      })
      await controller.query("ROLLBACK")
      expect(await snapshot(run.requestId)).toEqual(before)
    })

    it("times out under a reader lock, rolls back and permits a deliberate later retry", async () => {
      const blocker = await connection()
      try {
        await blocker.query("BEGIN")
        await blocker.query(
          "SELECT 1 FROM recommendation_candidate_stage_evidence LIMIT 1",
        )
        const before = await allocation()
        const started = performance.now()
        await expect(controller.query(sql)).rejects.toMatchObject({
          code: "55P03",
        })
        expect(performance.now() - started).toBeGreaterThanOrEqual(900)
        await controller.query("ROLLBACK")
        expect(await allocation()).toEqual(before)
        await blocker.query("ROLLBACK")
        await controller.query(sql)
        expect(await db.recommendationCandidateStageEvidence.count()).toBe(0)
      } finally {
        await blocker.query("ROLLBACK")
        await blocker.end()
      }
    })

    it("checks evidence committed by a writer before the exclusive lock is granted", async () => {
      const run = await fixture("legacy")
      const original = await controller.query<{ row: object }>(
        "SELECT to_jsonb(e) AS row FROM recommendation_candidate_stage_evidence e WHERE run_id=$1 LIMIT 1",
        [run.id],
      )
      await db.recommendationCandidateStageEvidence.deleteMany({
        where: { runId: run.id },
      })
      expect(await db.recommendationCandidateStageEvidence.count()).toBe(0)
      const writer = await connection()
      const reclaim = await connection()
      try {
        await writer.query("BEGIN")
        await writer.query(
          "INSERT INTO recommendation_candidate_stage_evidence SELECT * FROM jsonb_populate_record(NULL::recommendation_candidate_stage_evidence,$1::jsonb)",
          [JSON.stringify(original.rows[0].row)],
        )
        const pid = await waitForLock(reclaim)
        const pending = reclaim.query(sql).then(
          () => null,
          (error: unknown) => error,
        )
        await assertWaiting(pid)
        await writer.query("COMMIT")
        expect(await pending).toMatchObject({ code: "P0001" })
        await reclaim.query("ROLLBACK")
        const rows = await db.recommendationCandidateStageEvidence.findMany({
          where: { runId: run.id },
        })
        expect(rows).toHaveLength(1)
        expect(
          (
            await controller.query<{ row: object }>(
              "SELECT to_jsonb(e) AS row FROM recommendation_candidate_stage_evidence e WHERE run_id=$1",
              [run.id],
            )
          ).rows,
        ).toEqual(original.rows)
      } finally {
        await writer.query("ROLLBACK")
        await reclaim.query("ROLLBACK")
        await writer.end()
        await reclaim.end()
      }
    })

    it("blocks a late legacy writer until truncate commits, preserving its new evidence and dual reader", async () => {
      // Capture a real legacy row and parent, then remove only that fixture's evidence.
      const run = await fixture("legacy")
      const { rows } = await controller.query<{ row: object }>(
        "SELECT to_jsonb(e) AS row FROM recommendation_candidate_stage_evidence e WHERE run_id=$1 LIMIT 1",
        [run.id],
      )
      await db.recommendationCandidateStageEvidence.deleteMany({
        where: { runId: run.id },
      })
      const writer = await connection()
      const observer = await connection()
      let insertion:
        | Promise<{ ok: true } | { ok: false; error: unknown }>
        | undefined
      try {
        await controller.query(beforeAssertion)
        expect(
          (
            await controller.query(
              "SELECT current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement",
            )
          ).rows,
        ).toEqual([{ lock: "1s", statement: "10s" }])
        const pid = await waitForLock(writer)
        // Bound settling even if an assertion or rollback fails. Attach the
        // rejection handler immediately while the writer waits behind our lock.
        await writer.query("SET statement_timeout='3s'")
        insertion = writer
          .query(
            `INSERT INTO recommendation_candidate_stage_evidence SELECT * FROM jsonb_populate_record(NULL::recommendation_candidate_stage_evidence,$1::jsonb)`,
            [JSON.stringify(rows[0].row)],
          )
          .then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ ok: false as const, error }),
          )
        // Controller holds the lock; use the independent observer for lock inspection.
        const deadline = Date.now() + 800
        let waiting = false
        while (!waiting && Date.now() < deadline) {
          const result = await observer.query<{ waiting: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting",
            [pid],
          )
          waiting = result.rows[0].waiting
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(waiting).toBe(true)
        await controller.query(afterLock)
        const inserted = await insertion
        if (!inserted.ok) throw inserted.error
        expect(
          await db.recommendationCandidateStageEvidence.count({
            where: { runId: run.id },
          }),
        ).toBe(1)
        // Fresh ordinary legacy issuance remains valid after reclamation.
        const fresh = await fixture("legacy")
        const detail = await snapshot(fresh.requestId)
        expect(detail.detail?.candidateExecution).not.toBeNull()
        expect(
          await db.recommendationCandidateStageEvidence.count({
            where: { runId: fresh.id },
          }),
        ).toBeGreaterThan(0)
      } finally {
        try {
          await controller.query("ROLLBACK")
        } finally {
          await insertion
          await Promise.all([writer.end(), observer.end()])
        }
      }
    })

    it("reclaims allocated empty files after real expiry without changing compact detail, outcomes or evaluation", async () => {
      const legacy = []
      for (let i = 0; i < 5; i++) legacy.push(await fixture("legacy", 64))
      const compact = await fixture("compact")
      const item = await db.recommendationServedItem.findFirstOrThrow({
        where: { requestId: compact.requestId },
      })
      const episodeId = randomUUID()
      const selectionId = randomUUID()
      await controller.query(
        `INSERT INTO recommendation_selection
      (id,request_id,item_id,capability_jti,event_id,payload_digest,claim_nonce_digest,handoff_expires_at,occurred_at,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '5 minutes',now(),$8)`,
        [
          selectionId,
          compact.requestId,
          item.id,
          randomUUID(),
          randomUUID(),
          "e".repeat(64),
          "f".repeat(64),
          compact.expiresAt,
        ],
      )
      await controller.query(
        `INSERT INTO recommendation_playback_episode
      (id,request_id,item_id,media_id,session_digest,state,capability_jti,signing_kid,active_until,hard_until,generation,claimed_at,expires_at,selection_id)
      VALUES ($1,$2,$3,$4,$5,'claimed',$6,'test-kid',now()+interval '1 hour',now()+interval '2 hours',1,now(),$7,$8)`,
        [
          episodeId,
          compact.requestId,
          item.id,
          item.targetMediaId,
          "a".repeat(64),
          randomUUID(),
          compact.expiresAt,
          selectionId,
        ],
      )
      await controller.query(
        `INSERT INTO recommendation_outcome_revision
      (id,request_id,item_id,episode_id,classifier_version,fact_watermark,input_digest,revision,qualified_view,view_quality_weight_reason,learning_eligible,generation,expires_at)
      VALUES ($1,$2,$3,$4,'legacy-position-v0',0,$5,1,false,'continuous_weight_not_available',false,1,$6)`,
        [
          randomUUID(),
          compact.requestId,
          item.id,
          episodeId,
          "b".repeat(64),
          compact.expiresAt,
        ],
      )
      const evaluationId = randomUUID()
      evaluations.push(evaluationId)
      await controller.query(
        `INSERT INTO recommendation_control_evaluation
      (id,manifest_id,strategy_version,contract_version,surface_version,generator,serving_control_version,policy_version,outcome_policy_version,classifier_version,integrity_policy_version,manifest_digest,
      window_start,window_end,input_captured_at,input_digest,revision,state,delivery_outcome,attribution_outcome,maturity_outcome,operational_outcome,mission_outcome,guardrail_outcome,evidence,rates,uncertainty,policy_configuration,explanation,evaluated_at,expires_at)
      VALUES ($1,'semantic-transcript-pgvector-v1','semantic-transcript-pgvector-v1','semantic-recommendation-v1','watch-below-player-v1','semantic',1,'semantic-control-readiness-v1','watch-semantic-control-outcomes-v1','active-watch-proxy-v1','recommendation-integrity-v1',$2,
      now()-interval '8 days',now()-interval '1 day',now(),$3,1,'ready','pass','pass','pass','pass','pass','pass','{}','{}','{}','{}','Reclamation fixture',now(),now()+interval '365 days')`,
        [evaluationId, "c".repeat(64), "d".repeat(64)],
      )
      const catalogSql = `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='recommendation_candidate_stage_evidence' ORDER BY indexname`
      const catalogBefore = (await controller.query(catalogSql)).rows
      expect(
        catalogBefore.some(
          (index) =>
            index.indexname === "recommendation_candidate_stage_ordinal_key",
        ),
      ).toBe(true)
      const stagesBeforePurge =
        await db.recommendationCandidateStageEvidence.count()
      expect(stagesBeforePurge).toBeGreaterThan(1000)
      const before = await snapshot(compact.requestId)
      const cutoff = new Date(
        Math.max(...legacy.map((run) => run.expiresAt.getTime())),
      )
      expect(cutoff.getTime()).toBeLessThan(compact.expiresAt.getTime())
      const beforeAllocated = await allocation()
      const legacyPurge = await purgeExpiredRecommendationRequests(db, cutoff)
      expect(legacyPurge.rootsDeleted).toBe(legacy.length)
      expect(legacyPurge.rowCounts.candidateStageEvidence).toBe(
        stagesBeforePurge,
      )
      for (const run of legacy) {
        expect(
          await db.recommendationCandidateRun.findUnique({
            where: { id: run.id },
          }),
        ).toBeNull()
      }
      expect(await db.recommendationCandidateStageEvidence.count()).toBe(0)
      const emptied = await allocation()
      expect(emptied.bytes).toBeGreaterThan(0)
      expect(emptied.bytes).toBe(beforeAllocated.bytes)
      await controller.query(sql)
      const reclaimed = await allocation()
      expect(reclaimed.bytes).toBeLessThan(emptied.bytes)
      expect((await controller.query(catalogSql)).rows).toEqual(catalogBefore)
      expect(await snapshot(compact.requestId)).toEqual(before)
      console.info(
        JSON.stringify({
          event: "legacy-stage-reclamation.fixture",
          beforeDeleteBytes: beforeAllocated.bytes,
          emptyAllocatedBytes: emptied.bytes,
          afterTruncateBytes: reclaimed.bytes,
          reclaimedRelationBytes: emptied.bytes - reclaimed.bytes,
        }),
      )
      const purge = await purgeExpiredRecommendationRequests(
        db,
        new Date(compact.expiresAt.getTime() + 1),
      )
      expect(purge.rootsDeleted).toBeGreaterThan(0)
      expect(
        await db.recommendationCandidateRun.findUnique({
          where: { id: compact.id },
        }),
      ).toBeNull()
      expect(
        await db.recommendationOutcomeRevision.count({
          where: { requestId: compact.requestId },
        }),
      ).toBe(0)
    }, 30000)

    it("restores the relation after failure following truncate and rejects new inbound foreign keys without CASCADE", async () => {
      const before = await allocation()
      const injectedFailure = sql.replace("COMMIT;", "SELECT 1/0; COMMIT;")
      await expect(controller.query(injectedFailure)).rejects.toMatchObject({
        code: "22012",
      })
      await controller.query("ROLLBACK")
      expect(await allocation()).toEqual(before)
      await controller.query(
        "CREATE TABLE reclamation_inbound_fixture (stage_id text REFERENCES recommendation_candidate_stage_evidence(id))",
      )
      try {
        await expect(controller.query(sql)).rejects.toMatchObject({
          code: "0A000",
        })
        await controller.query("ROLLBACK")
        expect(await allocation()).toEqual(before)
        expect(
          (
            await controller.query(
              "SELECT to_regclass('reclamation_inbound_fixture') AS relation",
            )
          ).rows[0].relation,
        ).not.toBeNull()
      } finally {
        await controller.query("DROP TABLE reclamation_inbound_fixture")
      }
    })
  },
)
