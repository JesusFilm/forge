import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it, vi } from "vitest"

import { AI_CHAT_TITLE_MAX_UNITS } from "./ai-chat-title-clamp"
import { TIME_BUDGET_MS } from "./budgets"
import {
  AI_CHAT_RENAME_POOL_OPTIONS,
  AI_CHAT_RENAME_TITLE_MAX_RAW_UNITS,
  handleAiChatHistoryRenameRequest,
  type AiChatHistoryRenameHandlerInput,
  type AiChatRenameMemory,
  type AiChatRenamePool,
} from "./ai-chat-history-write-route"

const LANE_KEYS = ["test-lane-key"] as const
const AUTH = "Bearer test-lane-key"
const POOL_KEY = "test-pool-key"
const OWNER = "user:sub-1"
const THREAD_ID = "thread-1"
const TITLE = "My renamed thread"

// --- fake store harness -------------------------------------------------------

type MakeMemoryOpts = {
  /** `undefined` = missing thread (getThreadById resolves null). */
  threadOwner?: string | null
  getThreadByIdImpl?: AiChatRenameMemory["getThreadById"]
}

function makeMemory(opts: MakeMemoryOpts = {}): {
  memory: AiChatRenameMemory
  getCalls: Array<Parameters<AiChatRenameMemory["getThreadById"]>[0]>
} {
  const getCalls: Array<Parameters<AiChatRenameMemory["getThreadById"]>[0]> = []
  const memory: AiChatRenameMemory = {
    getThreadById: async (args) => {
      getCalls.push(args)
      if (opts.getThreadByIdImpl) return opts.getThreadByIdImpl(args)
      return opts.threadOwner === undefined
        ? null
        : { resourceId: opts.threadOwner }
    },
  }
  return { memory, getCalls }
}

type MakePoolOpts = {
  rowCount?: number | null
  queryImpl?: AiChatRenamePool["query"]
}

function makePool(opts: MakePoolOpts = {}): {
  pool: AiChatRenamePool
  queries: Array<{ text: string; values: unknown[] | undefined }>
} {
  const queries: Array<{ text: string; values: unknown[] | undefined }> = []
  const pool: AiChatRenamePool = {
    query: async (text, values) => {
      queries.push({ text, values })
      if (opts.queryImpl) return opts.queryImpl(text, values)
      return { rowCount: opts.rowCount === undefined ? 1 : opts.rowCount }
    },
  }
  return { pool, queries }
}

type Harness = {
  memory: AiChatRenameMemory
  pool: AiChatRenamePool
  getCalls: ReturnType<typeof makeMemory>["getCalls"]
  queries: ReturnType<typeof makePool>["queries"]
}

function harness(
  memoryOpts: MakeMemoryOpts = { threadOwner: OWNER },
  poolOpts: MakePoolOpts = {},
): Harness {
  const { memory, getCalls } = makeMemory(memoryOpts)
  const { pool, queries } = makePool(poolOpts)
  return { memory, pool, getCalls, queries }
}

function renameBody(over: Record<string, unknown> = {}): unknown {
  return { resourceId: OWNER, threadId: THREAD_ID, title: TITLE, ...over }
}

function renameInput(
  h: Harness,
  over: Partial<AiChatHistoryRenameHandlerInput> = {},
): AiChatHistoryRenameHandlerInput {
  return {
    authHeader: AUTH,
    readJson: async () => renameBody(),
    getEnabled: () => true,
    getServiceKeys: () => LANE_KEYS,
    getBackend: () => "postgres",
    getMemory: () => h.memory,
    getPool: () => h.pool,
    ...over,
  }
}

