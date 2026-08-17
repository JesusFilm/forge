import { describe, expect, it, vi } from "vitest"

import {
  ERASURE_PROBE_THREAD_ID,
  executeAiChatErasure,
  previewAiChatErasure,
  type AiChatErasureLog,
  type AiChatErasureMemory,
  type AiChatErasureMemoryAcquisition,
} from "./ai-chat-erasure"
import { SEEKER_DEFAULT_RESOURCE_ID } from "./ai-chat-thread-ownership"

type ListCall = {
  filter?: { resourceId?: string }
  page?: number
  perPage?: number
}

type FakeStore = {
  memory: AiChatErasureMemory
  listCalls: ListCall[]
  deleted: string[]
  /** Sentinel connectivity-probe reads only. */
  probeIds: string[]
  /** Pre-delete ownership re-reads (non-sentinel `getThreadById` calls). */
  ownerReads: string[]
  /** Sequence of high-level operations, in order, for ordering assertions. */
  operations: string[]
}

/**
 * Store fake mirroring the production contract the erasure relies on:
 * `listThreads` filters by EXACT resourceId, paginates, and returns rows that
 * carry their own `resourceId` (as `@mastra/pg` does); `getThreadById` answers
 * the thread's owner, or null for a missing/deleted id; `deleteThread` removes
 * the thread.
 *
 * `pageSize` is the fake STORE's page size, deliberately independent of the
 * `perPage` the module asks for: a store is free to return fewer rows than
 * requested with `hasMore: true`, and driving pagination from the fake's own
 * size is what lets a small fixture exercise the multi-page path at all.
 */
function fakeStore(
  threadsByResource: Record<string, string[]>,
  overrides: Partial<AiChatErasureMemory> = {},
  pageSize = 100,
): FakeStore {
  const listCalls: ListCall[] = []
  const deleted: string[] = []
  const probeIds: string[] = []
  const ownerReads: string[] = []
  const operations: string[] = []
  const gone = new Set<string>()

  const ownerOf = new Map<string, string>()
  for (const [resourceId, ids] of Object.entries(threadsByResource)) {
    for (const id of ids) ownerOf.set(id, resourceId)
  }

  const memory: AiChatErasureMemory = {
    listThreads: async (args) => {
      listCalls.push(args)
      operations.push("list")
      const all = (
        threadsByResource[args.filter?.resourceId ?? ""] ?? []
      ).filter((id) => !gone.has(id))
      const page = args.page ?? 0
      const start = page * pageSize
      return {
        threads: all
          .slice(start, start + pageSize)
          .map((id) => ({ id, resourceId: ownerOf.get(id) ?? null })),
        hasMore: start + pageSize < all.length,
      }
    },
    getThreadById: async ({ threadId }) => {
      // The sentinel connectivity probe and the pre-delete ownership re-read
      // share this method; they are recorded separately so a test can assert
      // on either without the other's calls muddying the count.
      if (threadId === ERASURE_PROBE_THREAD_ID) {
        probeIds.push(threadId)
        operations.push("probe")
        return null
      }
      ownerReads.push(threadId)
      operations.push("owner_read")
      if (gone.has(threadId)) return null
      const resourceId = ownerOf.get(threadId)
      return resourceId === undefined ? null : { resourceId }
    },
    deleteThread: async (threadId) => {
      operations.push("delete")
      deleted.push(threadId)
      gone.add(threadId)
    },
    ...overrides,
  }

  return { memory, listCalls, deleted, probeIds, ownerReads, operations }
}

function acquiring(
  memory: AiChatErasureMemory,
): () => AiChatErasureMemoryAcquisition {
  return () => ({ ok: true, memory })
}

function recordingLog(): { log: AiChatErasureLog; lines: string[] } {
  const lines: string[] = []
  return {
    log: {
      info: (line) => lines.push(line),
      warn: (line) => lines.push(line),
    },
    lines,
  }
}

