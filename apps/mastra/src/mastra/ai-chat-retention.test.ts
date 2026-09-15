import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Pool, type QueryResult } from "pg"
import { getAiChatGuardReadiness } from "./ai-chat-guard-readiness"
import { expireAiChatConversation } from "./ai-chat-conversation-lifecycle"
import { isAiChatDeletionStorageCovered } from "./ai-chat-memory"
import { env } from "../config/env"
import {
  AI_CHAT_RETENTION_DAYS,
  retentionWindowMsFor,
  runAiChatRetentionPurge,
  startAiChatRetentionPurge,
} from "./ai-chat-retention"

vi.mock("./ai-chat-guard-readiness", () => ({
  getAiChatGuardReadiness: vi.fn(),
}))
vi.mock("./ai-chat-conversation-lifecycle", () => ({
  expireAiChatConversation: vi.fn(),
}))
vi.mock("./ai-chat-memory", () => ({ isAiChatDeletionStorageCovered: vi.fn() }))
vi.mock("../config/env", () => ({
  env: { AI_CHAT_MAINTENANCE_PAUSED: undefined },
  canAiChatDataPersist: () => true,
}))
beforeEach(() => {
  vi.mocked(getAiChatGuardReadiness).mockReset().mockResolvedValue("ready")
  vi.mocked(isAiChatDeletionStorageCovered).mockReset().mockReturnValue(true)
  vi.mocked(expireAiChatConversation)
    .mockReset()
    .mockResolvedValue({ threadsDeleted: 1, recordsDeleted: 1 })
  env.AI_CHAT_MAINTENANCE_PAUSED = undefined
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe("retention scheduler", () => {
  it("keeps the shared flat 25-day policy for every resource", () => {
    expect(AI_CHAT_RETENTION_DAYS).toBe(25)
    for (const owner of [
      "user:a",
      "anon:a",
      "seeker-dogfood",
      "",
      " ",
      "other:resource",
      undefined,
      null,
    ])
      expect(retentionWindowMsFor(owner)).toBe(25 * 86400000)
  })
  it("opens no storage when persistence is disabled", () => {
    const run = vi.fn()
    expect(
      startAiChatRetentionPurge({ isEnabled: () => false, run }),
    ).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })
  it("rechecks after deferred activation, logs no false completion, and stops", async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, "info").mockImplementation(() => {})
    const run = vi
      .fn()
      .mockResolvedValueOnce({ kind: "not_ready", reason: "not_applied" })
      .mockResolvedValue({
        kind: "complete",
        scanned: 1,
        deleted: 1,
        recordsDeleted: 1,
        sweeps: 1,
      })
    const timer = startAiChatRetentionPurge({
      isEnabled: () => true,
      run,
      intervalMs: 100,
    })!
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toHaveBeenCalledWith(
      "[ai-chat-retention] event=purge_deferred reason=not_applied",
    )
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(2)
    timer.stop()
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(2)
  })
  it("does not overlap runs and classifies failed runs without exception content", async () => {
    vi.useFakeTimers()
    let reject!: (reason: Error) => void
    const run = vi.fn(
      () =>
        new Promise<never>((_, fail) => {
          reject = fail
        }),
    )
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const timer = startAiChatRetentionPurge({
      isEnabled: () => true,
      run,
      intervalMs: 100,
    })!
    await vi.advanceTimersByTimeAsync(300)
    expect(run).toHaveBeenCalledTimes(1)
    reject(new Error("synthetic private text"))
    await vi.advanceTimersByTimeAsync(0)
    expect(warn).toHaveBeenCalledWith(
      "[ai-chat-retention] event=purge_failed reason=sweep_error",
    )
    timer.stop()
  })
  it.each(["incompatible", "readiness_error", "uncovered_storage"] as const)(
    "logs %s as failure, not normal pre-migration deferral",
    async (reason) => {
      vi.useFakeTimers()
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const info = vi.spyOn(console, "info").mockImplementation(() => {})
      const timer = startAiChatRetentionPurge({
        isEnabled: () => true,
        run: async () => ({ kind: "failed", reason }),
      })!
      await vi.advanceTimersByTimeAsync(0)
      expect(warn).toHaveBeenCalledWith(
        `[ai-chat-retention] event=purge_failed reason=${reason}`,
      )
      expect(info).not.toHaveBeenCalled()
      timer.stop()
    },
  )
})