function captureConsole(): { logged: () => string } {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  const info = vi.spyOn(console, "info").mockImplementation(() => {})
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  return {
    logged: () =>
      [warn, info, error, log]
        .flatMap((spy) => spy.mock.calls.flat())
        .map(String)
        .join("\n"),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ===========================================================================
// Shared ladder (flag → lane bearer) — the feat-283 admission preamble
// ===========================================================================

describe("rename route — precondition ladder", () => {
  it("returns 404 when the route flag is off, before bearer, body, backend, or store", async () => {
    const h = harness()
    const keysProbe = vi.fn(() => LANE_KEYS)
    const backendProbe = vi.fn(() => "postgres" as const)
    const readJson = vi.fn(async () => renameBody())
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, {
        getEnabled: () => false,
        getServiceKeys: keysProbe,
        getBackend: backendProbe,
        readJson,
      }),
    )
    expect(outcome.status).toBe(404)
    expect(outcome.body).toEqual({ error: "Not found" })
    expect(keysProbe).not.toHaveBeenCalled()
    expect(backendProbe).not.toHaveBeenCalled()
    expect(readJson).not.toHaveBeenCalled()
    expect(h.getCalls).toHaveLength(0)
    expect(h.queries).toHaveLength(0)
  })

  it("returns 401 for a missing or wrong bearer, store never touched", async () => {
    for (const authHeader of [undefined, "Bearer nope", "nope"]) {
      const h = harness()
      const outcome = await handleAiChatHistoryRenameRequest(
        renameInput(h, { authHeader }),
      )
      expect(outcome.status).toBe(401)
      expect(outcome.body).toEqual({ error: "Service bearer required" })
      expect(h.getCalls).toHaveLength(0)
      expect(h.queries).toHaveLength(0)
    }
  })

  it("rejects a POOL-valid bearer that is absent from the lane list (KTD2 carve-out pin)", async () => {
    const h = harness()
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, { authHeader: `Bearer ${POOL_KEY}` }),
    )
    expect(outcome.status).toBe(401)
    expect(h.queries).toHaveLength(0)
  })

  it("fails closed when the lane CSV is unset (default key source, empty allowlist)", async () => {
    const h = harness()
    // No getServiceKeys override: the default reads AI_CHAT_SERVICE_API_KEYS,
    // which is unset in the test env — every bearer must be refused.
    const outcome = await handleAiChatHistoryRenameRequest({
      authHeader: AUTH,
      readJson: async () => renameBody(),
      getEnabled: () => true,
      getBackend: () => "postgres",
      getMemory: () => h.memory,
      getPool: () => h.pool,
    })
    expect(outcome.status).toBe(401)
    expect(h.getCalls).toHaveLength(0)
    expect(h.queries).toHaveLength(0)
  })
})

// ===========================================================================
// Body guard (KTD2 bounds)
// ===========================================================================

describe("rename route — body validation", () => {
  it.each([
    ["non-object body", "nope"],
    ["null body", null],
    ["missing resourceId", { threadId: THREAD_ID, title: TITLE }],
    ["non-string resourceId", renameBody({ resourceId: 5 })],
    ["missing threadId", { resourceId: OWNER, title: TITLE }],
    ["non-string threadId", renameBody({ threadId: 7 })],
    ["empty threadId", renameBody({ threadId: "" })],
    ["over-length threadId", renameBody({ threadId: "x".repeat(201) })],
    ["missing title", { resourceId: OWNER, threadId: THREAD_ID }],
    ["non-string title", renameBody({ title: ["a"] })],
    ["null title", renameBody({ title: null })],
    [
      "over-bound raw title (1,025 units)",
      renameBody({ title: "x".repeat(AI_CHAT_RENAME_TITLE_MAX_RAW_UNITS + 1) }),
    ],
  ])(
    "rejects %s with 400 invalid_body and no store I/O",
    async (_label, body) => {
      const h = harness()
      const outcome = await handleAiChatHistoryRenameRequest(
        renameInput(h, { readJson: async () => body }),
      )
      expect(outcome.status).toBe(400)
      expect(outcome.body).toEqual({ reason: "invalid_body" })
      expect(h.getCalls).toHaveLength(0)
      expect(h.queries).toHaveLength(0)
    },
  )

  it("accepts a raw title of exactly the bound (1,024 units) — the bound is inclusive", async () => {
    const h = harness()
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, {
        readJson: async () =>
          renameBody({ title: "y".repeat(AI_CHAT_RENAME_TITLE_MAX_RAW_UNITS) }),
      }),
    )
    expect(outcome.status).toBe(200)
  })

  it("accepts a threadId of exactly the bound (200 units) — the bound is inclusive", async () => {
    // Companion to the 201-unit rejection above; without it a `< 200` typo
    // in the guard would pass every case in this file.
    const h = harness()
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, {
        readJson: async () => renameBody({ threadId: "t".repeat(200) }),
      }),
    )
    expect(outcome.status).toBe(200)
    expect(h.queries[0]!.values?.[1]).toBe("t".repeat(200))
  })

  it("rejects an unparseable body with 400", async () => {
    const h = harness()
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, {
        readJson: async () => {
          throw new Error("bad json")
        },
      }),
    )
    expect(outcome.status).toBe(400)
    expect(outcome.body).toEqual({ reason: "invalid_body" })
  })
})

