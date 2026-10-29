import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { setTimeout as delay } from "node:timers/promises"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { MANAGER_BACKEND_PRINCIPAL as user } from "@/auth/principal"
import { ManagerExecutionService } from "./manager-execution.service"
import { ManagerJobService } from "./manager-job.service"

const databaseUrl = env.MANAGER_EXECUTION_TEST_DATABASE_URL
const input = {
  jobId: "fence-job",
  runId: "run-1",
  inputDigest: "a".repeat(64),
  operationId: "run-admission",
  operationDigest: "b".repeat(64),
}

// Opt-in and isolated: applies the actual three migrations to a unique schema.
// No providers, production databases, vector extension, or full catalog needed.
describe.skipIf(!databaseUrl)("Manager execution fence on Postgres", () => {
  const schema = `execution_${randomUUID().replaceAll("-", "")}`
  let admin: Client
  let left: PrismaClient
  let right: PrismaClient
  let a: ManagerExecutionService
  let b: ManagerExecutionService
  let fixtureUrl: string

  beforeAll(async () => {
    const target = new URL(databaseUrl!)
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      !target.pathname.endsWith("_test")
    ) {
      throw new Error(
        "Manager execution DB tests require an explicit loopback _test database",
      )
    }
    admin = new Client({ connectionString: databaseUrl })
    await admin.connect()
    await admin.query(`CREATE SCHEMA "${schema}"`)
    await admin.query(`SET search_path TO "${schema}"`)
    for (const migration of [
      "0017_manager_backend_contracts",
      "0166_manager_execution_operations",
      "0167_manager_job_revision",
    ]) {
      await admin.query(
        readFileSync(
          new URL(
            `../../prisma/migrations/${migration}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        ),
      )
    }
    const url = new URL(databaseUrl!)
    url.searchParams.set("schema", schema)
    fixtureUrl = url.toString()
    left = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    right = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    a = new ManagerExecutionService(left)
    b = new ManagerExecutionService(right)
  })

  beforeEach(async () => {
    await admin.query('TRUNCATE "manager_enrichment_job" CASCADE')
    await left.managerEnrichmentJob.create({
      data: {
        id: input.jobId,
        muxAssetId: "fixture",
        options: { engine: "mastra", currentRunId: input.runId },
        status: "running",
      },
    })
  })

  afterAll(async () => {
    await Promise.all([left?.$disconnect(), right?.$disconnect()])
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })

  it("allows exactly one competing claim across independent pools", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? a : b).claim({ user, input }),
      ),
    )
    expect(results.filter((r) => r.status === "claimed")).toHaveLength(1)
    expect(results.filter((r) => r.status === "conflict")).toHaveLength(11)
    expect(await left.managerExecutionOperation.count()).toBe(1)
  })

  it("binds the run input digest across all operation IDs", async () => {
    await a.claim({ user, input })
    expect(
      await b.claim({
        user,
        input: {
          ...input,
          operationId: "audio-cleanup",
          inputDigest: "c".repeat(64),
        },
      }),
    ).toEqual({ status: "conflict" })
    expect(
      await b.claim({
        user,
        input: { ...input, operationId: "audio-cleanup" },
      }),
    ).toMatchObject({ status: "claimed" })
  })

  it("admits parallel Mastra stages on one run and fences ownership until EVERY operation settles", async () => {
    const stages = [
      "source",
      "correction",
      "translation",
      "chapters",
      "metadata",
      "embeddings",
      "scene-analysis",
    ]
    const claims = await Promise.all(
      stages.map((stage, index) =>
        (index % 2 ? a : b).claim({
          user,
          input: { ...input, operationId: `mastra:${stage}` },
        }),
      ),
    )
    expect(claims.map((claim) => claim.status)).toEqual(
      stages.map(() => "claimed"),
    )
    const jobs = new ManagerJobService(right)
    for (const [index, stage] of stages.entries()) {
      const stageInput = { ...input, operationId: `mastra:${stage}` }
      expect(await a.claim({ user, input: stageInput })).toEqual({
        status: "conflict",
      })
      // All previous stages have completed; the remaining one(s) still fence the job.
      await expect(
        jobs.update({
          user,
          id: input.jobId,
          input: { options: { engine: "mastra", currentRunId: "new-run" } },
        }),
      ).rejects.toThrow("in-flight")
      await expect(
        jobs.update({ user, id: input.jobId, input: { status: "completed" } }),
      ).rejects.toThrow("in-flight")
      expect(
        await jobs.update({
          user,
          id: input.jobId,
          input: { status: "running", currentStep: stage },
        }),
      ).toMatchObject({ currentStep: stage })
      const result = { status: index === 0 ? "failed" : "completed" }
      expect(
        await b.complete({
          user,
          input: {
            ...stageInput,
            claimToken: claims[index]!.claimToken!,
            result,
          },
        }),
      ).toEqual({ status: "replayed", result })
    }
    expect(
      await left.managerExecutionOperation.count({
        where: { jobId: input.jobId, completedAt: null },
      }),
    ).toBe(0)
    expect(
      await jobs.update({
        user,
        id: input.jobId,
        input: { status: "completed" },
      }),
    ).toMatchObject({ status: "completed" })
  })

  it("rejects wrong tokens and digests without releasing or overwriting the claim", async () => {
    const claim = await a.claim({ user, input })
    const completion = {
      ...input,
      claimToken: claim.claimToken!,
      result: { key: "artifact" },
    }
    for (const wrong of [
      { claimToken: randomUUID() },
      { operationDigest: "c".repeat(64) },
      { inputDigest: "c".repeat(64) },
    ]) {
      expect(
        await b.complete({ user, input: { ...completion, ...wrong } }),
      ).toEqual({ status: "conflict" })
    }
    expect(await b.claim({ user, input })).toEqual({ status: "conflict" })
    expect(await b.complete({ user, input: completion })).toEqual({
      status: "replayed",
      result: completion.result,
    })
    expect(
      await a.complete({
        user,
        input: { ...completion, result: { overwrite: true } },
      }),
    ).toEqual({ status: "replayed", result: completion.result })
    expect(
      await a.complete({
        user,
        input: { ...completion, claimToken: randomUUID() },
      }),
    ).toEqual({ status: "conflict" })
    expect(
      await a.claim({
        user,
        input: { ...input, operationDigest: "d".repeat(64) },
      }),
    ).toEqual({ status: "conflict" })
  })

  it("replays persisted completion after restarting the client/pool, including JSON null", async () => {
    const claim = await a.claim({ user, input })
    expect(
      await a.complete({
        user,
        input: { ...input, claimToken: claim.claimToken!, result: null },
      }),
    ).toEqual({ status: "replayed", result: null })
    await left.$disconnect()
    left = new PrismaClient({ datasources: { db: { url: fixtureUrl } } })
    a = new ManagerExecutionService(left)
    expect(await a.claim({ user, input })).toEqual({
      status: "replayed",
      result: null,
    })
    expect(await b.claim({ user, input })).toEqual({
      status: "replayed",
      result: null,
    })
  })

  it("replays the stored result in a fresh Node process with no inherited service state", async () => {
    const claim = await a.claim({ user, input })
    const result = { status: "completed", artifactKey: "fixture/source.vtt" }
    await a.complete({
      user,
      input: { ...input, claimToken: claim.claimToken!, result },
    })
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        createRequire(import.meta.url).resolve("tsx/cli"),
        "--eval",
        `import { PrismaClient } from '@prisma/client';
       import { env } from './src/config/env.ts';
       import { ManagerExecutionService } from './src/services/manager-execution.service.ts';
       import { MANAGER_BACKEND_PRINCIPAL } from './src/auth/principal.ts';
       (async () => {
         const prisma = new PrismaClient({ datasources: { db: { url: env.MANAGER_EXECUTION_TEST_DATABASE_URL } } });
         try {
           const response = await new ManagerExecutionService(prisma).claim({ user: MANAGER_BACKEND_PRINCIPAL, input: ${JSON.stringify(input)} });
           console.log(JSON.stringify(response));
         } finally { await prisma.$disconnect(); }
       })().catch((error) => { console.error(error); process.exitCode = 1; });`,
      ],
      {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        env: {
          ...process.env,
          MANAGER_EXECUTION_TEST_DATABASE_URL: fixtureUrl,
        },
        timeout: 10000,
      },
    )
    expect(JSON.parse(stdout)).toEqual({ status: "replayed", result })
  })

  it("never expires an ambiguous consumed claim", async () => {
    await a.claim({ user, input })
    await admin.query(
      "UPDATE manager_execution_operation SET created_at = '2000-01-01'",
    )
    expect(
      await new ManagerExecutionService(right).claim({ user, input }),
    ).toEqual({ status: "conflict" })
  })

  it("measures the JSON envelope at the exact 32KiB boundary", async () => {
    const result = [
      "x".repeat(8192),
      "x".repeat(8192),
      "x".repeat(8192),
      "x".repeat(8179),
    ]
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBe(32768)
    const claim = await a.claim({ user, input })
    expect(
      await a.complete({
        user,
        input: { ...input, claimToken: claim.claimToken!, result },
      }),
    ).toEqual({ status: "replayed", result })
    const next = { ...input, operationId: "audio-cleanup" }
    const nextClaim = await b.claim({ user, input: next })
    result[3] += "x"
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBe(32769)
    await expect(
      b.complete({
        user,
        input: { ...next, claimToken: nextClaim.claimToken!, result },
      }),
    ).rejects.toThrow("32768 bytes")
  })

  it("does not replay completed results after the job loses run ownership", async () => {
    const claim = await a.claim({ user, input })
    await a.complete({
      user,
      input: {
        ...input,
        claimToken: claim.claimToken!,
        result: { key: "artifact" },
      },
    })
    await new ManagerJobService(right).update({
      user,
      id: input.jobId,
      input: { status: "completed" },
    })
    expect(await b.claim({ user, input })).toEqual({ status: "stale" })
    expect(
      await b.complete({
        user,
        input: { ...input, claimToken: claim.claimToken!, result: {} },
      }),
    ).toEqual({ status: "stale" })
  })

  it.each([
    { options: { engine: "legacy", currentRunId: input.runId } },
    { options: { engine: "mastra", currentRunId: "new-owner" } },
    { status: "completed" },
    { status: "failed" },
    { completedAt: new Date() },
  ])("denies stale engine/run/terminal ownership %j", async (data) => {
    const claim = await a.claim({ user, input })
    // Deliberate out-of-contract DB write simulates preexisting corrupt/stale ownership.
    await left.managerEnrichmentJob.update({ where: { id: input.jobId }, data })
    expect(await b.claim({ user, input })).toEqual({ status: "stale" })
    expect(
      await b.complete({
        user,
        input: { ...input, claimToken: claim.claimToken!, result: {} },
      }),
    ).toEqual({ status: "stale" })
    expect(await left.managerExecutionOperation.findFirst()).toMatchObject({
      completedAt: null,
    })
  })

  it("reports nonexistent jobs and unclaimed completions without creating state", async () => {
    expect(
      await a.claim({ user, input: { ...input, jobId: "missing" } }),
    ).toEqual({ status: "stale" })
    expect(
      await a.complete({
        user,
        input: { ...input, claimToken: randomUUID(), result: {} },
      }),
    ).toEqual({ status: "conflict" })
    expect(await left.managerExecutionRun.count()).toBe(0)
  })

  it("blocks ownership or terminal invalidation until explicit completion; keeps same-owner callbacks writable", async () => {
    const jobs = new ManagerJobService(right)
    const claim = await a.claim({ user, input })
    for (const change of [
      { options: { engine: "mastra", currentRunId: "run-2" } },
      { options: { engine: "legacy", currentRunId: input.runId } },
      { options: {} },
      { status: "completed" as const },
      { status: "failed" as const },
      { completedAt: new Date() },
    ]) {
      await expect(
        jobs.update({ user, id: input.jobId, input: change }),
      ).rejects.toThrow("in-flight")
    }
    expect(
      await jobs.update({
        user,
        id: input.jobId,
        input: {
          options: {
            engine: "mastra",
            currentRunId: input.runId,
            callback: true,
          },
          currentStep: "working",
          artifacts: { callback: true },
        },
      }),
    ).toMatchObject({ currentStep: "working", artifacts: { callback: true } })
    await a.complete({
      user,
      input: { ...input, claimToken: claim.claimToken!, result: {} },
    })
    expect(
      await jobs.update({
        user,
        id: input.jobId,
        input: { options: { engine: "mastra", currentRunId: "run-2" } },
      }),
    ).toMatchObject({ options: { currentRunId: "run-2" } })
    expect(await a.claim({ user, input })).toEqual({ status: "stale" })
  })

  it("serializes job updates behind the same job-row lock and rechecks the persisted claim", async () => {
    await admin.query("BEGIN")
    await admin.query(
      "SELECT id FROM manager_enrichment_job WHERE id = $1 FOR UPDATE",
      [input.jobId],
    )
    const pending = new ManagerJobService(right).update({
      user,
      id: input.jobId,
      input: { status: "completed" },
    })
    // Attach rejection immediately to avoid an unhandled rejection before the assertion.
    const outcome = pending.then(
      () => "allowed",
      (error: Error) => error.message,
    )
    try {
      const deadline = Date.now() + 3000
      while (true) {
        const waiting = await admin.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
        )
        if (waiting.rows[0].n > 0) break
        if (Date.now() > deadline)
          throw new Error("Job update did not wait for job-row lock")
        await delay(10)
      }
      // Insert an in-flight operation while update waits; it must see this after acquiring the lock.
      await admin.query(
        "INSERT INTO manager_execution_run (job_id, run_id, input_digest) VALUES ($1, $2, $3)",
        [input.jobId, input.runId, input.inputDigest],
      )
      await admin.query(
        "INSERT INTO manager_execution_operation (job_id, run_id, operation_id, operation_digest, claim_token) VALUES ($1, $2, $3, $4, $5)",
        [
          input.jobId,
          input.runId,
          input.operationId,
          input.operationDigest,
          randomUUID(),
        ],
      )
      await admin.query("COMMIT")
    } finally {
      await admin.query("ROLLBACK")
    }
    expect(await outcome).toContain("in-flight")
  })

  it("bounds actual serialized JSON bytes, strings, and nesting before completion", async () => {
    const claim = await a.claim({ user, input })
    for (const result of [
      { text: "x".repeat(8193) },
      Array.from({ length: 20 }, () => "😀".repeat(1000)),
      Array.from({ length: 20 }).reduce<unknown>((inner) => ({ inner }), null),
      { invalid: undefined },
      { invalid: NaN },
    ]) {
      await expect(
        a.complete({
          user,
          input: { ...input, claimToken: claim.claimToken!, result },
        }),
      ).rejects.toThrow()
    }
    expect(await b.claim({ user, input })).toEqual({ status: "conflict" })
    expect(
      await a.complete({
        user,
        input: {
          ...input,
          claimToken: claim.claimToken!,
          result: { key: "bounded" },
        },
      }),
    ).toEqual({ status: "replayed", result: { key: "bounded" } })
  })
})
