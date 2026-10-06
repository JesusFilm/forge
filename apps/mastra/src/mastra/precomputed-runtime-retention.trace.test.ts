import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { EntityType, SpanType } from "@mastra/core/observability"
import { DuckDBStore } from "@mastra/duckdb"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  measurePrecomputedRuntimeTraces,
  prunePrecomputedOrphanRunningTraces,
  prunePrecomputedRuntimeTraces,
} from "./precomputed-runtime-retention"

describe("native precomputed runtime trace retention", () => {
  let store: DuckDBStore
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "forge-precomputed-traces-"))
    store = new DuckDBStore({
      id: "precomputed-trace-test",
      path: join(directory, "traces.duckdb"),
    })
    await store.observability.init()
  })

  beforeEach(async () => {
    await store.observability.dangerouslyClearAll()
  })

  afterAll(async () => {
    await store?.close()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  async function put(
    workflowId: string,
    endedAt?: Date,
    metadata?: Record<string, unknown>,
    startedAt = new Date("2026-08-01T00:00:00.000Z"),
  ) {
    const traceId = randomUUID()
    await store.observability.createSpan({
      span: {
        traceId,
        spanId: randomUUID(),
        name: workflowId,
        spanType: SpanType.WORKFLOW_RUN,
        isEvent: false,
        startedAt,
        endedAt,
        metadata,
        entityType: EntityType.WORKFLOW_RUN,
        entityId: workflowId,
        rootEntityType: EntityType.WORKFLOW_RUN,
        rootEntityId: workflowId,
      },
    })
    return traceId
  }

  it("removes old ended feature traces in bounded batches and preserves active, recent and unrelated traces", async () => {
    const old = new Date("2026-08-01T01:00:00.000Z")
    const fresh = new Date("2026-10-05T01:00:00.000Z")
    const catalog = await put("precomputed-catalog-generation", old)
    const source = await put("precomputed-source-generation", old)
    const active = await put("precomputed-catalog-generation")
    const recent = await put("precomputed-catalog-generation", fresh)
    const unrelated = await put("video-first-devotional", old)
    const now = new Date("2026-10-06T00:00:00.000Z")

    expect(
      await measurePrecomputedRuntimeTraces({
        observability: store.observability,
        now,
      }),
    ).toEqual({
      featureTraceCount: 4,
      runningTraceCount: 1,
      staleRunningTraceCount: 1,
    })

    const first = await prunePrecomputedRuntimeTraces({
      observability: store.observability,
      now,
      maxTraces: 1,
    })
    expect(first.deletedTraces).toBe(1)
    expect(first.hasMoreEligible).toBe(true)

    const second = await prunePrecomputedRuntimeTraces({
      observability: store.observability,
      now,
      maxTraces: 5,
    })
    expect(second.deletedTraces).toBe(1)
    expect(second.hasMoreEligible).toBe(false)

    expect(await store.observability.getTrace({ traceId: catalog })).toBeNull()
    expect(await store.observability.getTrace({ traceId: source })).toBeNull()
    expect(
      await store.observability.getTrace({ traceId: active }),
    ).not.toBeNull()
    expect(
      await store.observability.getTrace({ traceId: recent }),
    ).not.toBeNull()
    expect(
      await store.observability.getTrace({ traceId: unrelated }),
    ).not.toBeNull()
  })

  it("pages past unresolved old running traces and deletes only Admin-fenced identities", async () => {
    const cutoff = "2026-07-31T00:00:00.000Z"
    const metadata = (generationId: string, inputCutoff = cutoff) => ({
      precomputedGenerationId: generationId,
      precomputedInputCutoff: inputCutoff,
      precomputedHistoryRequired: false,
    })
    const unresolved = await put(
      "precomputed-source-generation",
      undefined,
      metadata("unknown"),
    )
    const retired = await put(
      "precomputed-source-generation",
      undefined,
      metadata("retired"),
      new Date("2026-08-02T00:00:00.000Z"),
    )
    const active = await put(
      "precomputed-source-generation",
      undefined,
      metadata("active"),
      new Date("2026-08-03T00:00:00.000Z"),
    )
    const mismatch = await put(
      "precomputed-source-generation",
      undefined,
      metadata("mismatch", "2026-07-30T00:00:00.000Z"),
      new Date("2026-08-04T00:00:00.000Z"),
    )
    const legacy = await put(
      "precomputed-source-generation",
      undefined,
      undefined,
      new Date("2026-08-05T00:00:00.000Z"),
    )
    const fresh = await put(
      "precomputed-source-generation",
      undefined,
      metadata("fresh"),
      new Date("2026-10-05T00:00:00.000Z"),
    )
    const unrelated = await put("video-first-devotional")
    expect(
      await measurePrecomputedRuntimeTraces({
        observability: store.observability,
        now: new Date("2026-10-06T00:00:00.000Z"),
      }),
    ).toMatchObject({ staleRunningTraceCount: 5 })
    const options = {
      observability: store.observability,
      now: new Date("2026-10-06T00:00:00.000Z"),
      maxTraces: 1,
      readProof: async ({ generationId }: { generationId: string }) =>
        generationId === "unknown"
          ? null
          : {
              protocolVersion: 2,
              generationProtocolVersion: 1,
              generationId,
              inputCutoff: cutoff,
              inputDigest: "a".repeat(64),
              inputMode: "content_only",
              state: generationId === "active" ? "incomplete" : "retired",
              sourceWorkResumable: generationId === "active",
            },
    }
    const first = await prunePrecomputedOrphanRunningTraces(options)
    expect(first.deletedTraces).toBe(0)
    expect(first.unresolvedTraces).toBe(1)
    const second = await prunePrecomputedOrphanRunningTraces({
      ...options,
      page: first.nextPage,
    })
    expect(second.deletedTraces).toBe(1)
    expect(await store.observability.getTrace({ traceId: retired })).toBeNull()
    for (const traceId of [
      unresolved,
      active,
      mismatch,
      legacy,
      fresh,
      unrelated,
    ])
      expect(await store.observability.getTrace({ traceId })).not.toBeNull()
  })
})