// ===========================================================================
// Resource refusal (R13 carry-over of R2) and the backend gate (KTD4)
// ===========================================================================

describe("rename route — resource refusal + backend gate", () => {
  it.each([
    ["anon resource", "anon:3f9a2b10-9c1c-4b5f-a2d5-0e7c66666666"],
    ["dogfood fallback resource", "seeker-dogfood"],
    ["blank resource", ""],
  ])("refuses %s with 403 before any store I/O", async (_label, resourceId) => {
    const h = harness()
    const backendProbe = vi.fn(() => "postgres" as const)
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, {
        readJson: async () => renameBody({ resourceId }),
        getBackend: backendProbe,
      }),
    )
    expect(outcome.status).toBe(403)
    expect(outcome.body).toEqual({ reason: "resource_forbidden" })
    expect(backendProbe).not.toHaveBeenCalled()
    expect(h.getCalls).toHaveLength(0)
    expect(h.queries).toHaveLength(0)
  })

  it("answers 503 writes_disabled when the ai-chat backend is not postgres — no Memory, no pool", async () => {
    const h = harness()
    const getMemory = vi.fn(() => h.memory)
    const getPool = vi.fn(() => h.pool)
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, {
        getBackend: () => "memory",
        getMemory,
        getPool,
      }),
    )
    expect(outcome.status).toBe(503)
    expect(outcome.body).toEqual({ reason: "writes_disabled" })
    // Before any store construction: neither seam is even invoked.
    expect(getMemory).not.toHaveBeenCalled()
    expect(getPool).not.toHaveBeenCalled()
    expect(h.getCalls).toHaveLength(0)
    expect(h.queries).toHaveLength(0)
  })

  it("proceeds to the store when the backend is postgres (discriminating companion)", async () => {
    const h = harness()
    const getMemory = vi.fn(() => h.memory)
    const getPool = vi.fn(() => h.pool)
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, { getBackend: () => "postgres", getMemory, getPool }),
    )
    expect(outcome.status).toBe(200)
    expect(getMemory).toHaveBeenCalledTimes(1)
    expect(getPool).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// Ownership + existence (AE4, KTD3/KTD4)
// ===========================================================================

describe("rename route — ownership + existence", () => {
  it("covers AE4: another subject's resourceId for a thread it does not own answers 403 thread_forbidden and no SQL executes", async () => {
    const h = harness({ threadOwner: "user:victim" })
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, {
        readJson: async () => renameBody({ resourceId: "user:attacker" }),
      }),
    )
    expect(outcome.status).toBe(403)
    expect(outcome.body).toEqual({ reason: "thread_forbidden" })
    expect(h.getCalls).toEqual([{ threadId: THREAD_ID }])
    expect(h.queries).toHaveLength(0)
  })

  it("positive companion: the pool spy IS live — the owner's rename reaches exactly one UPDATE", async () => {
    // Proves the `queries` spy above can record a call, so the AE4 no-SQL
    // assertion cannot pass vacuously on a disconnected spy.
    const h = harness({ threadOwner: OWNER })
    const outcome = await handleAiChatHistoryRenameRequest(renameInput(h))
    expect(outcome.status).toBe(200)
    expect(h.queries).toHaveLength(1)
  })

  it("answers 404 thread_not_found for a missing thread with no SQL", async () => {
    const h = harness({ threadOwner: undefined })
    const outcome = await handleAiChatHistoryRenameRequest(renameInput(h))
    expect(outcome.status).toBe(404)
    expect(outcome.body).toEqual({ reason: "thread_not_found" })
    expect(h.queries).toHaveLength(0)
  })

  it("answers 404 thread_not_found when the UPDATE matches no row after the resolver passed (post-resolver race)", async () => {
    const h = harness({ threadOwner: OWNER }, { rowCount: 0 })
    const outcome = await handleAiChatHistoryRenameRequest(renameInput(h))
    expect(outcome.status).toBe(404)
    expect(outcome.body).toEqual({ reason: "thread_not_found" })
    expect(h.queries).toHaveLength(1)
  })
})