describe("ai-chat erasure — refusals (R2, AE8)", () => {
  it("refuses the exact shared fallback resource and never acquires a store", async () => {
    const acquireMemory = vi.fn<() => AiChatErasureMemoryAcquisition>()
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: SEEKER_DEFAULT_RESOURCE_ID,
      acquireMemory,
      log,
    })

    expect(result).toEqual({
      kind: "refused",
      reason: "shared_fallback_resource",
    })
    // No store is CONSTRUCTED, let alone called — the refusal is upstream of
    // the acquisition seam entirely.
    expect(acquireMemory).not.toHaveBeenCalled()
    expect(lines).toEqual([
      "[ai-chat-erasure] event=refused reason=shared_fallback_resource",
    ])
  })

  it("refuses the fallback key on the read-only preview path too", async () => {
    const acquireMemory = vi.fn<() => AiChatErasureMemoryAcquisition>()

    const result = await previewAiChatErasure({
      resourceId: SEEKER_DEFAULT_RESOURCE_ID,
      acquireMemory,
      log: recordingLog().log,
    })

    expect(result).toEqual({
      kind: "refused",
      reason: "shared_fallback_resource",
    })
    expect(acquireMemory).not.toHaveBeenCalled()
  })

  it.each([
    ["empty", ""],
    ["whitespace-only", "   "],
    ["tab and newline", "\t\n"],
  ])(
    "refuses a %s resourceId without touching the store",
    async (_label, resourceId) => {
      const acquireMemory = vi.fn<() => AiChatErasureMemoryAcquisition>()

      const result = await executeAiChatErasure({
        resourceId,
        acquireMemory,
        log: recordingLog().log,
      })

      expect(result).toEqual({ kind: "refused", reason: "blank_resource_id" })
      expect(acquireMemory).not.toHaveBeenCalled()
    },
  )

  it("treats a whitespace-padded fallback key as a DIFFERENT key (exact equality, never normalized)", async () => {
    const store = fakeStore({})

    const result = await previewAiChatErasure({
      resourceId: ` ${SEEKER_DEFAULT_RESOURCE_ID}`,
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    // Not refused: it is a different (and here, empty) resource key. The point
    // is that R2's equality is never softened into a normalized comparison.
    expect(result).toMatchObject({ kind: "completed" })
    expect(store.listCalls[0]?.filter).toEqual({
      resourceId: ` ${SEEKER_DEFAULT_RESOURCE_ID}`,
    })
  })

  it("refuses when DATABASE_URL is absent, before any store call", async () => {
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: () => ({ ok: false, reason: "database_url_missing" }),
      log,
    })

    expect(result).toEqual({ kind: "refused", reason: "database_url_missing" })
    expect(lines).toEqual([
      "[ai-chat-erasure] event=refused reason=database_url_missing",
    ])
  })
})

describe("ai-chat erasure — preview (R3, AE2)", () => {
  it("counts by exact resourceId filter and deletes nothing", async () => {
    const store = fakeStore({ "user:abc": ["t1", "t2", "t3"] })

    const result = await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(result).toEqual({
      kind: "completed",
      mode: "preview",
      postgres: { kind: "counted", threadCount: 3 },
      langfuse: { kind: "not_implemented" },
    })
    // The key-equality seam: the filter argument is asserted exactly.
    expect(store.listCalls[0]?.filter).toEqual({ resourceId: "user:abc" })
    expect(store.deleted).toEqual([])
    expect(store.operations).not.toContain("delete")
  })

  it("leaves a prefix-adjacent neighbour untouched (AE1, mocked half)", async () => {
    const store = fakeStore({
      "user:abc": ["t1"],
      "user:abcd": ["n1", "n2"],
    })

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(result).toMatchObject({
      postgres: { kind: "erased", threadsDeleted: 1 },
    })
    expect(store.deleted).toEqual(["t1"])
    expect(store.deleted).not.toContain("n1")
    expect(store.deleted).not.toContain("n2")
  })

  it("reports a distinct no-data outcome behind a healthy probe (AE7)", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { log, lines } = recordingLog()

    const result = await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
    })

    expect(result).toMatchObject({ postgres: { kind: "no_data" } })
    // Probed twice: once before the listing, once before REPORTING a zero.
    expect(store.probeIds).toEqual([
      ERASURE_PROBE_THREAD_ID,
      ERASURE_PROBE_THREAD_ID,
    ])
    expect(lines).toEqual([
      "[ai-chat-erasure] event=preview_complete postgres=no_data langfuse=not_implemented",
    ])
  })

  it("reports execute-mode no data as a distinct outcome, deleting nothing (AE7)", async () => {
    const store = fakeStore({ "user:abc": [] })

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    // Not `erased threadsDeleted: 0` — an operator must never file a
    // no-such-data run as a completed erasure.
    expect(result).toMatchObject({
      mode: "execute",
      postgres: { kind: "no_data" },
    })
    expect(store.deleted).toEqual([])
  })
})

