import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it, vi } from "vitest"

import type { LangfuseConfig } from "../config/env"

import {
  ERASURE_PROBE_THREAD_ID,
  ERASURE_QUOTA_RETRY_AFTER_THRESHOLD_SECONDS,
  LANGFUSE_ERASURE_PINNED_HOST,
  MAX_ERASURE_DELETE_REQUESTS_PER_RUN,
  MAX_ERASURE_LIST_PAGES_PER_RUN,
  executeAiChatErasure,
  formatLangfuseOutcome,
  previewAiChatErasure,
  type AiChatErasureLangfuseSeam,
  type AiChatErasureLog,
  type AiChatErasureMemory,
  type AiChatErasureMemoryAcquisition,
  type AiChatErasureOptions,
} from "./ai-chat-erasure"
import {
  LANGFUSE_ERASURE_LIST_PAGE_SIZE,
  MAX_TRACE_IDS_PER_DELETE_REQUEST,
} from "./langfuse-trace-retention"
import { SEEKER_DEFAULT_RESOURCE_ID } from "./ai-chat-thread-ownership"

// ── Langfuse seam fixtures ───────────────────────────────────────────────────

const LANGFUSE_CONFIG: LangfuseConfig = {
  baseUrl: `https://${LANGFUSE_ERASURE_PINNED_HOST}`,
  publicKey: "pk-test",
  secretKey: "sk-test",
  timeoutMs: 1_000,
  userAgent: "erasure-test",
  maxResponseBytes: 262_144,
  promptCacheTtlMs: 60_000,
  promptFailureCooldownMs: 10_000,
}

const UNCONFIGURED_LANGFUSE: LangfuseConfig = {
  ...LANGFUSE_CONFIG,
  baseUrl: undefined,
  publicKey: undefined,
  secretKey: undefined,
}

/**
 * Default seam for every test that is ABOUT the Postgres half: explicitly
 * unconfigured, so the Langfuse half deterministically short-circuits to
 * `skipped_unconfigured` regardless of what `LANGFUSE_*` values happen to be
 * exported in the developer's shell — and so no test can ever reach a real
 * `fetch`.
 */
const unconfiguredLangfuseSeam: AiChatErasureLangfuseSeam = {
  getConfig: () => UNCONFIGURED_LANGFUSE,
}

function runPreview(options: AiChatErasureOptions) {
  return previewAiChatErasure({
    langfuse: unconfiguredLangfuseSeam,
    ...options,
  })
}

function runExecute(options: AiChatErasureOptions) {
  return executeAiChatErasure({
    langfuse: unconfiguredLangfuseSeam,
    ...options,
  })
}

type RecordedRequest = { url: URL; init: RequestInit }

/**
 * Fetch fake driven by a queue of responders (the retention suite's shape).
 * Records every request so tests can assert the wire traffic the erasure half
 * actually produced — which requests, in which order, with which ids.
 */
function fakeLangfuseFetch(
  responders: Array<(request: RecordedRequest) => Response>,
): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const request = { url: new URL(String(input)), init: init ?? {} }
    requests.push(request)
    const responder = responders.shift()
    if (!responder) throw new Error("fakeLangfuseFetch: no responder queued")
    return responder(request)
  }) as typeof fetch
  return { fetchImpl, requests }
}

/** Seam wired to a fake fetch, configured against the pinned cloud host. */
function langfuseSeam(
  fetchImpl: typeof fetch,
  config: LangfuseConfig = LANGFUSE_CONFIG,
  allowedHosts?: string,
): AiChatErasureLangfuseSeam {
  return {
    getConfig: () => config,
    getAllowedHosts: () => allowedHosts,
    fetchImpl,
  }
}

type ObservationRow = { traceId?: unknown; userId?: unknown }