// ===========================================================================
// Happy path + clamp (R11, AE2 server half, AE3)
// ===========================================================================

describe("rename route — happy path + clamp", () => {
  it("owner renames own thread: 200 with the clamped title; ONE UPDATE bound to (clamped title, thread id, caller resource)", async () => {
    const h = harness({ threadOwner: OWNER })
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, {
        readJson: async () =>
          renameBody({ title: "  Who  is   Jesus?\n really " }),
      }),
    )
    expect(outcome.status).toBe(200)
    expect(outcome.body).toEqual({ ok: true, title: "Who is Jesus? really" })
    expect(h.queries).toHaveLength(1)
    expect(h.queries[0]!.values).toEqual([
      "Who is Jesus? really",
      THREAD_ID,
      OWNER,
    ])
    // Exactly the wire keys — nothing else rides along.
    expect(Object.keys(outcome.body as object)).toEqual(["ok", "title"])
  })

  it.each([
    { raw: "a".repeat(119) + "😀", stored: "a".repeat(119) + "\ufffd" },
    { raw: "before\ud800after", stored: "before\ufffdafter" },
    { raw: "Valid 😀 title", stored: "Valid 😀 title" },
  ])(
    "binds and echoes the UTF-8 storage value for $raw",
    async ({ raw, stored }) => {
      const h = harness()
      const outcome = await handleAiChatHistoryRenameRequest(
        renameInput(h, { readJson: async () => renameBody({ title: raw }) }),
      )
      expect(outcome).toEqual({
        status: 200,
        body: { ok: true, title: stored },
      })
      expect(h.queries[0]?.values).toEqual([stored, THREAD_ID, OWNER])
    },
  )

  it("covers AE3: a 130-unit title from a 3-byte script is stored and echoed as the 120-unit clamp", async () => {
    const h = harness({ threadOwner: OWNER })
    const raw = "あ".repeat(130)
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, { readJson: async () => renameBody({ title: raw }) }),
    )
    expect(outcome.status).toBe(200)
    const body = outcome.body as { ok: true; title: string }
    expect(body.title).toBe("あ".repeat(AI_CHAT_TITLE_MAX_UNITS))
    expect(body.title).toHaveLength(120)
    expect(h.queries[0]!.values?.[0]).toBe("あ".repeat(AI_CHAT_TITLE_MAX_UNITS))
  })

  it.each([
    ["raw empty title", ""],
    ["whitespace-only title", "   \n\t  "],
    ["invisible-format-only title", "\u200b\u200d\u2060\ufeff"],
    ["control-only title", "\u0000\u0007\u001f"],
  ])(
    "answers 400 invalid_title for a %s with no SQL (AE2's server half)",
    async (_label, title) => {
      const h = harness({ threadOwner: OWNER })
      const outcome = await handleAiChatHistoryRenameRequest(
        renameInput(h, { readJson: async () => renameBody({ title }) }),
      )
      expect(outcome.status).toBe(400)
      expect(outcome.body).toEqual({ reason: "invalid_title" })
      expect(h.queries).toHaveLength(0)
    },
  )

  it("refuses on the clamped result, not on a raw-vs-clamped comparison: a title that clamps to non-empty text proceeds", async () => {
    // The title-repair sweep compares raw against clamped to tell a generation
    // failure from an untitled thread; on a write route only the clamped
    // emptiness matters. A raw title that changes under the clamp is fine.
    const h = harness({ threadOwner: OWNER })
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, {
        readJson: async () => renameBody({ title: "\u200bHello\u200b" }),
      }),
    )
    expect(outcome.status).toBe(200)
    expect(outcome.body).toEqual({ ok: true, title: "Hello" })
  })
})