describe("ai-chat erasure — filter integrity (R2)", () => {
  it("refuses the whole run when the listing returns another resource's row", async () => {
    // The failure this exists for: a `@mastra/pg` bump renames or neuters the
    // `filter` argument and the store answers with every thread it has. Every
    // mocked fake implements the filter as `===` because that is the contract,
    // so without this re-check nothing in CI could go red.
    const store = fakeStore(
      { "user:abc": ["t1"], "user:zzz": ["foreign-1", "foreign-2"] },
      {
        listThreads: async () => ({
          threads: [
            { id: "t1", resourceId: "user:abc" },
            { id: "foreign-1", resourceId: "user:zzz" },
            { id: "foreign-2", resourceId: "user:zzz" },
          ],
          hasMore: false,
        }),
      },
    )
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
    })

    expect(result).toMatchObject({
      postgres: {
        kind: "failed",
        stage: "list",
        reason: "filter_mismatch",
        threadsDeleted: 0,
      },
    })
    // Stops the run outright — it does not quietly erase the one row that DID
    // match, because a store contradicting its own filter cannot be trusted to
    // have returned a complete or correct set either.
    expect(store.deleted).toEqual([])
    expect(lines.join("\n")).toContain("reason=filter_mismatch")
  })

  it("surfaces the same refusal on the read-only preview, before an operator commits", async () => {
    const store = fakeStore(
      {},
      {
        listThreads: async () => ({
          threads: [{ id: "foreign-1", resourceId: "user:zzz" }],
          hasMore: false,
        }),
      },
    )

    const result = await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(result).toMatchObject({
      postgres: { kind: "failed", reason: "filter_mismatch" },
    })
  })

  it("refuses a listing whose rows carry no usable id instead of reporting no_data", async () => {
    // A row-shape change must not render as "this key has no data" — that is
    // the outcome an operator files as a completed request.
    const store = fakeStore(
      {},
      {
        listThreads: async () => ({
          threads: [
            { id: "", resourceId: "user:abc" },
            { id: undefined, resourceId: "user:abc" },
          ] as unknown as Array<{ id: string; resourceId?: string | null }>,
          hasMore: false,
        }),
      },
    )

    const result = await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(result).toMatchObject({
      postgres: { kind: "failed", stage: "list", reason: "unreadable_rows" },
    })
  })

  it("re-reads each thread's owner immediately before deleting it", async () => {
    const store = fakeStore({ "user:abc": ["t1", "t2"] })

    await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(store.ownerReads).toEqual(["t1", "t2"])
    // Interleaved read-then-delete per thread, not one bulk read up front.
    expect(store.operations.slice(-4)).toEqual([
      "owner_read",
      "delete",
      "owner_read",
      "delete",
    ])
  })

  it("fails CLOSED when a thread's own resourceId is absent — ownership is proven, not assumed", async () => {
    // The layer that survives a listing whose rows stop carrying `resourceId`
    // at all: the collect-time check cannot see the problem, so the pre-delete
    // re-read must refuse rather than take the listing's word for it.
    const store = fakeStore(
      { "user:abc": ["t1"] },
      { getThreadById: async () => ({ resourceId: null }) },
    )

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(result).toMatchObject({
      postgres: {
        kind: "failed",
        stage: "delete",
        reason: "filter_mismatch",
        threadsDeleted: 0,
      },
    })
    expect(store.deleted).toEqual([])
  })

  it("treats a thread that vanished between collect and delete as benign", async () => {
    // Concurrently deleted, or left by an interrupted earlier run. The row is
    // already gone, which is what this run wanted — not a fault.
    let reads = 0
    const store = fakeStore(
      { "user:abc": ["t1", "t2"] },
      {
        getThreadById: async ({ threadId }) => {
          if (threadId === ERASURE_PROBE_THREAD_ID) return null
          reads += 1
          return threadId === "t1" ? null : { resourceId: "user:abc" }
        },
      },
    )

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(reads).toBe(2)
    expect(result).toMatchObject({
      postgres: { kind: "erased", threadsDeleted: 1 },
    })
    expect(store.deleted).toEqual(["t2"])
  })
})