function observationsPage(
  rows: ObservationRow[],
  cursor?: string | null,
): Response {
  return new Response(
    JSON.stringify({
      data: rows.map((row, i) => ({
        id: `obs-${i}`,
        type: "AGENT_RUN",
        startTime: "2026-08-01T00:00:00.000Z",
        ...row,
      })),
      meta: { cursor: cursor ?? null },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

function rowsFor(userId: string, traceIds: string[]): ObservationRow[] {
  return traceIds.map((traceId) => ({ traceId, userId }))
}

function deleteAccepted(): Response {
  return new Response(JSON.stringify({ message: "accepted" }), { status: 200 })
}

function statusResponse(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response("", { status, headers })
}

function deleteBody(request: RecordedRequest): string[] {
  return (JSON.parse(String(request.init.body)) as { traceIds: string[] })
    .traceIds
}

function methodsOf(requests: RecordedRequest[]): string[] {
  return requests.map((r) => (r.init.method ?? "GET").toUpperCase())
}

function deleteRequestsOf(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter(
    (r) => (r.init.method ?? "GET").toUpperCase() === "DELETE",
  )
}

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

    const result = await runExecute({
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

    const result = await runPreview({
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

      const result = await runExecute({
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

    const result = await runPreview({
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

    const result = await runExecute({
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

    const result = await runPreview({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
    })

    expect(result).toEqual({
      kind: "completed",
      mode: "preview",
      postgres: { kind: "counted", threadCount: 3 },
      langfuse: { kind: "skipped_unconfigured" },
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

    const result = await runExecute({
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

    const result = await runPreview({
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
      "[ai-chat-erasure] event=preview_complete postgres=no_data langfuse=skipped_unconfigured",
    ])
  })

  it("reports execute-mode no data as a distinct outcome, deleting nothing (AE7)", async () => {
    const store = fakeStore({ "user:abc": [] })

    const result = await runExecute({
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

    const result = await runExecute({
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

    const result = await runPreview({
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

    const result = await runPreview({
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

    await runExecute({
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

    const result = await runExecute({
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

    const result = await runExecute({
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

    const result = await runPreview({
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

    const result = await runExecute({
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

    await runPreview({
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

    const result = await runPreview({
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

    const result = await runExecute({
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

    await runPreview({
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

    const result = await runExecute({
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

    const result = await runExecute({
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

    const result = await runExecute({
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

    const result = await runExecute({
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

describe("ai-chat erasure — Langfuse config gate (AE5)", () => {
  it("reports skipped_unconfigured when the trio is absent, with the Postgres half unaffected", async () => {
    const store = fakeStore({ "user:abc": ["t1"] })
    const { log, lines } = recordingLog()

    const result = await runExecute({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
    })

    expect(result).toMatchObject({
      postgres: { kind: "erased", threadsDeleted: 1 },
      langfuse: { kind: "skipped_unconfigured" },
    })
    expect(lines.join("\n")).toContain("langfuse=skipped_unconfigured")
  })

  it("requires the FULL trio — a partial credential set is still unconfigured", async () => {
    const store = fakeStore({ "user:abc": [] })
    const fetchSpy = vi.fn()

    const result = await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
      langfuse: {
        getConfig: () => ({ ...LANGFUSE_CONFIG, secretKey: undefined }),
        fetchImpl: fetchSpy as unknown as typeof fetch,
      },
    })

    expect(result).toMatchObject({
      langfuse: { kind: "skipped_unconfigured" },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("ai-chat erasure — Langfuse egress pin (KTD11)", () => {
  it.each([
    [
      "a non-https base URL",
      `http://${LANGFUSE_ERASURE_PINNED_HOST}`,
      undefined,
    ],
    ["a host off the pinned default", "https://evil.example", undefined],
    [
      "a host off the configured allowlist",
      `https://${LANGFUSE_ERASURE_PINNED_HOST}`,
      "langfuse.example",
    ],
    ["an unparseable base URL", "not-a-url", undefined],
  ])(
    "refuses %s with ZERO list/delete requests — never a no-data outcome",
    async (_label, baseUrl, allowedHosts) => {
      const store = fakeStore({ "user:abc": ["t1"] })
      const { fetchImpl, requests } = fakeLangfuseFetch([])
      const { log, lines } = recordingLog()

      const result = await executeAiChatErasure({
        resourceId: "user:abc",
        acquireMemory: acquiring(store.memory),
        log,
        langfuse: langfuseSeam(
          fetchImpl,
          { ...LANGFUSE_CONFIG, baseUrl },
          allowedHosts,
        ),
      })

      expect(result).toMatchObject({ langfuse: { kind: "egress_refused" } })
      expect(result).not.toMatchObject({ langfuse: { kind: "no_data" } })
      // The load-bearing half of KTD11: the refusal happens BEFORE any
      // request is built, so nothing reached the wire.
      expect(requests).toEqual([])
      expect(lines.join("\n")).toContain("event=langfuse_egress_refused")
    },
  )

  it("accepts a host the LANGFUSE_ALLOWED_HOSTS CSV allows, overriding the pinned default", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage([]),
    ])

    const result = await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
      langfuse: langfuseSeam(
        fetchImpl,
        { ...LANGFUSE_CONFIG, baseUrl: "https://langfuse.example" },
        " other.example , LANGFUSE.example ",
      ),
    })

    expect(result).toMatchObject({ langfuse: { kind: "no_data" } })
    expect(requests).toHaveLength(1)
  })
})

describe("ai-chat erasure — Langfuse listing (R7/AE6)", () => {
  it("previews the deduped visible-trace count with zero deletes", async () => {
    const store = fakeStore({ "user:abc": ["t1"] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () =>
        observationsPage([
          ...rowsFor("user:abc", ["trace-1", "trace-2"]),
          // A second observation of trace-1: dedupes to one id.
          ...rowsFor("user:abc", ["trace-1"]),
        ]),
    ])

    const result = await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
      langfuse: langfuseSeam(fetchImpl),
    })

    expect(result).toMatchObject({
      langfuse: {
        kind: "counted",
        uniqueTraces: 2,
        listedObservations: 3,
        deleteRequests: 0,
        tracesSubmitted: 0,
      },
    })
    expect(methodsOf(requests)).toEqual(["GET"])
  })

  it("skips-and-counts rows whose userId is another subject's — their ids reach NO delete request (AE6)", async () => {
    // The failure this exists for: a listing that ignores or mangles the
    // userId filter and returns other users' rows. The server-side filter is
    // a promise, not a proof — the per-row re-check is the proof.
    const store = fakeStore({ "user:abc": ["t1"] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () =>
        observationsPage([
          ...rowsFor("user:abc", ["mine-1"]),
          ...rowsFor("user:other", ["foreign-1", "foreign-2"]),
          ...rowsFor("user:abc", ["mine-2"]),
        ]),
      () => deleteAccepted(),
      // Requery after the full submission.
      () => observationsPage([]),
    ])
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
      langfuse: langfuseSeam(fetchImpl),
    })

    expect(result).toMatchObject({
      langfuse: {
        kind: "submitted",
        uniqueTraces: 2,
        mismatchedRowsSkipped: 2,
        tracesSubmitted: 2,
      },
    })
    const deletes = deleteRequestsOf(requests)
    expect(deletes).toHaveLength(1)
    expect(deleteBody(deletes[0]!)).toEqual(["mine-1", "mine-2"])
    for (const request of deletes) {
      expect(deleteBody(request)).not.toContain("foreign-1")
      expect(deleteBody(request)).not.toContain("foreign-2")
    }
    expect(lines.join("\n")).toContain("mismatched_skipped=2")
  })

  it("re-checks with EXACT equality — a prefix-adjacent userId is a mismatch", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abcd", ["neighbour-trace"])),
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: { kind: "no_data", mismatchedRowsSkipped: 1, uniqueTraces: 0 },
    })
    expect(deleteRequestsOf(requests)).toEqual([])
  })

  it("refuses the WHOLE half when any row's userId is unreadable (R7), Postgres unaffected", async () => {
    const store = fakeStore({ "user:abc": ["t1"] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () =>
        observationsPage([
          ...rowsFor("user:abc", ["mine-1"]),
          { traceId: "orphan-1" }, // no userId at all
          { traceId: "orphan-2", userId: "" },
        ]),
    ])

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
      langfuse: langfuseSeam(fetchImpl),
    })

    // Zero deletes — not even for the row that DID prove ownership: a listing
    // that cannot prove per-row ownership cannot be trusted wholesale.
    expect(result).toMatchObject({
      postgres: { kind: "erased", threadsDeleted: 1 },
      langfuse: {
        kind: "refused_unreadable_user_ids",
        missingUserIdRows: 2,
      },
    })
    expect(deleteRequestsOf(requests)).toEqual([])
  })

  it("drains every page via nextCursor BEFORE the first delete (collect-then-delete)", async () => {
    // Deleting mid-listing shifts pages under the cursor and can silently
    // skip traces — a completeness failure with no daily sweep behind it.
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abc", ["p1-trace"]), "cursor-2"),
      (request) => {
        expect(request.url.searchParams.get("cursor")).toBe("cursor-2")
        return observationsPage(rowsFor("user:abc", ["p2-trace"]))
      },
      () => deleteAccepted(),
      () => observationsPage([]), // requery
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: { kind: "submitted", uniqueTraces: 2, tracesSubmitted: 2 },
    })
    // Every listing GET precedes the DELETE; the trailing GET is the requery.
    expect(methodsOf(requests)).toEqual(["GET", "GET", "DELETE", "GET"])
    expect(deleteBody(deleteRequestsOf(requests)[0]!)).toEqual([
      "p1-trace",
      "p2-trace",
    ])
  })

  it("deletes what it collected on a listing page-cap hit, then reports incomplete (exit-2 shape)", async () => {
    // Retention precedent: the upstream is healthy and every collected id is
    // proven, so the collected set is deleted and the incomplete state is
    // reported for an idempotent rerun. No requery — traces knowably remain.
    const store = fakeStore({ "user:abc": [] })
    const responders = Array.from(
      { length: MAX_ERASURE_LIST_PAGES_PER_RUN },
      (_, i) => () =>
        observationsPage(rowsFor("user:abc", [`trace-${i}`]), `cursor-${i}`),
    )
    responders.push(() => deleteAccepted())
    const { fetchImpl, requests } = fakeLangfuseFetch(responders)

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: {
        kind: "cap_exceeded",
        cap: "list_pages",
        uniqueTraces: MAX_ERASURE_LIST_PAGES_PER_RUN,
        tracesSubmitted: MAX_ERASURE_LIST_PAGES_PER_RUN,
        deleteRequests: 1,
      },
    })
    // Exactly the cap's worth of GETs, one DELETE, and NO requery.
    expect(methodsOf(requests)).toEqual([
      ...Array.from({ length: MAX_ERASURE_LIST_PAGES_PER_RUN }, () => "GET"),
      "DELETE",
    ])
  })

  it("reports a list-stage 429 as retry-shortly with the Retry-After seconds — never the daily-quota wording", async () => {
    const store = fakeStore({ "user:abc": ["t1"] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => statusResponse(429, { "retry-after": "30" }),
    ])
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
      langfuse: langfuseSeam(fetchImpl),
    })

    expect(result).toMatchObject({
      langfuse: { kind: "rate_limited", stage: "list", retryAfterSeconds: 30 },
    })
    expect(deleteRequestsOf(requests)).toEqual([])
    const output = lines.join("\n")
    expect(output).toContain("retry_after_s=30")
    expect(output).toContain("guidance=retry_shortly")
    // A list-stage throttle is a READ-bucket event: steering the operator at
    // the daily delete quota would be the wrong root cause.
    expect(output).not.toContain("quota")
    expect(output).not.toContain("tomorrow")
  })

  it("classifies a non-429 list failure with its stage, deleting nothing", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => statusResponse(401),
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: {
        kind: "failed",
        stage: "list",
        reason: "auth_failed",
        status: 401,
      },
    })
    expect(deleteRequestsOf(requests)).toEqual([])
  })

  it("reports no_data only behind a COMPLETE empty listing (AE7 half)", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage([]),
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      postgres: { kind: "no_data" },
      langfuse: { kind: "no_data" },
    })
    expect(deleteRequestsOf(requests)).toEqual([])
  })
})

/** Execute with a Langfuse fake, default store/log — the common call shape. */
function runExecuteWithLangfuse(
  store: FakeStore,
  fetchImpl: typeof fetch,
): ReturnType<typeof executeAiChatErasure> {
  return executeAiChatErasure({
    resourceId: "user:abc",
    acquireMemory: acquiring(store.memory),
    log: recordingLog().log,
    langfuse: langfuseSeam(fetchImpl),
  })
}

describe("ai-chat erasure — unaddressable rows fail closed (refused_unaddressable_rows)", () => {
  // Rows whose userId reads (and matches) but whose traceId does not are the
  // same store-contract anomaly class as unreadable userIds: visible yet
  // undeletable-by-id. Both modes must refuse with ZERO deletes — deleting
  // the addressable subset would blur the completeness claim.

  it("preview refuses when the target's rows carry no readable traceId — never no_data/counted", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () =>
        observationsPage([
          { userId: "user:abc" }, // traceId absent entirely
          { userId: "user:abc", traceId: "" }, // traceId unreadable
        ]),
    ])

    const result = await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
      langfuse: langfuseSeam(fetchImpl),
    })

    expect(result).toMatchObject({
      langfuse: {
        kind: "refused_unaddressable_rows",
        missingTraceIdRows: 2,
        uniqueTraces: 0,
      },
    })
    expect(result).not.toMatchObject({ langfuse: { kind: "no_data" } })
    expect(deleteRequestsOf(requests)).toEqual([])
  })

  it("execute refuses with ZERO delete requests on the wire", async () => {
    const store = fakeStore({ "user:abc": ["t1"] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage([{ userId: "user:abc", traceId: "" }]),
    ])

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
      langfuse: langfuseSeam(fetchImpl),
    })

    // Postgres unaffected; the Langfuse half refuses before its delete loop.
    expect(result).toMatchObject({
      postgres: { kind: "erased", threadsDeleted: 1 },
      langfuse: { kind: "refused_unaddressable_rows", missingTraceIdRows: 1 },
    })
    expect(methodsOf(requests)).toEqual(["GET"])
    expect(deleteRequestsOf(requests)).toEqual([])
  })

  it("still refuses on a MIXED page — the addressable subset is NOT deleted", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () =>
        observationsPage([
          ...rowsFor("user:abc", ["mine-1", "mine-2"]),
          { userId: "user:abc" }, // one unaddressable row poisons the half
        ]),
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: {
        kind: "refused_unaddressable_rows",
        missingTraceIdRows: 1,
        uniqueTraces: 2,
        tracesSubmitted: 0,
        deleteRequests: 0,
      },
    })
    expect(deleteRequestsOf(requests)).toEqual([])
  })

  it("logs the refusal at WARN level, enum/count-only", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl } = fakeLangfuseFetch([
      () => observationsPage([{ userId: "user:abc", traceId: "" }]),
    ])
    const warns: string[] = []
    const infos: string[] = []

    await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: {
        info: (line) => infos.push(line),
        warn: (line) => warns.push(line),
      },
      langfuse: langfuseSeam(fetchImpl),
    })

    // Mirrors refused_unreadable_user_ids' treatment: the completion line is
    // a WARN, and it names the count, never an id.
    expect(warns.join("\n")).toContain(
      "langfuse=refused_unaddressable_rows missing_trace_id_rows=1",
    )
    expect(infos.join("\n")).not.toContain("refused_unaddressable_rows")
  })
})

describe("ai-chat erasure — pagination-drift guard (Hardening B)", () => {
  it("treats a FULL page with no cursor as truncation — preview reports cap_exceeded, never counted/no_data", async () => {
    // A drifted cursor field would silently cap every listing at page one; in
    // the module whose output licenses a completion claim, that partial
    // listing must degrade to the loud incomplete outcome.
    const fullPage = Array.from(
      { length: LANGFUSE_ERASURE_LIST_PAGE_SIZE },
      (_, i) => `trace-${i}`,
    )
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abc", fullPage)),
    ])

    const result = await previewAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log: recordingLog().log,
      langfuse: langfuseSeam(fetchImpl),
    })

    expect(result).toMatchObject({
      langfuse: {
        kind: "cap_exceeded",
        cap: "list_pages",
        uniqueTraces: LANGFUSE_ERASURE_LIST_PAGE_SIZE,
      },
    })
    expect(result).not.toMatchObject({ langfuse: { kind: "counted" } })
    expect(deleteRequestsOf(requests)).toEqual([])
  })

  it("keeps the requery path's existing handling when the requery page is full and cursorless", async () => {
    // The requery is a read-only honesty count over what is STILL visible;
    // a suspect requery listing stays inside the submitted outcome exactly
    // like any other requery result — it never fails the run or re-deletes.
    const fullPage = Array.from(
      { length: LANGFUSE_ERASURE_LIST_PAGE_SIZE },
      (_, i) => `trace-${i}`,
    )
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abc", ["trace-0"])),
      () => deleteAccepted(),
      () => observationsPage(rowsFor("user:abc", fullPage)), // requery
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: {
        kind: "submitted",
        tracesSubmitted: 1,
        requery: {
          ok: true,
          stillVisibleTraces: LANGFUSE_ERASURE_LIST_PAGE_SIZE,
        },
      },
    })
    expect(deleteRequestsOf(requests)).toHaveLength(1)
  })
})

describe("ai-chat erasure — Langfuse deletes, budget and 429s (KTD5/AE3/AE4)", () => {
  it("chunks deletes at 50 ids with each traceId exactly once across all batches", async () => {
    const traceIds = Array.from({ length: 60 }, (_, i) => `trace-${i}`)
    // Three observations per trace across two pages: dedupe must collapse
    // them to 60 unique ids before chunking.
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () =>
        observationsPage(
          [...rowsFor("user:abc", traceIds), ...rowsFor("user:abc", traceIds)],
          "cursor-2",
        ),
      () => observationsPage(rowsFor("user:abc", traceIds)),
      () => deleteAccepted(),
      () => deleteAccepted(),
      () => observationsPage([]), // requery
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: {
        kind: "submitted",
        uniqueTraces: 60,
        tracesSubmitted: 60,
        deleteRequests: 2,
      },
    })
    const deletes = deleteRequestsOf(requests)
    expect(deletes).toHaveLength(2)
    const bodies = deletes.map(deleteBody)
    expect(bodies[0]).toHaveLength(MAX_TRACE_IDS_PER_DELETE_REQUEST)
    expect(bodies[1]).toHaveLength(10)
    const all = bodies.flat()
    expect(all).toHaveLength(60)
    expect(new Set(all).size).toBe(60)
  })

  it("stops at the 10-request cap with traces remaining — no request beyond it", async () => {
    // 520 unique traces = 11 chunks; the cap allows 10 requests (500 ids).
    const traceIds = Array.from({ length: 520 }, (_, i) => `trace-${i}`)
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abc", traceIds)),
      ...Array.from(
        { length: MAX_ERASURE_DELETE_REQUESTS_PER_RUN },
        () => () => deleteAccepted(),
      ),
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: {
        kind: "cap_exceeded",
        cap: "delete_requests",
        remainingTraces: 20,
        deleteRequests: MAX_ERASURE_DELETE_REQUESTS_PER_RUN,
        tracesSubmitted: 500,
      },
    })
    expect(deleteRequestsOf(requests)).toHaveLength(
      MAX_ERASURE_DELETE_REQUESTS_PER_RUN,
    )
  })

  it("maps a delete-stage 429 with NO Retry-After to the quota outcome with remaining count and implied days (AE3)", async () => {
    // 600 unique traces; the FIRST delete 429s → 600 remain, and at the
    // headroom rate (500/day) the horizon is 2 days.
    const traceIds = Array.from({ length: 600 }, (_, i) => `trace-${i}`)
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abc", traceIds.slice(0, 300)), "c2"),
      () => observationsPage(rowsFor("user:abc", traceIds.slice(300))),
      () => statusResponse(429),
    ])
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
      langfuse: langfuseSeam(fetchImpl),
    })

    expect(result).toMatchObject({
      langfuse: {
        kind: "quota_exhausted",
        remainingTraces: 600,
        impliedDaysToComplete: 2,
        deleteRequests: 1,
        tracesSubmitted: 0,
      },
    })
    // No further delete request after the quota hit.
    expect(deleteRequestsOf(requests)).toHaveLength(1)
    const output = lines.join("\n")
    expect(output).toContain("remaining_traces=600")
    expect(output).toContain("implied_days_to_complete=2")
    expect(output).toContain("guidance=daily_delete_quota_rerun_tomorrow")
  })

  it("treats a DAY-SCALE delete-stage Retry-After as the quota outcome too", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abc", ["trace-1"])),
      () =>
        statusResponse(429, {
          "retry-after": String(ERASURE_QUOTA_RETRY_AFTER_THRESHOLD_SECONDS),
        }),
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: { kind: "quota_exhausted", remainingTraces: 1 },
    })
  })

  it("treats a SHORT delete-stage Retry-After as retry-shortly, not quota", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abc", ["trace-1", "trace-2"])),
      () => statusResponse(429, { "retry-after": "120" }),
    ])
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
      langfuse: langfuseSeam(fetchImpl),
    })

    expect(result).toMatchObject({
      langfuse: {
        kind: "rate_limited",
        stage: "delete",
        retryAfterSeconds: 120,
        remainingTraces: 2,
      },
    })
    expect(deleteRequestsOf(requests)).toHaveLength(1)
    expect(lines.join("\n")).toContain("guidance=retry_shortly")
    expect(lines.join("\n")).not.toContain("quota")
  })

  it("classifies a non-429 delete failure with the submitted-so-far counts", async () => {
    const traceIds = Array.from({ length: 60 }, (_, i) => `trace-${i}`)
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abc", traceIds)),
      () => deleteAccepted(),
      () => statusResponse(500),
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: {
        kind: "failed",
        stage: "delete",
        reason: "network_error",
        status: 500,
        deleteRequests: 2,
        tracesSubmitted: 50,
      },
    })
    expect(deleteRequestsOf(requests)).toHaveLength(2)
  })

  it("runs ONE read-only requery after a full submission — still-visible is a non-failure and issues no delete (AE4/KTD6)", async () => {
    const store = fakeStore({ "user:abc": ["t1"] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abc", ["trace-1", "trace-2"])),
      () => deleteAccepted(),
      // Requery: deletion is async — both traces are still visible.
      () => observationsPage(rowsFor("user:abc", ["trace-1", "trace-2"])),
    ])
    const { log, lines } = recordingLog()

    const result = await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
      langfuse: langfuseSeam(fetchImpl),
    })

    expect(result).toMatchObject({
      langfuse: {
        kind: "submitted",
        tracesSubmitted: 2,
        requery: { ok: true, stillVisibleTraces: 2 },
      },
    })
    // KTD6's load-bearing half: the requery re-submits NOTHING — exactly one
    // DELETE ever reaches the wire, and the last request is a GET.
    expect(deleteRequestsOf(requests)).toHaveLength(1)
    expect(methodsOf(requests)).toEqual(["GET", "DELETE", "GET"])
    expect(lines.join("\n")).toContain("still_visible=2")
  })

  it("reports zero still-visible when the requery already sees nothing", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abc", ["trace-1"])),
      () => deleteAccepted(),
      () => observationsPage([]),
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: {
        kind: "submitted",
        requery: { ok: true, stillVisibleTraces: 0 },
      },
    })
  })

  it("keeps a failed requery inside the submitted outcome — deletes were already accepted", async () => {
    const store = fakeStore({ "user:abc": [] })
    const { fetchImpl, requests } = fakeLangfuseFetch([
      () => observationsPage(rowsFor("user:abc", ["trace-1"])),
      () => deleteAccepted(),
      () => statusResponse(503),
    ])

    const result = await runExecuteWithLangfuse(store, fetchImpl)

    expect(result).toMatchObject({
      langfuse: {
        kind: "submitted",
        tracesSubmitted: 1,
        requery: { ok: false, reason: "network_error" },
      },
    })
    expect(deleteRequestsOf(requests)).toHaveLength(1)
  })

  it("never lets a trace id, user id, or upstream text reach a log line (R4)", async () => {
    const store = fakeStore({ "user:abc": ["t1"] })
    const { fetchImpl } = fakeLangfuseFetch([
      () =>
        observationsPage([
          ...rowsFor("user:abc", ["trace-secret-1"]),
          ...rowsFor("user:other-secret", ["foreign-secret"]),
        ]),
      () => deleteAccepted(),
      () => observationsPage([]),
    ])
    const { log, lines } = recordingLog()

    await executeAiChatErasure({
      resourceId: "user:abc",
      acquireMemory: acquiring(store.memory),
      log,
      langfuse: langfuseSeam(fetchImpl),
    })

    const output = lines.join("\n")
    expect(output).not.toContain("trace-secret-1")
    expect(output).not.toContain("foreign-secret")
    expect(output).not.toContain("user:abc")
    expect(output).not.toContain("user:other-secret")
  })
})

