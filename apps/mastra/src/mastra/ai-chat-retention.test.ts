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

function fakeMemory(threads: FakeThread[]): {
  memory: AiChatRetentionMemory
  deleted: string[]
} {
  const deleted: string[] = []
  const memory: AiChatRetentionMemory = {
    listThreads: async ({ page = 0, perPage = 100 }) => {
      const start = page * perPage
      const slice = threads.slice(start, start + perPage)
      return { threads: slice, hasMore: start + perPage < threads.length }
    },
    deleteThread: async (threadId) => {
      deleted.push(threadId)
    },
  }
  return { memory, deleted }
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
    expect(result).toEqual({ scanned: 6, deleted: 3 })
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

  it("pages through the full thread list and parses string dates", async () => {
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
  })

  it("bounds deletes per run", async () => {
    const threads: FakeThread[] = Array.from({ length: 600 }, (_, i) => ({
      id: `t${i}`,
      resourceId: "anon:bulk",
      updatedAt: daysAgo(40),
    }))
    const { memory, deleted } = fakeMemory(threads)
    const result = await runAiChatRetentionPurge({ memory, now: () => NOW })
    expect(deleted).toHaveLength(500)
    expect(result.deleted).toBe(500)
  })
})

describe("startAiChatRetentionPurge", () => {
  it("no-ops (and never touches memory) unless the resolved backend is postgres", () => {
    const getMemory = vi.fn()
    const handle = startAiChatRetentionPurge({
      getBackend: () => "memory",
      getMemory,
    })
    expect(handle).toBeNull()
    expect(getMemory).not.toHaveBeenCalled()
  })

  it("runs a boot sweep and schedules the daily timer under postgres", async () => {
    vi.useFakeTimers()
    try {
      const { memory, deleted } = fakeMemory([
        { id: "old", resourceId: "anon:a", updatedAt: daysAgo(31) },
      ])
      const handle = startAiChatRetentionPurge({
        getBackend: () => "postgres",
        getMemory: () => memory,
        intervalMs: 1000,
      })
      expect(handle).not.toBeNull()
      // Boot sweep is fire-and-forget — flush its microtasks.
      await vi.advanceTimersByTimeAsync(0)
      expect(deleted).toEqual(["old"])
      // The interval re-runs the sweep.
      await vi.advanceTimersByTimeAsync(1000)
      expect(deleted).toEqual(["old", "old"])
      handle?.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("logs and survives a failing sweep (never throws out of the timer)", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const memory: AiChatRetentionMemory = {
        listThreads: async () => {
          throw new Error("db down")
        },
        deleteThread: async () => {},
      }
      const handle = startAiChatRetentionPurge({
        getBackend: () => "postgres",
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
