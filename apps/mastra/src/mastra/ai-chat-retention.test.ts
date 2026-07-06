import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AI_CHAT_ANON_RETENTION_DAYS,
  AI_CHAT_USER_RETENTION_DAYS,
  retentionWindowMsFor,
  runAiChatRetentionPurge,
  startAiChatRetentionPurge,
  type AiChatRetentionMemory,
} from "./ai-chat-retention"

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 6, 5)

type FakeThread = {
  id: string
  resourceId?: string | null
  updatedAt?: Date | string | null
}

function toMs(value: Date | string | null | undefined): number {
  return value == null ? Number.NaN : new Date(value).getTime()
}

/**
 * Store fake mirroring the production contract the purge relies on:
 * updatedAt-ASC ordering with NULLs last (PG ASC default), pagination over
 * the live (non-deleted) set, and per-id lookup that reflects deletions.
 */
function fakeMemory(initial: FakeThread[]): {
  memory: AiChatRetentionMemory
  deleted: string[]
  orderByCalls: unknown[]
} {
  const deleted: string[] = []
  const gone = new Set<string>()
  const byId = new Map(initial.map((t) => [t.id, t]))
  const orderByCalls: unknown[] = []
  const memory: AiChatRetentionMemory = {
    listThreads: async ({ page = 0, perPage = 100, orderBy }) => {
      orderByCalls.push(orderBy)
      const live = initial.filter((t) => !gone.has(t.id))
      const sorted = [...live].sort((a, b) => {
        const ta = toMs(a.updatedAt)
        const tb = toMs(b.updatedAt)
        if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
        if (Number.isNaN(ta)) return 1
        if (Number.isNaN(tb)) return -1
        return ta - tb
      })
      const start = page * perPage
      return {
        threads: sorted.slice(start, start + perPage),
        hasMore: start + perPage < sorted.length,
      }
    },
    getThreadById: async ({ threadId }) => {
      if (gone.has(threadId)) return null
      const thread = byId.get(threadId)
      return thread
        ? { resourceId: thread.resourceId, updatedAt: thread.updatedAt }
        : null
    },
    deleteThread: async (threadId) => {
      gone.add(threadId)
      deleted.push(threadId)
    },
  }
  return { memory, deleted, orderByCalls }
}