describe("formatLangfuseOutcome", () => {
  // EVERY union kind renders here — the "one place the union becomes text"
  // claim is only checkable if no kind is missing from this block, so a
  // widened union should force an addition here too.
  const counts = {
    listedObservations: 3,
    uniqueTraces: 2,
    mismatchedRowsSkipped: 1,
    missingTraceIdRows: 0,
    deleteRequests: 1,
    tracesSubmitted: 2,
  }

  it("renders the request-free kinds exactly", () => {
    expect(formatLangfuseOutcome({ kind: "skipped_unconfigured" })).toBe(
      "langfuse=skipped_unconfigured",
    )
    expect(formatLangfuseOutcome({ kind: "egress_refused" })).toBe(
      "langfuse=egress_refused",
    )
  })

  it("renders counted and no_data with the shared counts", () => {
    const counted = formatLangfuseOutcome({ kind: "counted", ...counts })
    expect(counted).toContain("langfuse=counted")
    expect(counted).toContain("listed=3 traces=2 mismatched_skipped=1")
    expect(formatLangfuseOutcome({ kind: "no_data", ...counts })).toContain(
      "langfuse=no_data",
    )
  })

  it("renders both requery shapes of submitted", () => {
    const converged = formatLangfuseOutcome({
      kind: "submitted",
      requery: { ok: true, stillVisibleTraces: 2 },
      ...counts,
    })
    expect(converged).toContain("still_visible=2")
    expect(converged).toContain(
      "note=async_deletion_pending_verify_via_later_preview",
    )
    const requeryFailed = formatLangfuseOutcome({
      kind: "submitted",
      requery: { ok: false, reason: "network_error" },
      ...counts,
    })
    expect(requeryFailed).toContain(
      "requery=failed requery_reason=network_error",
    )
    expect(requeryFailed).toContain("verify_via_later_preview")
  })

  it("renders rate_limited for BOTH stages with retry-shortly guidance, never quota wording", () => {
    const list = formatLangfuseOutcome({
      kind: "rate_limited",
      stage: "list",
      retryAfterSeconds: 30,
      ...counts,
    })
    expect(list).toContain("langfuse=rate_limited stage=list")
    expect(list).toContain("retry_after_s=30")
    expect(list).toContain("guidance=retry_shortly")
    expect(list).not.toContain("quota")
    const del = formatLangfuseOutcome({
      kind: "rate_limited",
      stage: "delete",
      retryAfterSeconds: 120,
      remainingTraces: 4,
      ...counts,
    })
    expect(del).toContain("stage=delete")
    expect(del).toContain("remaining_traces=4")
    expect(del).toContain("guidance=retry_shortly")
  })

  it("renders quota_exhausted with the horizon and daily-quota guidance", () => {
    const line = formatLangfuseOutcome({
      kind: "quota_exhausted",
      remainingTraces: 600,
      impliedDaysToComplete: 2,
      ...counts,
    })
    expect(line).toContain("langfuse=quota_exhausted")
    expect(line).toContain("remaining_traces=600")
    expect(line).toContain("implied_days_to_complete=2")
    expect(line).toContain("guidance=daily_delete_quota_rerun_tomorrow")
  })

  it("splits cap_exceeded guidance by cap: settle-first past the delete cap, rerun past the page cap", () => {
    // Deletion is ~15 min async: past the delete-request cap every collected
    // id was SUBMITTED, so an immediate rerun re-lists the same still-visible
    // traces and burns another 10 org-quota requests for no progress.
    const deleteCap = formatLangfuseOutcome({
      kind: "cap_exceeded",
      cap: "delete_requests",
      remainingTraces: 20,
      ...counts,
    })
    expect(deleteCap).toContain("remaining_traces=20")
    expect(deleteCap).toContain(
      "guidance=rerun_after_async_deletion_settles wait_minutes=15",
    )
    expect(deleteCap).not.toContain("rerun_to_continue")
    // The page cap leaves genuinely un-submitted work: rerun continues it.
    const pageCap = formatLangfuseOutcome({
      kind: "cap_exceeded",
      cap: "list_pages",
      ...counts,
    })
    expect(pageCap).toContain("guidance=rerun_to_continue")
    expect(pageCap).not.toContain("wait_minutes")
  })

  it("renders both refusal kinds with their counts", () => {
    const unreadable = formatLangfuseOutcome({
      kind: "refused_unreadable_user_ids",
      missingUserIdRows: 5,
      ...counts,
      missingTraceIdRows: 2,
    })
    expect(unreadable).toContain("langfuse=refused_unreadable_user_ids")
    expect(unreadable).toContain("missing_user_id_rows=5")
    // A visible-but-unaddressable row count surfaces when non-zero.
    expect(unreadable).toContain("missing_trace_id_rows=2")
    const unaddressable = formatLangfuseOutcome({
      kind: "refused_unaddressable_rows",
      ...counts,
      missingTraceIdRows: 3,
    })
    expect(unaddressable).toContain("langfuse=refused_unaddressable_rows")
    expect(unaddressable).toContain("missing_trace_id_rows=3")
    // The leading field replaces shared's conditional suffix — never twice.
    expect(unaddressable.match(/missing_trace_id_rows=/g)).toHaveLength(1)
  })

  it("renders failed with stage, reason, and status", () => {
    const line = formatLangfuseOutcome({
      kind: "failed",
      stage: "delete",
      reason: "auth_failed",
      status: 401,
      ...counts,
    })
    expect(line).toContain("langfuse=failed stage=delete reason=auth_failed")
    expect(line).toContain("status=401")
  })
})