describe("ai-chat erasure — connectivity probe (KTD7)", () => {
  it("reports store_unreachable, not a zero count, when the probe rejects", async () => {
    const store = fakeStore(
      { "user:abc": ["t1"] },
      {
        getThreadById: async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.1:5432")
        },
      },
    )
    const { log, lines } = recordingLog()

    const result = await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
    })

    expect(result).toMatchObject({ postgres: { kind: "unreachable" } })
    // `listThreads` is never consulted — it swallows store faults into empty
    // results, which is exactly the false "no data" the probe exists to stop.
    expect(store.listCalls).toEqual([])
    expect(lines[0]).toBe(
      "[ai-chat-erasure] event=probe_failed stage=pre_count",
    )
    // Leak control: the thrown message never reaches a log line.
    expect(lines.join("\n")).not.toContain("ECONNREFUSED")
    expect(lines.join("\n")).not.toContain("10.0.0.1")
  })

  it("re-probes before deleting and refuses when the store went down mid-run", async () => {
    let probes = 0
    const store = fakeStore(
      { "user:abc": ["t1", "t2"] },
      {
        getThreadById: async () => {
          probes += 1
          if (probes >= 2) throw new Error("terminating connection")
          return null
        },
      },
    )
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
    })

    expect(result).toMatchObject({ postgres: { kind: "unreachable" } })
    expect(store.deleted).toEqual([])
    expect(lines[0]).toBe(
      "[ai-chat-erasure] event=probe_failed stage=pre_delete",
    )
  })

  it("does not pay for a second probe when the preview found data", async () => {
    const store = fakeStore({ "user:abc": ["t1"] })

    await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    // Only the ZERO case needs re-proving; a non-empty count is self-evidently
    // not a swallowed fault.
    expect(store.probeIds).toEqual([ERASURE_PROBE_THREAD_ID])
  })

  it("reports unreachable, not no_data, when the store dies DURING a preview listing", async () => {
    // The exact window `listThreads`'s swallow opens: the pre-count probe
    // succeeded, then the store went down mid-listing and the swallow turned
    // the fault into an empty result. Reporting `no_data` here tells the
    // operator to re-derive the key for a subject whose data is fine.
    let probes = 0
    const store = fakeStore(
      { "user:abc": ["t1"] },
      {
        getThreadById: async () => {
          probes += 1
          if (probes >= 2) throw new Error("terminating connection")
          return null
        },
        listThreads: async () => ({ threads: [], hasMore: false }),
      },
    )
    const { log, lines } = recordingLog()

    const result = await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
    })

    expect(result).toMatchObject({ postgres: { kind: "unreachable" } })
    expect(result).not.toMatchObject({ postgres: { kind: "no_data" } })
    expect(lines[0]).toBe(
      "[ai-chat-erasure] event=probe_failed stage=post_count",
    )
  })
})