// ===========================================================================
// SQL-shape invariant (KTD3, R12 / AE1's mocked half)
// ===========================================================================

describe("rename route — SQL-shape invariant (KTD3)", () => {
  it("UPDATE sets title only — never updatedAt or updatedAtZ — and predicates on id AND resourceId", async () => {
    // Why this test exists: the list route orders the sidebar by
    // `updatedAt DESC` and the retention purge keys the 25-day window on the
    // same column, so a SET clause that touched `updatedAt` would move the
    // renamed row to the top of the rail AND reset its retention clock
    // (KD6/R12). The `"resourceId" = $3` predicate is the blast-radius bound
    // by construction (the SQL `=` exemption in the single-predicate law).
    // Do not delete this as noise; it is the mocked half of AE1.
    const h = harness({ threadOwner: OWNER })
    await handleAiChatHistoryRenameRequest(renameInput(h))
    expect(h.queries).toHaveLength(1)
    const text = h.queries[0]!.text
    const setClause = /SET\s+([\s\S]*?)\s+WHERE/i.exec(text)?.[1] ?? ""
    expect(setClause).toMatch(/^title\s*=\s*\$1$/)
    expect(setClause).not.toMatch(/updatedAt/i)
    expect(setClause).not.toMatch(/updatedAtZ/i)
    expect(text).not.toMatch(/"updatedAt"/)
    expect(text).not.toMatch(/"updatedAtZ"/)
    const whereClause = /WHERE\s+([\s\S]*)$/i.exec(text)?.[1] ?? ""
    expect(whereClause).toMatch(/\bid\s*=\s*\$2\b/)
    expect(whereClause).toMatch(/"resourceId"\s*=\s*\$3\b/)
    expect(whereClause).toMatch(/\bAND\b/)
    // Exact equality, never LIKE — the caller's RESOLVED resource is the bound.
    expect(whereClause).not.toMatch(/\bLIKE\b/i)
    expect(text).toMatch(/^UPDATE\s+ai_chat\.mastra_threads\b/)
    expect(h.queries[0]!.values).toEqual([TITLE, THREAD_ID, OWNER])
  })
})

// ===========================================================================
// Failure mapping (fail closed) + budget
// ===========================================================================

describe("rename route — failure mapping", () => {
  it("maps a resolver store rejection to 500 store_failed — never thread_not_found — with no exception text on wire or logs; no SQL", async () => {
    const { logged } = captureConsole()
    const h = harness({
      getThreadByIdImpl: async () => {
        throw new Error("connection refused SECRET_HOST")
      },
    })
    const outcome = await handleAiChatHistoryRenameRequest(renameInput(h))
    expect(outcome.status).toBe(500)
    expect(outcome.body).toEqual({ reason: "store_failed" })
    expect(JSON.stringify(outcome.body)).not.toContain("SECRET_HOST")
    expect(logged()).not.toContain("SECRET_HOST")
    expect(logged()).toContain(
      "[ai-chat-history] event=rename_failed reason=store_failed",
    )
    expect(h.queries).toHaveLength(0)
  })

  it("maps an UPDATE rejection after a passing resolution to 500 store_failed", async () => {
    const h = harness(
      { threadOwner: OWNER },
      {
        queryImpl: async () => {
          throw new Error("statement timeout SECRET_SQL")
        },
      },
    )
    const outcome = await handleAiChatHistoryRenameRequest(renameInput(h))
    expect(outcome.status).toBe(500)
    expect(outcome.body).toEqual({ reason: "store_failed" })
    expect(JSON.stringify(outcome.body)).not.toContain("SECRET_SQL")
  })

  it("maps a synchronous Memory-construction throw to 500 store_failed (closed outcome shape)", async () => {
    const h = harness()
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, {
        getMemory: () => {
          throw new Error("no store")
        },
      }),
    )
    expect(outcome.status).toBe(500)
    expect(outcome.body).toEqual({ reason: "store_failed" })
  })

  it("bounds a never-resolving resolver read by the injected budget as 504 timeout, no SQL", async () => {
    const h = harness({ getThreadByIdImpl: () => new Promise(() => {}) })
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, { budgetMs: 20 }),
    )
    expect(outcome.status).toBe(504)
    expect(outcome.body).toEqual({ reason: "timeout" })
    expect(h.queries).toHaveLength(0)
  })

  it("bounds a never-resolving UPDATE by the injected budget as 504 timeout", async () => {
    const h = harness(
      { threadOwner: OWNER },
      { queryImpl: () => new Promise(() => {}) },
    )
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(h, { budgetMs: 20 }),
    )
    expect(outcome.status).toBe(504)
    expect(outcome.body).toEqual({ reason: "timeout" })
  })

  it("unhandled-rejection pin: an inner promise that rejects AFTER the budget aborted is still settled (settleWithinBudget new-caller obligation)", async () => {
    // The repo's budget-helper law: a `(promise, signal)` helper must settle
    // the caller-constructed promise on every exit path. This route is a new
    // caller of `settleWithinBudget`, so re-audit at THIS layer: a late
    // rejection after the 504 must not escape as an unhandled rejection
    // (process-fatal in the no-global-handler single-replica runtime).
    const escaped: unknown[] = []
    const listener = (reason: unknown) => {
      escaped.push(reason)
    }
    process.on("unhandledRejection", listener)
    try {
      const h = harness(
        { threadOwner: OWNER },
        {
          queryImpl: () =>
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("late pg failure")), 60),
            ),
        },
      )
      const outcome = await handleAiChatHistoryRenameRequest(
        renameInput(h, { budgetMs: 10 }),
      )
      expect(outcome.status).toBe(504)
      // Let the late rejection fire and the microtask queue drain.
      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(escaped).toEqual([])
    } finally {
      process.off("unhandledRejection", listener)
    }
  })
})