function daysAgo(days: number): Date {
  return new Date(NOW - days * DAY_MS)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("retentionWindowMsFor", () => {
  it("gives user:* resources the long window and everything else the short one", () => {
    expect(retentionWindowMsFor("user:abc")).toBe(
      AI_CHAT_USER_RETENTION_DAYS * DAY_MS,
    )
    for (const resource of [
      "anon:0f6d3f1e-0000-4000-8000-000000000000",
      "seeker-dogfood",
      undefined,
      null,
      // Prefix-check only — a sub CONTAINING "user:" mid-string is not a user
      // resource. Never split on ":".
      "anon:user:trick",
    ]) {
      expect(retentionWindowMsFor(resource)).toBe(
        AI_CHAT_ANON_RETENTION_DAYS * DAY_MS,
      )
    }
  })
})

describe("runAiChatRetentionPurge", () => {
  it("deletes threads past their window and keeps the rest (boundary-exact)", async () => {
    const { memory, deleted } = fakeMemory([
      // Anonymous: 30d window.
      { id: "anon-old", resourceId: "anon:a", updatedAt: daysAgo(31) },
      { id: "anon-live", resourceId: "anon:a", updatedAt: daysAgo(29) },
      // Exactly AT the boundary is NOT past it (strict >).
      { id: "anon-edge", resourceId: "anon:a", updatedAt: daysAgo(30) },
      // Signed-in: 180d window.
      { id: "user-old", resourceId: "user:u1", updatedAt: daysAgo(181) },
      { id: "user-live", resourceId: "user:u1", updatedAt: daysAgo(179) },
      // The dogfood fallback resource gets the anonymous window.
      {
        id: "dogfood-old",
        resourceId: "seeker-dogfood",
        updatedAt: daysAgo(31),
      },
    ])
    const result = await runAiChatRetentionPurge({ memory, now: () => NOW })
    expect(deleted.sort()).toEqual(["anon-old", "dogfood-old", "user-old"])
    // ASC scan early-stops at anon-edge (exactly 30d — inside the shortest
    // window), so anon-live is never even scanned.
    expect(result).toEqual({ scanned: 5, deleted: 3, sweeps: 1 })
  })

  it("scans oldest-first and stops early at the shortest window", async () => {
    const threads: FakeThread[] = [
      { id: "old-1", resourceId: "anon:a", updatedAt: daysAgo(40) },
      { id: "old-2", resourceId: "anon:a", updatedAt: daysAgo(35) },
      { id: "old-3", resourceId: "anon:a", updatedAt: daysAgo(31) },
      // 300 live threads that an unordered full-table scan would walk.
      ...Array.from({ length: 300 }, (_, i) => ({
        id: `live-${i}`,
        resourceId: "anon:a",
        updatedAt: daysAgo(5),
      })),
    ]
    const { memory, deleted, orderByCalls } = fakeMemory(threads)
    const result = await runAiChatRetentionPurge({ memory, now: () => NOW })
    expect(deleted.sort()).toEqual(["old-1", "old-2", "old-3"])
    // 3 expired + the first in-window row = 4 scanned, not 303.
    expect(result.scanned).toBe(4)
    expect(orderByCalls[0]).toEqual({ field: "updatedAt", direction: "ASC" })
  })

  it("skips threads with missing or unparseable updatedAt rather than deleting them", async () => {
    const { memory, deleted } = fakeMemory([
      { id: "no-date", resourceId: "anon:a", updatedAt: null },
      { id: "bad-date", resourceId: "anon:a", updatedAt: "not-a-date" },
    ])
    const result = await runAiChatRetentionPurge({ memory, now: () => NOW })
    expect(deleted).toEqual([])
    expect(result.deleted).toBe(0)
  })

  it("pages through the expired backlog and parses string dates", async () => {
    // 150 threads (2 pages at perPage=100), all expired, ISO-string dates —
    // the wire shape a JSON-hydrated store returns.
    const threads: FakeThread[] = Array.from({ length: 150 }, (_, i) => ({
      id: `t${i}`,
      resourceId: "anon:bulk",
      updatedAt: daysAgo(40).toISOString(),
    }))
    const { memory, deleted } = fakeMemory(threads)
    const result = await runAiChatRetentionPurge({ memory, now: () => NOW })
    expect(deleted).toHaveLength(150)
    expect(result.scanned).toBe(150)
    expect(result.sweeps).toBe(1)
  })

  it("drains a backlog larger than one sweep in bounded sweeps", async () => {
    // 600 expired: sweep 1 deletes the 500-per-sweep bound, sweep 2 drains
    // the remaining 100 — the daily cap no longer strands the backlog.
    const threads: FakeThread[] = Array.from({ length: 600 }, (_, i) => ({
      id: `t${i}`,
      resourceId: "anon:bulk",
      updatedAt: daysAgo(40),
    }))
    const { memory, deleted } = fakeMemory(threads)
    const result = await runAiChatRetentionPurge({ memory, now: () => NOW })
    expect(deleted).toHaveLength(600)
    expect(result.deleted).toBe(600)
    expect(result.sweeps).toBe(2)
  })

  it("caps a pathological backlog at the per-run sweep valve and carries over", async () => {
    // 10,500 expired > the 20-sweep × 500 valve: the run stops at 10,000 so
    // it cannot monopolize the pool; the remainder waits for the next tick.
    const threads: FakeThread[] = Array.from({ length: 10_500 }, (_, i) => ({
      id: `t${i}`,
      resourceId: "anon:bulk",
      updatedAt: daysAgo(40),
    }))
    const { memory, deleted } = fakeMemory(threads)
    const result = await runAiChatRetentionPurge({ memory, now: () => NOW })
    expect(deleted).toHaveLength(10_000)
    expect(result.sweeps).toBe(20)
  })

  it("re-checks recency before each delete so a resumed thread survives the sweep", async () => {
    const { memory, deleted } = fakeMemory([
      { id: "stale", resourceId: "anon:a", updatedAt: daysAgo(40) },
      { id: "resumed", resourceId: "anon:a", updatedAt: daysAgo(40) },
      { id: "vanished", resourceId: "anon:a", updatedAt: daysAgo(40) },
    ])
    const baseGetThreadById = memory.getThreadById
    memory.getThreadById = async ({ threadId }) => {
      // "resumed" got a message between the scan and its delete; "vanished"
      // was deleted concurrently (e.g. a second instance's sweep).
      if (threadId === "resumed") {
        return { resourceId: "anon:a", updatedAt: daysAgo(1) }
      }
      if (threadId === "vanished") return null
      return baseGetThreadById({ threadId })
    }
    const result = await runAiChatRetentionPurge({ memory, now: () => NOW })
    expect(deleted).toEqual(["stale"])
    expect(result.deleted).toBe(1)
  })

  it("keeps draining when a full batch is only partly deleted (recency spared some)", async () => {
    // 501 expired: sweep 1 collects the full 500-per-sweep batch but the
    // recency re-check spares t0 (resumed), so it deletes 499. The drain must
    // still run a 2nd sweep to reach t500 — keying the drain on the DELETED
    // count instead of the COLLECTED count would strand it here.
    const threads: FakeThread[] = Array.from({ length: 501 }, (_, i) => ({
      id: `t${i}`,
      resourceId: "anon:bulk",
      updatedAt: daysAgo(40),
    }))
    const { memory, deleted } = fakeMemory(threads)
    const baseGetThreadById = memory.getThreadById
    memory.getThreadById = async ({ threadId }) =>
      threadId === "t0"
        ? { resourceId: "anon:bulk", updatedAt: daysAgo(1) } // resumed mid-sweep
        : baseGetThreadById({ threadId })
    const result = await runAiChatRetentionPurge({ memory, now: () => NOW })
    expect(deleted).toContain("t500")
    expect(deleted).not.toContain("t0")
    expect(deleted).toHaveLength(500)
    expect(result.sweeps).toBe(2)
  })

  it("surfaces a store outage as a failure, not a false purge_complete", async () => {
    // Mirrors the real @mastra/pg contract: listThreads SWALLOWS store errors
    // (returns empty), getThreadById THROWS. Without the connectivity probe an
    // outage would drain to `purge_complete scanned=0` (false success); the
    // probe makes the run reject so the caller logs purge_failed instead.
    const memory: AiChatRetentionMemory = {
      listThreads: async () => ({ threads: [], hasMore: false }),
      getThreadById: async () => {
        throw new Error("db down")
      },
      deleteThread: async () => {},
    }
    await expect(
      runAiChatRetentionPurge({ memory, now: () => NOW }),
    ).rejects.toThrow()
  })
})

describe("startAiChatRetentionPurge", () => {
  it("no-ops (and never touches memory) when no postgres backend is configured", () => {
    const getMemory = vi.fn()
    const handle = startAiChatRetentionPurge({
      isEnabled: () => false,
      getMemory,
    })
    expect(handle).toBeNull()
    expect(getMemory).not.toHaveBeenCalled()
  })

  it("runs a boot sweep and schedules the daily timer when enabled", async () => {
    vi.useFakeTimers()
    try {
      // Non-mutating fake: the same expired thread is visible to every run,
      // so each timer tick records another delete.
      const deleted: string[] = []
      const old = { id: "old", resourceId: "anon:a", updatedAt: daysAgo(31) }
      const memory: AiChatRetentionMemory = {
        listThreads: async () => ({ threads: [old], hasMore: false }),
        getThreadById: async () => ({
          resourceId: old.resourceId,
          updatedAt: old.updatedAt,
        }),
        deleteThread: async (threadId) => {
          deleted.push(threadId)
        },
      }
      const handle = startAiChatRetentionPurge({
        isEnabled: () => true,
        getMemory: () => memory,
        intervalMs: 1000,
      })
      expect(handle).not.toBeNull()
      // Boot sweep is fire-and-forget — flush its microtasks.
      await vi.advanceTimersByTimeAsync(0)
      expect(deleted).toEqual(["old"])
      // The interval re-runs the purge.
      await vi.advanceTimersByTimeAsync(1000)
      expect(deleted).toEqual(["old", "old"])
      handle?.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("logs and survives a failing run (never throws out of the timer)", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const memory: AiChatRetentionMemory = {
        listThreads: async () => {
          throw new Error("db down")
        },
        getThreadById: async () => null,
        deleteThread: async () => {},
      }
      const handle = startAiChatRetentionPurge({
        isEnabled: () => true,
        getMemory: () => memory,
        intervalMs: 1000,
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(warn).toHaveBeenCalledWith(
        "[ai-chat-retention] event=purge_failed reason=sweep_error",
      )
      handle?.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