describe("ai-chat erasure — collect-then-delete (KTD1)", () => {
  it("drains every page before the first delete and deletes each id once", async () => {
    const store = fakeStore(
      { "user:abc": ["t1", "t2", "t3", "t4", "t5"] },
      {},
      2,
    )

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(result).toMatchObject({
      postgres: { kind: "erased", threadsDeleted: 5 },
    })
    // Ordering contract: every `list` precedes every `delete`. Interleaving
    // would shift pages under the scan and silently skip threads.
    const firstDelete = store.operations.indexOf("delete")
    const lastList = store.operations.lastIndexOf("list")
    expect(firstDelete).toBeGreaterThan(lastList)
    expect(store.deleted).toEqual(["t1", "t2", "t3", "t4", "t5"])
    expect(new Set(store.deleted).size).toBe(store.deleted.length)
  })

  it("passes the same exact filter on every page", async () => {
    const store = fakeStore({ "user:abc": ["t1", "t2", "t3"] }, {}, 1)

    await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(store.listCalls.length).toBe(3)
    for (const call of store.listCalls) {
      expect(call.filter).toEqual({ resourceId: "user:abc" })
      // Explicit page size: the dist default is small, and silently inheriting
      // it would make the drain depend on an unpinned upstream constant.
      expect(call.perPage).toBe(100)
    }
    expect(store.listCalls.map((call) => call.page)).toEqual([0, 1, 2])
  })

  it("classifies a mid-sequence deleteThread rejection with the deleted-so-far count", async () => {
    const deleted: string[] = []
    const store = fakeStore(
      { "user:abc": ["t1", "t2", "t3"] },
      {
        deleteThread: async (threadId) => {
          if (threadId === "t2") {
            throw new Error("deadlock detected on thread abc-secret-id")
          }
          deleted.push(threadId)
        },
      },
    )
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
    })

    expect(result).toMatchObject({
      postgres: {
        kind: "failed",
        stage: "delete",
        reason: "store_error",
        threadsDeleted: 1,
      },
    })
    expect(deleted).toEqual(["t1"])
    const output = lines.join("\n")
    expect(output).toContain(
      "event=execute_complete postgres=failed stage=delete reason=store_error threads_deleted=1",
    )
    // Enum/count-only (R4): neither the thrown message nor the resource key
    // appears anywhere in the output.
    expect(output).not.toContain("deadlock")
    expect(output).not.toContain("abc-secret-id")
    expect(output).not.toContain("user:abc")
  })

  it("classifies a listThreads rejection as a list-stage failure", async () => {
    const store = fakeStore(
      { "user:abc": ["t1"] },
      {
        listThreads: async () => {
          throw new Error('relation "ai_chat.mastra_threads" does not exist')
        },
      },
    )
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
    })

    expect(result).toMatchObject({
      postgres: {
        kind: "failed",
        stage: "list",
        reason: "store_error",
        threadsDeleted: 0,
      },
    })
    expect(store.deleted).toEqual([])
    expect(lines.join("\n")).not.toContain("does not exist")
  })

  it("deletes a thread once even when the store repeats it across pages", async () => {
    // Defensive dedupe: a repeated row would otherwise inflate the reported
    // count and issue a second delete for an id already gone.
    let page = 0
    const store = fakeStore(
      { "user:abc": ["t1", "t2"] },
      {
        listThreads: async () => {
          page += 1
          return {
            threads: [
              { id: "t1", resourceId: "user:abc" },
              { id: "t2", resourceId: "user:abc" },
            ],
            hasMore: page < 2,
          }
        },
      },
    )

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(result).toMatchObject({
      postgres: { kind: "erased", threadsDeleted: 2 },
    })
    expect(store.deleted).toEqual(["t1", "t2"])
  })

  it("fails loudly rather than truncating when the page cap is exceeded", async () => {
    // A store whose `hasMore` never goes false — the shape the loop guard
    // exists for. A silent truncation here would report a successful erasure
    // over a partial set.
    const store = fakeStore(
      {},
      {
        listThreads: async () => ({
          threads: [{ id: "t1", resourceId: "user:abc" }],
          hasMore: true,
        }),
      },
    )

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(result).toMatchObject({
      postgres: {
        kind: "failed",
        stage: "list",
        reason: "page_cap_exceeded",
        threadsDeleted: 0,
      },
    })
    expect(store.deleted).toEqual([])
  })
})

describe("ai-chat erasure — Langfuse slot (KTD5)", () => {
  it("reports not_implemented in PR 1, never skipped_unconfigured", async () => {
    const store = fakeStore({ "user:abc": ["t1"] })
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
    })

    expect(result).toMatchObject({ langfuse: { kind: "not_implemented" } })
    expect(lines.join("\n")).toContain("langfuse=not_implemented")
    expect(lines.join("\n")).not.toContain("skipped_unconfigured")
  })
})

