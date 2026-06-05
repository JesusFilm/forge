import { describe, expect, it, vi } from "vitest"

// The script lazy-imports `@/db/client` + `@/services/embeddings.service`
// inside main(); the exported helpers under test take prisma + embed as
// injected dependencies, so no module mock is needed for the unit surface.
// We still stub `@/config/env` defensively in case the embeddings.service
// import graph is pulled transitively by tsx during collection.
vi.mock("@/config/env", () => ({ env: {} }))

import {
  QWEN_BACKFILL_CONFIGS,
  backfillQwenTable,
  fetchQwenBackfillPage,
  parsePositiveInt,
  writeQwenBatch,
  type QwenBackfillRow,
} from "./backfill-qwen-video-embeddings"

/**
 * A `Prisma.sql` template object exposes parameterized `.sql` text (with
 * `$N` placeholders) plus `.values`. The helpers call `$queryRaw` /
 * `$executeRaw` with ONE composed `Prisma.Sql` argument, so we read
 * `call[0].sql` to assert query shape.
 */
function sqlOf(call: unknown[]): string {
  const arg = call[0] as { sql?: string }
  return typeof arg?.sql === "string" ? arg.sql : ""
}

function valuesOf(call: unknown[]): unknown[] {
  const arg = call[0] as { values?: unknown[] }
  return Array.isArray(arg?.values) ? arg.values : []
}

function nullLogger() {
  return { stdout: vi.fn(), stderr: vi.fn() }
}

