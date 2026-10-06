import { randomUUID } from "node:crypto"

import { Mastra } from "@mastra/core"
import { createStep, createWorkflow } from "@mastra/core/workflows"
import { WorkflowsPG } from "@mastra/pg"
import { PostgresStore } from "@mastra/pg"
import { Pool } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import {
  measurePrecomputedRuntimeSnapshots,
  prunePrecomputedAbandonedRuntimeSnapshots,
  prunePrecomputedRuntimeSnapshots,
} from "./precomputed-runtime-retention"

const url = process.env.PRECOMPUTED_RUNTIME_DB_TEST_URL
const schema = `precomputed_runtime_${randomUUID().replaceAll("-", "").slice(0, 12)}`

describe.skipIf(!url)("native precomputed runtime snapshot retention", () => {
  const pool = new Pool({ connectionString: url, max: 3 })
  const workflows = new WorkflowsPG({ pool, schemaName: schema })

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await workflows.init()
  })

  beforeEach(async () => {
    await pool.query(`TRUNCATE "${schema}".mastra_workflow_snapshot`)
  })

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  })

  async function put(
    workflowName: string,
    status: Parameters<
      WorkflowsPG["persistWorkflowSnapshot"]
    >[0]["snapshot"]["status"],
    updatedAt: Date,
    generationId = "private-generation",
    inputCutoff = "2026-08-01T00:00:00.000Z",
    historyRequired = false,
  ) {
    const runId = randomUUID()
    const context: Parameters<
      WorkflowsPG["persistWorkflowSnapshot"]
    >[0]["snapshot"]["context"] = {}
    context.input = { generationId, inputCutoff, historyRequired }
    await workflows.persistWorkflowSnapshot({
      workflowName,
      runId,
      snapshot: {
        runId,
        status,
        value: {},
        context,
        serializedStepGraph: [],
        activePaths: [],
        activeStepsPath: {},
        suspendedPaths: {},
        resumeLabels: {},
        waitingPaths: {},
        timestamp: updatedAt.getTime(),
      },
      createdAt: updatedAt,
      updatedAt,
    })
    return runId
  }

  it("deletes only old terminal feature runs and leaves running and unrelated runs intact", async () => {
    const now = new Date("2026-10-06T00:00:00.000Z")
    const old = new Date("2026-08-01T00:00:00.000Z")
    const fresh = new Date("2026-10-05T00:00:00.000Z")
    const terminal = await put("precomputed-catalog-generation", "success", old)
    const failed = await put("precomputed-source-generation", "failed", old)
    const running = await put("precomputed-catalog-generation", "running", old)
    const unrelated = await put("video-first-devotional", "success", old)
    const recent = await put("precomputed-catalog-generation", "success", fresh)

    const before = await measurePrecomputedRuntimeSnapshots({
      pool,
      schema,
      now,
    })
    expect(before.featureRunCount).toBe(4)
    expect(before.featureSnapshotBytes).toBeGreaterThan(0)
    expect(before.staleNonterminalRunCount).toBe(1)

    const result = await prunePrecomputedRuntimeSnapshots({
      pool,
      schema,
      now,
      maxRows: 1,
    })
    expect(result.deletedRuns).toBe(1)
    expect(result.hasMoreEligible).toBe(true)
    expect(result.logicalSnapshotBytesDeleted).toBeGreaterThan(0)
    expect(
      await workflows.getWorkflowRunById({ runId: running }),
    ).not.toBeNull()
    expect(
      await workflows.getWorkflowRunById({ runId: unrelated }),
    ).not.toBeNull()
    expect(await workflows.getWorkflowRunById({ runId: recent })).not.toBeNull()

    const again = await prunePrecomputedRuntimeSnapshots({
      pool,
      schema,
      now,
      maxRows: 5,
    })
    expect(again.deletedRuns).toBe(1)
    expect(again.hasMoreEligible).toBe(false)
    expect(await workflows.getWorkflowRunById({ runId: terminal })).toBeNull()
    expect(await workflows.getWorkflowRunById({ runId: failed })).toBeNull()
    expect(
      await workflows.getWorkflowRunById({ runId: running }),
    ).not.toBeNull()

    const empty = await prunePrecomputedRuntimeSnapshots({
      pool,
      schema,
      now,
      maxRows: 5,
    })
    expect(empty.deletedRuns).toBe(0)
  })

  it("skips a locked run and can reclaim it on the next attempt", async () => {
    const old = new Date("2026-08-01T00:00:00.000Z")
    const runId = await put("precomputed-catalog-generation", "failed", old)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `SELECT run_id FROM "${schema}".mastra_workflow_snapshot WHERE run_id = $1 FOR UPDATE`,
        [runId],
      )
      const skipped = await prunePrecomputedRuntimeSnapshots({
        pool,
        schema,
        now: new Date("2026-10-06T00:00:00.000Z"),
        maxRows: 1,
      })
      expect(skipped.deletedRuns).toBe(0)
      expect(await workflows.getWorkflowRunById({ runId })).not.toBeNull()
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
    const deleted = await prunePrecomputedRuntimeSnapshots({
      pool,
      schema,
      now: new Date("2026-10-06T00:00:00.000Z"),
      maxRows: 1,
    })
    expect(deleted.deletedRuns).toBe(1)
  })

  it("reclaims old nonterminal runs only after matching Admin retirement proof", async () => {
    const old = new Date("2026-08-01T00:00:00.000Z")
    const cutoff = "2026-07-31T00:00:00.000Z"
    const source = await put(
      "precomputed-source-generation",
      "running",
      old,
      "source-retired",
      cutoff,
    )
    const catalog = await put(
      "precomputed-catalog-generation",
      "waiting",
      old,
      "catalog-retired",
      cutoff,
      true,
    )
    const active = await put(
      "precomputed-source-generation",
      "running",
      old,
      "source-active",
      cutoff,
    )
    const missing = await put(
      "precomputed-source-generation",
      "running",
      old,
      "source-missing",
      cutoff,
    )
    const mismatch = await put(
      "precomputed-source-generation",
      "running",
      old,
      "source-mismatch",
      cutoff,
    )
    const invalidState = await put(
      "precomputed-source-generation",
      "running",
      old,
      "source-invalid-state",
      cutoff,
    )
    const recent = await put(
      "precomputed-source-generation",
      "running",
      new Date("2026-10-05T00:00:00.000Z"),
      "source-recent",
      cutoff,
    )
    const proof = (generationId: string) =>
      generationId === "source-missing"
        ? null
        : {
            protocolVersion: 2 as const,
            generationProtocolVersion:
              generationId === "catalog-retired" ? 2 : 1,
            generationId,
            inputCutoff:
              generationId === "source-mismatch"
                ? "2026-07-30T00:00:00.000Z"
                : cutoff,
            inputDigest: "a".repeat(64),
            inputMode:
              generationId === "catalog-retired"
                ? "historical_analytics"
                : "content_only",
            state:
              generationId === "source-active" ||
              generationId === "source-invalid-state"
                ? "incomplete"
                : "retired",
            sourceWorkResumable: generationId === "source-active",
          }

    const result = await prunePrecomputedAbandonedRuntimeSnapshots({
      pool,
      schema,
      now: new Date("2026-10-06T00:00:00.000Z"),
      readProof: async ({ generationId }) => proof(generationId),
    })
    expect(result.deletedRuns).toBe(2)
    expect(result.unresolvedRuns).toBe(4)
    for (const runId of [source, catalog])
      expect(await workflows.getWorkflowRunById({ runId })).toBeNull()
    for (const runId of [active, missing, mismatch, invalidState, recent])
      expect(await workflows.getWorkflowRunById({ runId })).not.toBeNull()
  })

  it("pages past unresolved retirement proofs without starving later artifacts", async () => {
    const cutoff = "2026-07-31T00:00:00.000Z"
    const unresolved = await put(
      "precomputed-source-generation",
      "running",
      new Date("2026-08-01T00:00:00.000Z"),
      "unresolved",
      cutoff,
    )
    const retired = await put(
      "precomputed-source-generation",
      "running",
      new Date("2026-08-02T00:00:00.000Z"),
      "retired",
      cutoff,
    )
    const options = {
      pool,
      schema,
      now: new Date("2026-10-06T00:00:00.000Z"),
      maxRows: 1,
      readProof: async ({ generationId }: { generationId: string }) =>
        generationId === "unresolved"
          ? null
          : {
              protocolVersion: 2,
              generationProtocolVersion: 1,
              generationId,
              inputCutoff: cutoff,
              inputDigest: "a".repeat(64),
              inputMode: "content_only",
              state: "retired",
              sourceWorkResumable: false,
            },
    }
    const first = await prunePrecomputedAbandonedRuntimeSnapshots(options)
    expect(first.deletedRuns).toBe(0)
    expect(first.unresolvedRuns).toBe(1)
    const second = await prunePrecomputedAbandonedRuntimeSnapshots({
      ...options,
      after: first.nextCursor!,
    })
    expect(second.deletedRuns).toBe(1)
    expect(
      await workflows.getWorkflowRunById({ runId: unresolved }),
    ).not.toBeNull()
    expect(await workflows.getWorkflowRunById({ runId: retired })).toBeNull()
  })

  it("finds immutable launch identity in a real Mastra workflow snapshot", async () => {
    const inputSchema = z.object({
      generationId: z.string(),
      inputCutoff: z.string(),
      historyRequired: z.boolean(),
    })
    const step = createStep({
      id: "identity-probe-step",
      inputSchema,
      outputSchema: inputSchema,
      execute: async ({ inputData }) => inputData,
    })
    const probe = createWorkflow({
      id: "precomputed-source-generation",
      inputSchema,
      outputSchema: inputSchema,
    })
      .then(step)
      .commit()
    const store = new PostgresStore({
      id: "precomputed-runtime-identity-probe",
      connectionString: url!,
      schemaName: schema,
    })
    const mastra = new Mastra({ storage: store, workflows: { probe } })
    const run = await mastra
      .getWorkflow("probe")
      .createRun({ runId: randomUUID() })
    const input = {
      generationId: "identity-probe",
      inputCutoff: "2026-08-01T00:00:00.000Z",
      historyRequired: false,
    }
    await run.start({ inputData: input })
    const rows = await pool.query<{
      generation_id: string | null
      input_cutoff: string | null
      history_required: string | null
    }>(
      `SELECT snapshot::jsonb #>> '{context,input,generationId}' AS generation_id,
              snapshot::jsonb #>> '{context,input,inputCutoff}' AS input_cutoff,
              snapshot::jsonb #>> '{context,input,historyRequired}' AS history_required
       FROM "${schema}".mastra_workflow_snapshot WHERE run_id = $1`,
      [run.runId],
    )
    expect(rows.rows[0]).toMatchObject({
      generation_id: input.generationId,
      input_cutoff: input.inputCutoff,
      history_required: "false",
    })
    await mastra.shutdown()
  })
})
