import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { writeFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { resolve } from "node:path"
import { createInterface } from "node:readline"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createPrismaClient } from "./client"
import { observeRecommendationRuntime } from "../lib/recommendation-runtime-observation"
import { persistCandidateStageEvidence } from "../services/recommendations/candidate-evidence-persistence"
import { runRecommendationDeliveryTransaction } from "../services/recommendations/delivery-runtime"
import {
  input,
  makeHarness,
  semanticCandidates,
} from "../services/recommendations/delivery.service.test-helpers"

// Full migrations on an owned database only. The sampler is deliberately a
// separate OS process: an in-process timer cannot observe a blocked Node loop.
describe.skipIf(process.env.RECOMMENDATION_DB_TEST !== "1")(
  "independent recommendation wait attribution",
  () => {
    const prisma = createPrismaClient("main")
    const controller = new Client({
      connectionString: process.env.DATABASE_URL,
    })
    const seeds: string[] = []
    const evidence: unknown[] = []
    function capture(
      scenario: string,
      runtime: Record<string, unknown>,
      records: Array<Record<string, unknown>>,
    ) {
      evidence.push({
        scenario,
        observationId: runtime.observationId,
        elapsedMs: runtime.elapsedMs,
        databaseTransactions: runtime.databaseTransactions,
        timings: runtime.timings,
        samples: records.filter(
          (row) => row.observationId === runtime.observationId,
        ),
      })
    }
    let rows: Parameters<typeof persistCandidateStageEvidence>[1] = []
    beforeAll(async () => {
      await controller.connect()
      const harness = makeHarness({ database: prisma })
      harness.retrieve.mockResolvedValue(semanticCandidates(64))
      const seed = `wait-fixture-${randomUUID()}`
      seeds.push(seed)
      const response = await harness.service.deliver(input(seed))
      expect(response.result).toBe("served")
      const run = await prisma.recommendationCandidateRun.findUniqueOrThrow({
        where: { requestId: response.requestId! },
      })
      rows = (
        await prisma.recommendationCandidateStageEvidence.findMany({
          where: { runId: run.id },
          orderBy: { ordinal: "asc" },
          take: 220,
        })
      ).map((row) => ({ ...row, sourceEvidence: row.sourceEvidence ?? {} }))
      expect(rows).toHaveLength(220)
    })
    afterAll(async () => {
      await controller.query("ROLLBACK")
      await controller.query(
        "DROP TRIGGER IF EXISTS watch_m4q_delay ON recommendation_candidate_stage_evidence",
      )
      await controller.query("DROP FUNCTION IF EXISTS watch_m4q_delay()")
      await prisma.recommendationRequest.deleteMany({
        where: { seedMediaId: { in: seeds } },
      })
      await prisma.$disconnect()
      await controller.end()
      if (process.env.WATCH_WAIT_REPRO_OUTPUT)
        writeFileSync(
          process.env.WATCH_WAIT_REPRO_OUTPUT,
          JSON.stringify(
            {
              capturedAt: new Date().toISOString(),
              fixture:
                "Owned PostgreSQL 18, all 98 migrations, real Prisma adapter and evidence writes. Lock blocks full issuance; server/application cases rewrite exactly 220 existing evidence rows. Delays are injected and are not proof of the production cause.",
              evidence,
            },
            null,
            2,
          ),
        )
    })

    async function observer() {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("src/scripts/sample-recommendation-db-waits.ts"),
          "15000",
          "100",
        ],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      )
      const lines = createInterface({ input: child.stdout })
      const records: Array<Record<string, unknown>> = []
      const exit = once(child, "exit")
      let ready!: () => void
      const started = new Promise<void>((resolve) => {
        ready = resolve
      })
      lines.on("line", (line) => {
        const record = JSON.parse(line) as Record<string, unknown>
        records.push(record)
        if (record.event === "recommendation.database_wait_ready") ready()
      })
      let readyTimer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          started,
          exit.then(() => {
            throw new Error("Independent observer exited before readiness")
          }),
          new Promise<never>((_, reject) => {
            readyTimer = setTimeout(
              () =>
                reject(new Error("Independent observer readiness timed out")),
              5000,
            )
            readyTimer.unref()
          }),
        ])
      } catch (error) {
        child.kill("SIGTERM")
        await exit
        lines.close()
        throw error
      } finally {
        clearTimeout(readyTimer)
      }
      return {
        records,
        stop: async () => {
          child.kill("SIGTERM")
          await exit
          lines.close()
        },
      }
    }

    async function rewriteBatch(work?: () => Promise<void>) {
      let runtime: Record<string, unknown> = {}
      await observeRecommendationRuntime(
        "seeded",
        () =>
          runRecommendationDeliveryTransaction(
            prisma,
            Date.now() + 1500,
            async (tx) => {
              await tx.recommendationCandidateStageEvidence.deleteMany({
                where: { id: { in: rows.map((row) => row.id) } },
              })
              const [inserted] = await Promise.all([
                persistCandidateStageEvidence(tx, rows),
                work?.(),
              ])
              expect(inserted).toBe(220)
            },
            Date.now,
          ),
        (line) => {
          runtime = JSON.parse(line)
        },
      )
      return runtime
    }

    it("identifies a lock wait and preserves rollback instead of reporting a slow successful write", async () => {
      const sample = await observer()
      const log = vi.spyOn(console, "info").mockImplementation(() => {})
      const seed = `wait-rollback-${randomUUID()}`
      seeds.push(seed)
      await controller.query("BEGIN")
      await controller.query(
        "LOCK TABLE recommendation_candidate_stage_evidence IN ACCESS EXCLUSIVE MODE",
      )
      try {
        const harness = makeHarness({ database: prisma })
        harness.retrieve.mockResolvedValue(semanticCandidates(64))
        const response = await harness.service.deliver(input(seed))
        expect(response).toMatchObject({
          result: "unavailable",
          reason: "delivery_timeout",
        })
        const runtime = log.mock.calls
          .map(([line]) => JSON.parse(String(line)))
          .find((row) => row.phase === "complete")
        expect(
          sample.records.some(
            (row) =>
              row.observationId === runtime.observationId &&
              row.statementCategory === "candidate_evidence.insert" &&
              row.waitType === "Lock" &&
              Number(row.blockerCount) > 0,
          ),
        ).toBe(true)
        capture("table_lock", runtime, sample.records)
      } finally {
        await controller.query("ROLLBACK")
        await sample.stop()
        log.mockRestore()
      }
      expect(
        await prisma.recommendationRequest.count({
          where: { seedMediaId: seed },
        }),
      ).toBe(0)
    }, 15000)

    it("identifies server execution delay during the actual 220-row insert", async () => {
      await controller.query(
        "CREATE FUNCTION watch_m4q_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.4); RETURN NULL; END $$",
      )
      await controller.query(
        "CREATE TRIGGER watch_m4q_delay BEFORE INSERT ON recommendation_candidate_stage_evidence FOR EACH STATEMENT EXECUTE FUNCTION watch_m4q_delay()",
      )
      const sample = await observer()
      try {
        const runtime = await rewriteBatch()
        expect(
          sample.records.some(
            (row) =>
              row.observationId === runtime.observationId &&
              row.statementCategory === "candidate_evidence.insert" &&
              row.waitType === "Timeout" &&
              row.waitEvent === "PgSleep",
          ),
        ).toBe(true)
        capture("server_sleep", runtime, sample.records)
      } finally {
        await sample.stop()
        await controller.query(
          "DROP TRIGGER watch_m4q_delay ON recommendation_candidate_stage_evidence",
        )
        await controller.query("DROP FUNCTION watch_m4q_delay()")
      }
    }, 15000)

    it("observes PostgreSQL already idle while the application's event loop is blocked", async () => {
      // Hold the server briefly so the parent can pause while the driver call
      // is outstanding. PostgreSQL then finishes during the application pause.
      await controller.query(
        "CREATE FUNCTION watch_m4q_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.3); RETURN NULL; END $$",
      )
      await controller.query(
        "CREATE TRIGGER watch_m4q_delay BEFORE INSERT ON recommendation_candidate_stage_evidence FOR EACH STATEMENT EXECUTE FUNCTION watch_m4q_delay()",
      )
      const sample = await observer()
      try {
        const runtime = await rewriteBatch(async () => {
          await vi.waitFor(
            () => {
              expect(
                sample.records.some((row) => row.waitEvent === "PgSleep"),
              ).toBe(true)
            },
            { timeout: 1000, interval: 10 },
          )
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400)
        })
        // Flush buffered child output after the parent's deliberate loop pause.
        await sample.stop()
        expect(
          sample.records.some(
            (row) =>
              row.observationId === runtime.observationId &&
              row.statementCategory === "candidate_evidence.insert" &&
              row.state === "idle in transaction" &&
              row.waitEvent === "ClientRead",
          ),
        ).toBe(true)
        const timings = runtime.timings as Record<string, { elapsedMs: number }>
        expect(timings["candidate_evidence.insert"].elapsedMs).toBeGreaterThan(
          400,
        )
        capture("application_loop_block", runtime, sample.records)
      } finally {
        await sample.stop()
        await controller.query(
          "DROP TRIGGER watch_m4q_delay ON recommendation_candidate_stage_evidence",
        )
        await controller.query("DROP FUNCTION watch_m4q_delay()")
      }
    }, 15000)

    it("restores a reused connection's application name after commit and rollback", async () => {
      const reused = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: process.env.DATABASE_URL,
          application_name: "watch-observer-test-base",
          max: 1,
        }),
      })
      try {
        for (const fail of [false, true]) {
          let backendPid = 0
          const result = observeRecommendationRuntime(
            "seeded",
            () =>
              runRecommendationDeliveryTransaction(
                reused,
                Date.now() + 1500,
                async (tx) => {
                  const [row] = await tx.$queryRaw<
                    Array<{ name: string; pid: number }>
                  >`SELECT current_setting('application_name') AS name, pg_backend_pid() AS pid`
                  expect(row.name).toMatch(/^watch:[a-f0-9-]{36}:1$/)
                  backendPid = row.pid
                  if (fail) throw new Error("Injected callback failure")
                },
                Date.now,
              ),
            () => {},
          )
          if (fail)
            await expect(result).rejects.toThrow("Injected callback failure")
          else await result
          const after = await reused.$queryRaw<
            Array<{ pid: number; name: string }>
          >`SELECT pg_backend_pid() AS pid, current_setting('application_name') AS name`
          expect(after[0]).toEqual({
            pid: backendPid,
            name: "watch-observer-test-base",
          })
        }
      } finally {
        await reused.$disconnect()
      }
    })
  },
)