// ===========================================================================
// Logging (R15, KTD13): enum-only, never a title, thread id, or resource id
// ===========================================================================

describe("rename route — logging never carries a title, thread id, or resource id (R15)", () => {
  const SENTINEL_TITLE = "SENTINEL_TITLE_9f1c"
  const SENTINEL_THREAD = "SENTINEL_THREAD_9f1c"
  const SENTINEL_RESOURCE = "user:SENTINEL_SUB_9f1c"
  const SENTINEL_FOREIGN = "user:SENTINEL_FOREIGN_9f1c"

  function sentinelBody(over: Record<string, unknown> = {}): unknown {
    return {
      resourceId: SENTINEL_RESOURCE,
      threadId: SENTINEL_THREAD,
      title: SENTINEL_TITLE,
      ...over,
    }
  }

  const branches: Array<{
    label: string
    status: number
    run: () => Promise<{ status: number; body: unknown }>
  }> = [
    {
      label: "resource_forbidden",
      status: 403,
      run: () =>
        handleAiChatHistoryRenameRequest(
          renameInput(harness(), {
            readJson: async () =>
              sentinelBody({ resourceId: "anon:SENTINEL_ANON_9f1c" }),
          }),
        ),
    },
    {
      label: "writes_disabled",
      status: 503,
      run: () =>
        handleAiChatHistoryRenameRequest(
          renameInput(harness(), {
            readJson: async () => sentinelBody(),
            getBackend: () => "memory",
          }),
        ),
    },
    {
      label: "thread_forbidden",
      status: 403,
      run: () =>
        handleAiChatHistoryRenameRequest(
          renameInput(harness({ threadOwner: SENTINEL_FOREIGN }), {
            readJson: async () => sentinelBody(),
          }),
        ),
    },
    {
      label: "thread_not_found (missing)",
      status: 404,
      run: () =>
        handleAiChatHistoryRenameRequest(
          renameInput(harness({ threadOwner: undefined }), {
            readJson: async () => sentinelBody(),
          }),
        ),
    },
    {
      label: "thread_not_found (race, rowCount 0)",
      status: 404,
      run: () =>
        handleAiChatHistoryRenameRequest(
          renameInput(
            harness({ threadOwner: SENTINEL_RESOURCE }, { rowCount: 0 }),
            { readJson: async () => sentinelBody() },
          ),
        ),
    },
    {
      label: "invalid_title",
      status: 400,
      run: () =>
        handleAiChatHistoryRenameRequest(
          renameInput(harness({ threadOwner: SENTINEL_RESOURCE }), {
            readJson: async () => sentinelBody({ title: "\u200b" }),
          }),
        ),
    },
    {
      label: "invalid_body",
      status: 400,
      run: () =>
        handleAiChatHistoryRenameRequest(
          renameInput(harness(), {
            readJson: async () => sentinelBody({ title: 42 }),
          }),
        ),
    },
    {
      label: "store_failed",
      status: 500,
      run: () =>
        handleAiChatHistoryRenameRequest(
          renameInput(
            harness({
              getThreadByIdImpl: async () => {
                throw new Error(
                  `pg exploded for ${SENTINEL_THREAD} of ${SENTINEL_RESOURCE}`,
                )
              },
            }),
            { readJson: async () => sentinelBody() },
          ),
        ),
    },
    {
      label: "timeout",
      status: 504,
      run: () =>
        handleAiChatHistoryRenameRequest(
          renameInput(
            harness({ getThreadByIdImpl: () => new Promise(() => {}) }),
            { readJson: async () => sentinelBody(), budgetMs: 20 },
          ),
        ),
    },
    {
      label: "success",
      status: 200,
      run: () =>
        handleAiChatHistoryRenameRequest(
          renameInput(harness({ threadOwner: SENTINEL_RESOURCE }), {
            readJson: async () => sentinelBody(),
          }),
        ),
    },
  ]

  it.each(branches.map((b) => [b.label, b] as const))(
    "%s branch logs no sentinel",
    async (_label, branch) => {
      const { logged } = captureConsole()
      const outcome = await branch.run()
      expect(outcome.status).toBe(branch.status)
      const text = logged()
      expect(text).not.toContain(SENTINEL_TITLE)
      expect(text).not.toContain(SENTINEL_THREAD)
      expect(text).not.toContain("SENTINEL_SUB_9f1c")
      expect(text).not.toContain("SENTINEL_FOREIGN_9f1c")
      expect(text).not.toContain("SENTINEL_ANON_9f1c")
    },
  )

  it("success branch logs NOTHING (the sweep's success row cannot pass vacuously)", async () => {
    // The `no sentinel` assertion above is vacuous on a branch that never
    // logs; this pins the actual contract — the read routes log nothing on
    // success either — so a future success-path log line (which would be
    // the first place a title could leak) fails here rather than slipping
    // past a sentinel-only check.
    const { logged } = captureConsole()
    const outcome = await handleAiChatHistoryRenameRequest(
      renameInput(harness({ threadOwner: SENTINEL_RESOURCE }), {
        readJson: async () => sentinelBody(),
      }),
    )
    expect(outcome.status).toBe(200)
    expect(logged()).toBe("")
  })

  it("positive companion: the console capture is live — a refusal branch does log its enum line", async () => {
    const { logged } = captureConsole()
    await handleAiChatHistoryRenameRequest(
      renameInput(harness({ threadOwner: SENTINEL_FOREIGN }), {
        readJson: async () => sentinelBody(),
      }),
    )
    expect(logged()).toContain(
      "[ai-chat-history] event=thread_access_rejected surface=rename reason=thread_forbidden",
    )
  })
})