describe("ai-chat erasure — langfuse seam default wiring (feat-283-style pins)", () => {
  it("reaches the real env gate when the seam is OMITTED — trio-less env yields skipped_unconfigured", async () => {
    // The default-source pin (a): with no `langfuse` key, runLangfuseHalf's
    // default arms must reach the REAL `getLangfuseTraceRetentionConfig()`
    // gate without faulting. `env` is frozen at import of ../config/env, so
    // the trio is cleared via vi.stubEnv BEFORE a fresh module import —
    // deterministic regardless of what LANGFUSE_* the ambient shell exports.
    // (b) The anti-vacuous companion — an INJECTED configured seam getting
    // past this same gate — is the existing "accepts a host the
    // LANGFUSE_ALLOWED_HOSTS CSV allows" test above; not duplicated here.
    vi.resetModules()
    vi.stubEnv("LANGFUSE_BASE_URL", "")
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "")
    vi.stubEnv("LANGFUSE_SECRET_KEY", "")
    try {
      const module = await import("./ai-chat-erasure")
      const store = fakeStore({ "user:abc": ["t1"] })

      const result = await module.previewAiChatErasure({
        resourceId: "user:abc",
        acquireMemory: acquiring(store.memory),
        log: recordingLog().log,
        // Deliberately NO `langfuse` seam.
      })

      expect(result).toMatchObject({
        kind: "completed",
        postgres: { kind: "counted", threadCount: 1 },
        langfuse: { kind: "skipped_unconfigured" },
      })
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it("pins the one-line-revert surface: the default arms name the real env sources", () => {
    // The whole-source seam-token backstop (c): a one-line revert that
    // hardcodes a config or drops the env-CSV allowlist source at either
    // default arm compiles and leaves every behavioral test green — this pin
    // is what goes red (see the repo CLAUDE.md feat-283/feat-304 entries).
    const source = readFileSync(
      fileURLToPath(new URL("./ai-chat-erasure.ts", import.meta.url)),
      "utf8",
    )
    const start = source.indexOf("async function runLangfuseHalf")
    const end = source.indexOf("export function formatPostgresOutcome")
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const half = source.slice(start, end)
    expect(half).toContain("getLangfuseTraceRetentionConfig)()")
    expect(half).toContain("env.LANGFUSE_ALLOWED_HOSTS")
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