describe("bounded retention draining", () => {
  function mockPool() {
    const pool = new Pool({ host: "127.0.0.1", port: 1 })
    const query =
      vi.fn<(sql: string, values?: unknown[]) => Promise<QueryResult>>()
    // This consumer uses only pg's promise overload, never its callback overload.
    vi.spyOn(pool, "query").mockImplementation((...args: unknown[]) =>
      Reflect.apply(query, pool, args),
    )
    return { pool, query }
  }
  function result(rows: Array<{ id: string }>) {
    return {
      rows,
      rowCount: rows.length,
      command: "SELECT",
      oid: 0,
      fields: [],
    }
  }
  it("keeps pause and uncovered storage distinct and never queries candidates", async () => {
    const { pool, query } = mockPool()
    env.AI_CHAT_MAINTENANCE_PAUSED = "true"
    expect(await runAiChatRetentionPurge({ pool })).toEqual({
      kind: "not_ready",
      reason: "paused",
    })
    env.AI_CHAT_MAINTENANCE_PAUSED = undefined
    vi.mocked(isAiChatDeletionStorageCovered).mockReturnValue(false)
    expect(await runAiChatRetentionPurge({ pool })).toEqual({
      kind: "failed",
      reason: "uncovered_storage",
    })
    expect(query).not.toHaveBeenCalled()
    expect(getAiChatGuardReadiness).not.toHaveBeenCalled()
  })
  it.each([
    ["not_applied", { kind: "not_ready", reason: "not_applied" }],
    ["incompatible", { kind: "failed", reason: "incompatible" }],
    ["error", { kind: "failed", reason: "readiness_error" }],
  ] as const)(
    "preserves the %s outcome without querying candidates",
    async (state, outcome) => {
      const { pool, query } = mockPool()
      vi.mocked(getAiChatGuardReadiness).mockResolvedValue(state)
      expect(await runAiChatRetentionPurge({ pool })).toEqual(outcome)
      expect(query).not.toHaveBeenCalled()
    },
  )
  it("drains multiple pages, advances past spared candidates, and uses one fixed cutoff", async () => {
    const { pool, query } = mockPool()
    const first = Array.from({ length: 500 }, (_, i) => ({
      id: `candidate-${i}`,
    }))
    query
      .mockResolvedValueOnce(result(first))
      .mockResolvedValueOnce(result([{ id: "tail" }]))
    vi.mocked(expireAiChatConversation).mockResolvedValueOnce({
      threadsDeleted: 0,
      recordsDeleted: 0,
    })
    const now = vi.fn(() => Date.parse("2026-09-01T00:00:00Z"))
    expect(await runAiChatRetentionPurge({ pool, now })).toEqual({
      kind: "complete",
      scanned: 501,
      deleted: 500,
      recordsDeleted: 500,
      sweeps: 2,
    })
    const cutoff = new Date(now() - 25 * 86400000)
    expect(query.mock.calls.map((call) => call[1])).toEqual([
      [null, cutoff, 500],
      ["candidate-499", cutoff, 500],
    ])
    expect(expireAiChatConversation).toHaveBeenLastCalledWith("tail", cutoff, {
      pool,
    })
  })
  it("caps a continuously full backlog at 20 pages and leaves later work for the next run", async () => {
    const { pool, query } = mockPool()
    query.mockResolvedValue(
      result(Array.from({ length: 500 }, (_, i) => ({ id: `candidate-${i}` }))),
    )
    expect(await runAiChatRetentionPurge({ pool })).toEqual({
      kind: "complete",
      scanned: 10000,
      deleted: 10000,
      recordsDeleted: 10000,
      sweeps: 20,
    })
    expect(query).toHaveBeenCalledTimes(20)
    query.mockReset().mockResolvedValueOnce(result([{ id: "remaining" }]))
    expect(await runAiChatRetentionPurge({ pool })).toMatchObject({
      scanned: 1,
      deleted: 1,
      sweeps: 1,
    })
    expect(query.mock.calls[0]?.[1]).toEqual([null, expect.any(Date), 500])
  })
  it("surfaces candidate read and per-row cleanup faults without successful counts", async () => {
    const { pool, query } = mockPool()
    query.mockRejectedValueOnce(new Error("synthetic outage"))
    await expect(runAiChatRetentionPurge({ pool })).rejects.toThrow(
      "synthetic outage",
    )
    query.mockResolvedValueOnce(result([{ id: "one" }]))
    vi.mocked(expireAiChatConversation).mockRejectedValueOnce(
      new Error("synthetic cleanup fault"),
    )
    await expect(runAiChatRetentionPurge({ pool })).rejects.toThrow(
      "synthetic cleanup fault",
    )
  })
})