describe("ai-chat erasure — persisted-store seam (KTD1)", () => {
  it("builds Memory over getAiChatStorage() even when the kill switch is on", async () => {
    // The kill switch (`AI_CHAT_MEMORY_BACKEND=memory`) swaps
    // `getAiChatMemory()` to an InMemoryStore. An erasure over THAT would
    // report success while every Postgres row survived, so the default
    // acquisition must reach the persisted store regardless.
    vi.resetModules()
    const storage = { id: "ai-chat-storage" }
    const getAiChatStorage = vi.fn(() => storage)
    const getAiChatMemory = vi.fn()
    const memoryConstructorArgs: unknown[] = []

    vi.doMock("./ai-chat-memory", () => ({
      getAiChatStorage,
      getAiChatMemory,
    }))
    vi.doMock("@mastra/memory", () => ({
      Memory: class {
        constructor(args: unknown) {
          memoryConstructorArgs.push(args)
        }
      },
    }))
    vi.doMock("../config/env", () => ({
      env: { DATABASE_URL: "postgresql://user:pw@db.example:5432/forge" },
    }))

    const module = await import("./ai-chat-erasure")
    module.__resetAiChatErasureMemoryForTesting()
    const acquired = module.acquirePersistedErasureMemory()

    expect(acquired.ok).toBe(true)
    expect(getAiChatStorage).toHaveBeenCalledTimes(1)
    expect(getAiChatMemory).not.toHaveBeenCalled()
    expect(memoryConstructorArgs).toEqual([{ storage }])

    vi.doUnmock("./ai-chat-memory")
    vi.doUnmock("@mastra/memory")
    vi.doUnmock("../config/env")
    vi.resetModules()
  })

  it("refuses instead of falling back to the local database URL when DATABASE_URL is unset", async () => {
    vi.resetModules()
    const getAiChatStorage = vi.fn()

    vi.doMock("./ai-chat-memory", () => ({
      getAiChatStorage,
      getAiChatMemory: vi.fn(),
    }))
    vi.doMock("../config/env", () => ({
      env: { DATABASE_URL: undefined },
    }))

    const module = await import("./ai-chat-erasure")
    module.__resetAiChatErasureMemoryForTesting()
    const acquired = module.acquirePersistedErasureMemory()

    expect(acquired).toEqual({ ok: false, reason: "database_url_missing" })
    // The discriminating assertion: NO store is constructed. (An earlier
    // version also asserted `getMastraDatabaseUrl` was never called — vacuous,
    // because this module never imports it; that assertion would have passed
    // with the whole refusal deleted.)
    expect(getAiChatStorage).not.toHaveBeenCalled()

    vi.doUnmock("./ai-chat-memory")
    vi.doUnmock("../config/env")
    vi.resetModules()
  })

  it("closes the STORE's pool on disposal, not the Memory wrapper", async () => {
    // The pooled connections belong to the store; closing the Memory would be
    // a no-op and the CLI would hang after printing its report.
    vi.resetModules()
    let closed = 0
    const storage = { id: "ai-chat-storage", close: async () => void closed++ }

    vi.doMock("./ai-chat-memory", () => ({
      getAiChatStorage: () => storage,
      getAiChatMemory: vi.fn(),
    }))
    vi.doMock("@mastra/memory", () => ({ Memory: class {} }))
    vi.doMock("../config/env", () => ({
      env: { DATABASE_URL: "postgresql://user:pw@db.example:5432/forge" },
    }))

    const module = await import("./ai-chat-erasure")
    module.__resetAiChatErasureMemoryForTesting()
    module.acquirePersistedErasureMemory()
    await module.closeAiChatErasureStore()

    expect(closed).toBe(1)

    vi.doUnmock("./ai-chat-memory")
    vi.doUnmock("@mastra/memory")
    vi.doUnmock("../config/env")
    vi.resetModules()
  })

  it("is a safe no-op when no store was ever acquired", async () => {
    // A run refused at the argument gate must not CONSTRUCT a store (and open
    // a pool) just to dispose of one.
    vi.resetModules()
    const getAiChatStorage = vi.fn()

    vi.doMock("./ai-chat-memory", () => ({
      getAiChatStorage,
      getAiChatMemory: vi.fn(),
    }))
    vi.doMock("../config/env", () => ({ env: { DATABASE_URL: undefined } }))

    const module = await import("./ai-chat-erasure")
    module.__resetAiChatErasureMemoryForTesting()
    await expect(module.closeAiChatErasureStore()).resolves.toBeUndefined()
    expect(getAiChatStorage).not.toHaveBeenCalled()

    vi.doUnmock("./ai-chat-memory")
    vi.doUnmock("../config/env")
    vi.resetModules()
  })
})