// ===========================================================================
// Pool options (Assumptions): every timeout strictly below the route budget
// ===========================================================================

describe("rename route — pool options", () => {
  it("pins max 2 and the three timeouts, each strictly below the 8s route budget", () => {
    expect(AI_CHAT_RENAME_POOL_OPTIONS).toEqual({
      max: 2,
      allowExitOnIdle: true,
      connectionTimeoutMillis: 2_000,
      query_timeout: 5_000,
      statement_timeout: 5_000,
    })
    // `settleWithinBudget` races without aborting the inner query, so the
    // pool's own ceilings must expire before the 8s budget does.
    for (const ms of [
      AI_CHAT_RENAME_POOL_OPTIONS.connectionTimeoutMillis,
      AI_CHAT_RENAME_POOL_OPTIONS.query_timeout,
      AI_CHAT_RENAME_POOL_OPTIONS.statement_timeout,
    ]) {
      expect(ms).toBeLessThan(TIME_BUDGET_MS.historyRead)
    }
  })
})

// ===========================================================================
// Source pins: the route reads from the PERSISTED store, never the
// kill-switch-resolved Memory (KTD4)
// ===========================================================================

describe("rename route — persisted-store source pin (KTD4)", () => {
  // Comments stripped: the header PROSE names `getAiChatMemory()` to say why
  // it is never used; the pin is on code, not on the explanation.
  const source = readFileSync(
    fileURLToPath(new URL("./ai-chat-history-write-route.ts", import.meta.url)),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

  it("builds its Memory over getAiChatStorage and never references getAiChatMemory in code", () => {
    expect(source).toMatch(/\bgetAiChatStorage\b/)
    expect(source).toMatch(/new Memory\(\{ storage: getAiChatStorage\(\) \}\)/)
    expect(source).toMatch(/connectionString: getMastraDatabaseUrl\(\)/)
    expect(source).not.toMatch(/\bgetAiChatMemory\b/)
    // The title-repair rationale it deliberately does NOT copy: this route
    // uses the same resolver the persisted store uses, never env.DATABASE_URL.
    expect(source).not.toMatch(/env\.DATABASE_URL/)
  })
})

// ===========================================================================
// Timestamp-trigger dist pin (AE1's package half, KTD3)
// ===========================================================================

describe("@mastra/pg timestamp-trigger scope (pinned dist fact, KTD3)", () => {
  // Re-verified 2026-09-06 against @mastra/pg 1.22.3 (title-repair's original
  // read was 2026-08-28). The SET-clause omission of `updatedAt` in the
  // rename UPDATE keeps the retention clock and the rail order intact ONLY
  // because no database trigger bumps the column on `mastra_threads`. The
  // installed dist installs `trigger_set_timestamps` — which DOES rewrite
  // `updatedAt`/`updatedAtZ` to NOW() on UPDATE — for TABLE_SPANS alone. A
  // `@mastra/*` bump that widens that gate must fail here, not in production
  // as silently reset retention clocks and a reordered sidebar.
  // The ESM build — what the service runs (`--import tsx`, Node ESM
  // resolution takes the `import` export condition). `require.resolve` alone
  // would hand back the CJS twin, whose identifiers are namespace-prefixed.
  const require = createRequire(import.meta.url)
  const packageJsonPath = require.resolve("@mastra/pg/package.json")
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    exports: { ".": { import: { default: string } } }
  }
  const dist = readFileSync(
    new URL(
      packageJson.exports["."].import.default,
      `file://${packageJsonPath}`,
    ),
    "utf8",
  )

  it("anti-vacuous: the trigger it guards really rewrites updatedAt on UPDATE", () => {
    expect(dist).toContain("trigger_set_timestamps")
    expect(dist).toMatch(
      /ELSIF TG_OP = 'UPDATE' THEN\s*NEW\."updatedAt" = NOW\(\);\s*NEW\."updatedAtZ" = NOW\(\);/,
    )
  })

  it("installs the timestamp trigger under a TABLE_SPANS-only gate at its single runtime call site", () => {
    const callSites = dist.match(/this\.setupTimestampTriggers\(/g) ?? []
    expect(callSites).toHaveLength(1)
    // The one call is immediately guarded by `tableName === TABLE_SPANS`.
    expect(dist).toMatch(
      /if \(tableName === TABLE_SPANS\) \{\s*await this\.setupTimestampTriggers\(tableName\);/,
    )
  })

  it("never generates the trigger SQL for any table other than the guarded tableName or the TABLE_SPANS literal", () => {
    const generatorCalls = [
      ...dist.matchAll(/generateTimestampTriggerSQL\(([^,)]+),/g),
    ].map((m) => m[1]!.trim())
    // One inside setupTimestampTriggers (the guarded `tableName`), and the
    // CLI migration export which passes the spans literal — nothing else.
    expect(generatorCalls.length).toBeGreaterThan(0)
    for (const arg of generatorCalls) {
      expect(["tableName", "TABLE_SPANS"]).toContain(arg)
    }
    expect(dist).not.toMatch(/generateTimestampTriggerSQL\(TABLE_THREADS/)
  })
})