function rows(n: number, prefix = "row"): QwenBackfillRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(3, "0")}`,
    text: `text ${i}`,
  }))
}

describe("fetchQwenBackfillPage", () => {
  it("selects only rows with non-null text AND null embedding_qwen, ordered by id (resumability)", async () => {
    const $queryRaw = vi.fn(async () => [])
    const prisma = { $queryRaw } as never

    await fetchQwenBackfillPage({
      prisma,
      config: QWEN_BACKFILL_CONFIGS.scene,
      coreIds: [],
      lastId: null,
      take: 64,
    })

    const sql = sqlOf($queryRaw.mock.calls[0]!)
    // Reads the scene text column verbatim.
    expect(sql).toContain('"source_text"')
    // Resumability WHERE shape: non-null text AND null target column.
    expect(sql).toMatch(/"source_text"\s+IS NOT NULL/)
    expect(sql).toMatch(/"embedding_qwen"\s+IS NULL/)
    // Deterministic paging order.
    expect(sql).toMatch(/ORDER BY t\."id" ASC/)
    // No core-id JOIN when no filter requested.
    expect(sql).not.toContain('JOIN "video"')
    // No cursor predicate on the first page.
    expect(sql).not.toMatch(/t\."id" >/)
  })

  it("adds the cursor predicate and core-id JOIN when filtering", async () => {
    const $queryRaw = vi.fn(async () => [])
    const prisma = { $queryRaw } as never

    await fetchQwenBackfillPage({
      prisma,
      config: QWEN_BACKFILL_CONFIGS.transcript,
      coreIds: ["1_Jesus", "2_GoodNews"],
      lastId: "row-042",
      take: 32,
    })

    const sql = sqlOf($queryRaw.mock.calls[0]!)
    expect(sql).toContain('"text"')
    // Transcript core-id JOIN chain reaches video.
    expect(sql).toContain('JOIN "video_transcript"')
    expect(sql).toContain('JOIN "video"')
    expect(sql).toMatch(/v\."core_id" IN/)
    expect(sql).toMatch(/t\."id" >/)
    // Bound values: the two coreIds, the cursor id, and the LIMIT take.
    expect(valuesOf($queryRaw.mock.calls[0]!)).toEqual([
      "1_Jesus",
      "2_GoodNews",
      "row-042",
      32,
    ])
  })
})

describe("writeQwenBatch", () => {
  it("updates embedding_qwen (NOT embedding) per row with a ::vector cast inside one transaction", async () => {
    const executed: unknown[][] = []
    const $executeRaw = vi.fn((...args: unknown[]) => {
      executed.push(args)
      return Promise.resolve(1)
    })
    // $transaction receives an array of pending $executeRaw promises.
    const $transaction = vi.fn(async (ops: Promise<unknown>[]) => {
      await Promise.all(ops)
      return ops
    })
    const prisma = { $executeRaw, $transaction } as never

    await writeQwenBatch({
      prisma,
      config: QWEN_BACKFILL_CONFIGS.scene,
      rows: [
        { id: "scene-1", text: "a" },
        { id: "scene-2", text: "b" },
      ],
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    })

    expect($transaction).toHaveBeenCalledTimes(1)
    expect($executeRaw).toHaveBeenCalledTimes(2)

    for (const call of executed) {
      const sql = sqlOf(call)
      expect(sql).toContain('"embedding_qwen"')
      // Critically: never touches the live `embedding` column.
      expect(sql).not.toMatch(/SET "embedding" /)
      expect(sql).toMatch(/::vector\b/)
      // Per-row cast — NOT the ::vector[] array-parameter form.
      expect(sql).not.toContain("::vector[]")
      expect(sql).toContain('"video_scene_locale"')
      expect(sql).toMatch(/WHERE "id" =/)
    }

    // Vectors are formatted as pgvector text literals and bound as values.
    expect(valuesOf(executed[0]!)).toContain("[0.1,0.2]")
    expect(valuesOf(executed[0]!)).toContain("scene-1")
    expect(valuesOf(executed[1]!)).toContain("[0.3,0.4]")
    expect(valuesOf(executed[1]!)).toContain("scene-2")
  })
})

describe("backfillQwenTable", () => {
  /**
   * Build a prisma stub that returns `pages` from successive
   * `fetchQwenBackfillPage` (`$queryRaw`) calls and records write batches.
   */
  function buildPrisma(pages: QwenBackfillRow[][]) {
    let pageIdx = 0
    const writtenIds: string[][] = []
    // Honor the bound LIMIT (`take`, the last bound value) the way the real
    // DB would — otherwise a `--limit` smaller than the preloaded page can't
    // be exercised.
    const $queryRaw = vi.fn(async (sqlArg: { values?: unknown[] }) => {
      const page = pages[pageIdx] ?? []
      pageIdx += 1
      const take = sqlArg?.values?.at(-1)
      return typeof take === "number" ? page.slice(0, take) : page
    })
    const $executeRaw = vi.fn(() => Promise.resolve(1))
    const $transaction = vi.fn(async (ops: Promise<unknown>[]) => {
      await Promise.all(ops)
      return ops
    })
    return {
      prisma: { $queryRaw, $executeRaw, $transaction } as never,
      $queryRaw,
      $transaction,
      writtenIds,
    }
  }

  it("calls the embedder once per batch with the batch texts and source:gateway", async () => {
    // 5 rows, batch size 2 → 3 batches (2 + 2 + 1).
    const all = rows(5)
    const { prisma } = buildPrisma([
      all.slice(0, 2),
      all.slice(2, 4),
      all.slice(4, 5),
      [],
    ])
    const embed = vi.fn(
      async (inputs: readonly string[], _opts: { source: string }) => ({
        embeddings: inputs.map(() => [0.1, 0.2]),
      }),
    )

    const report = await backfillQwenTable({
      prisma,
      embed,
      config: QWEN_BACKFILL_CONFIGS.scene,
      coreIds: [],
      batchSize: 2,
      logger: nullLogger(),
    })

    expect(embed).toHaveBeenCalledTimes(3)
    expect(embed.mock.calls[0]![0]).toEqual(["text 0", "text 1"])
    expect(embed.mock.calls[0]![1]).toEqual({ source: "gateway" })
    expect(embed.mock.calls[2]![0]).toEqual(["text 4"])
    expect(report).toMatchObject({
      table: "video_scene_locale",
      succeeded: 5,
      failed: 0,
    })
  })

  it("caps total processed rows at --limit", async () => {
    const all = rows(100)
    const { prisma, $queryRaw } = buildPrisma([
      all.slice(0, 10),
      all.slice(10, 20),
      all.slice(20, 30),
    ])
    const embed = vi.fn(async (inputs: readonly string[]) => ({
      embeddings: inputs.map(() => [0.1]),
    }))

    const report = await backfillQwenTable({
      prisma,
      embed,
      config: QWEN_BACKFILL_CONFIGS.transcript,
      coreIds: [],
      batchSize: 10,
      limit: 15,
      logger: nullLogger(),
    })

    // 15 rows total: first page (10) + a second page capped to take=5.
    expect(report.succeeded).toBe(15)
    expect($queryRaw).toHaveBeenCalledTimes(2)
    // Second fetch requests only the remaining 5 rows.
    expect(valuesOf($queryRaw.mock.calls[1]!).at(-1)).toBe(5)
  })

  it("skips blank/whitespace-only text rows without sending them to the embedder, batch continues", async () => {
    const page = [
      { id: "row-0", text: "real text" },
      { id: "row-1", text: "   " },
      { id: "row-2", text: "" },
      { id: "row-3", text: "more text" },
    ]
    const { prisma } = buildPrisma([page, []])
    const embed = vi.fn(async (inputs: readonly string[]) => ({
      embeddings: inputs.map(() => [0.9]),
    }))

    const report = await backfillQwenTable({
      prisma,
      embed,
      config: QWEN_BACKFILL_CONFIGS.scene,
      coreIds: [],
      batchSize: 10,
      logger: nullLogger(),
    })

    // Blank rows never reach the embedder.
    expect(embed).toHaveBeenCalledTimes(1)
    expect(embed.mock.calls[0]![0]).toEqual(["real text", "more text"])
    expect(report.succeeded).toBe(2)
    expect(report.failed).toBe(0)
  })

  it("isolates a failed batch: logs, increments failure counter, continues, and the run reports failures", async () => {
    const all = rows(4)
    const { prisma, $transaction } = buildPrisma([
      all.slice(0, 2),
      all.slice(2, 4),
      [],
    ])
    const logger = nullLogger()
    let call = 0
    const embed = vi.fn(async (inputs: readonly string[]) => {
      call += 1
      if (call === 1) {
        throw new Error("gateway 503")
      }
      return { embeddings: inputs.map(() => [0.5]) }
    })

    const report = await backfillQwenTable({
      prisma,
      embed,
      config: QWEN_BACKFILL_CONFIGS.scene,
      coreIds: [],
      batchSize: 2,
      logger,
    })

    // First batch failed (no write), second succeeded.
    expect(embed).toHaveBeenCalledTimes(2)
    expect($transaction).toHaveBeenCalledTimes(1)
    expect(report.failed).toBe(2)
    expect(report.succeeded).toBe(2)

    // A structured error event was logged for the failed batch.
    const errLines = logger.stderr.mock.calls.map((c) => String(c[0]))
    const errEvent = errLines
      .map((l) => JSON.parse(l))
      .find((e) => e.event === "backfill-qwen.error")
    expect(errEvent).toMatchObject({
      table: "video_scene_locale",
      idRange: { from: "row-000", to: "row-001" },
    })
  })
})

describe("parsePositiveInt", () => {
  it("returns undefined when unset", () => {
    expect(parsePositiveInt(undefined, "--limit")).toBeUndefined()
  })

  it("parses a positive integer", () => {
    expect(parsePositiveInt("64", "--batch-size")).toBe(64)
  })

  it("throws on zero, negative, or non-integer", () => {
    expect(() => parsePositiveInt("0", "--batch-size")).toThrow(/positive/)
    expect(() => parsePositiveInt("-3", "--limit")).toThrow(/positive/)
    expect(() => parsePositiveInt("1.5", "--limit")).toThrow(/positive/)
    expect(() => parsePositiveInt("abc", "--limit")).toThrow(/positive/)
  })
})
