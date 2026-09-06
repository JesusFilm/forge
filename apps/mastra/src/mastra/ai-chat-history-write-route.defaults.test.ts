import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Default-wiring pins for the rename route (plan KTD4, "kill-switch seam"):
 * with NO `getMemory` / `getPool` / `getBackend` seam injected — the
 * `index.ts` registration shape — the route must
 *
 *   - resolve ownership over a Memory built DIRECTLY on `getAiChatStorage()`
 *     (the persisted `ai_chat` store) and NEVER call `getAiChatMemory()`,
 *     whose backend the `AI_CHAT_MEMORY_BACKEND=memory` kill-switch swaps for
 *     an InMemoryStore (a lookup there would answer a false thread_not_found);
 *   - open its pool on the SAME connection-string resolver the store uses
 *     (`getMastraDatabaseUrl`), with the pinned options;
 *   - construct each exactly once across calls (module-scoped, lazy);
 *   - refuse 503 `writes_disabled` through the DEFAULT backend source when
 *     the resolved backend is `memory`, constructing nothing.
 *
 * The seam-injected suite (`ai-chat-history-write-route.test.ts`) proves the
 * ladder's shape; this file proves what the defaults are wired to. Mocked
 * constructors stand in for `@mastra/memory` and `pg` so the test never opens
 * a socket.
 */

const OWNER = "user:sub-defaults"

const state = vi.hoisted(() => ({
  backend: "postgres" as "postgres" | "memory",
}))
const STORAGE_SENTINEL = vi.hoisted(() => ({ sentinel: "ai-chat-storage" }))
const DB_URL_SENTINEL = "postgresql://sentinel-host:5432/sentinel-db"
const getAiChatStorage = vi.hoisted(() => vi.fn(() => STORAGE_SENTINEL))
const getAiChatMemory = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("getAiChatMemory must never be called by the rename route")
  }),
)
const memoryCtor = vi.hoisted(() => vi.fn())
const poolCtor = vi.hoisted(() => vi.fn())
const poolQuery = vi.hoisted(() =>
  vi.fn(async (_text: string, _values?: unknown[]) => ({ rowCount: 1 })),
)
const poolOn = vi.hoisted(() =>
  vi.fn((_event: string, _listener: (...args: unknown[]) => void) => {}),
)

vi.mock("../config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/env")>()),
  getMastraDatabaseUrl: () => DB_URL_SENTINEL,
  resolveAiChatMemoryBackend: () => state.backend,
}))

vi.mock("./ai-chat-memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai-chat-memory")>()),
  getAiChatStorage,
  getAiChatMemory,
}))

vi.mock("@mastra/memory", () => ({
  Memory: class {
    constructor(options: unknown) {
      memoryCtor(options)
    }
    async getThreadById(_args: { threadId: string }) {
      return { resourceId: OWNER }
    }
  },
}))

vi.mock("pg", () => ({
  Pool: class {
    constructor(options: unknown) {
      poolCtor(options)
    }
    query = poolQuery
    on = poolOn
  },
}))

import {
  __resetAiChatRenameStoreForTesting,
  AI_CHAT_RENAME_POOL_OPTIONS,
  handleAiChatHistoryRenameRequest,
} from "./ai-chat-history-write-route"

const LANE_KEYS = ["test-lane-key"] as const

function noSeamInput() {
  return {
    authHeader: "Bearer test-lane-key",
    readJson: async () => ({
      resourceId: OWNER,
      threadId: "thread-defaults",
      title: "Renamed through the defaults",
    }),
    getEnabled: () => true,
    getServiceKeys: () => LANE_KEYS,
    // Deliberately NO getBackend / getMemory / getPool — the defaults are the
    // subject under test.
  }
}

afterEach(() => {
  __resetAiChatRenameStoreForTesting()
  state.backend = "postgres"
  getAiChatStorage.mockClear()
  getAiChatMemory.mockClear()
  memoryCtor.mockClear()
  poolCtor.mockClear()
  poolQuery.mockClear()
  poolOn.mockClear()
})

describe("rename route — default wiring (KTD4)", () => {
  it("resolves ownership over a Memory built on getAiChatStorage and never calls getAiChatMemory", async () => {
    const outcome = await handleAiChatHistoryRenameRequest(noSeamInput())
    expect(outcome.status).toBe(200)
    expect(getAiChatStorage).toHaveBeenCalledTimes(1)
    expect(getAiChatMemory).not.toHaveBeenCalled()
    expect(memoryCtor).toHaveBeenCalledTimes(1)
    expect(memoryCtor).toHaveBeenCalledWith({ storage: STORAGE_SENTINEL })
  })

  it("opens its pool on the same connection-string resolver as the store, with the pinned options", async () => {
    await handleAiChatHistoryRenameRequest(noSeamInput())
    expect(poolCtor).toHaveBeenCalledTimes(1)
    expect(poolCtor).toHaveBeenCalledWith({
      connectionString: DB_URL_SENTINEL,
      ...AI_CHAT_RENAME_POOL_OPTIONS,
    })
    expect(poolQuery).toHaveBeenCalledTimes(1)
    expect(poolQuery.mock.calls[0]![1]).toEqual([
      "Renamed through the defaults",
      "thread-defaults",
      OWNER,
    ])
  })

  it("attaches an enum-only `error` listener to the pool (an unlistened idle-client error is process-fatal)", async () => {
    // pg-pool emits `error` on the POOL for an idle-client failure; with no
    // listener that is an uncaught exception in the single-replica runtime.
    // The mock's `on` records the registration; invoking the captured
    // listener with an error carrying a sentinel proves the log is enum-only.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await handleAiChatHistoryRenameRequest(noSeamInput())
    expect(poolOn).toHaveBeenCalledTimes(1)
    const [event, listener] = poolOn.mock.calls[0]!
    expect(event).toBe("error")
    expect(() =>
      listener(new Error("connection terminated SENTINEL_CONNSTRING")),
    ).not.toThrow()
    const logged = warn.mock.calls.flat().map(String).join("\n")
    expect(logged).toContain("[ai-chat-history] event=rename_pool_idle_error")
    expect(logged).not.toContain("SENTINEL_CONNSTRING")
    warn.mockRestore()
  })

  it("constructs the Memory and the pool once across calls (module-scoped, lazy)", async () => {
    await handleAiChatHistoryRenameRequest(noSeamInput())
    await handleAiChatHistoryRenameRequest(noSeamInput())
    expect(memoryCtor).toHaveBeenCalledTimes(1)
    expect(poolCtor).toHaveBeenCalledTimes(1)
    expect(poolQuery).toHaveBeenCalledTimes(2)
  })

  it("refuses 503 writes_disabled through the DEFAULT backend source under the kill-switch, constructing nothing", async () => {
    state.backend = "memory"
    const outcome = await handleAiChatHistoryRenameRequest(noSeamInput())
    expect(outcome.status).toBe(503)
    expect(outcome.body).toEqual({ reason: "writes_disabled" })
    expect(getAiChatStorage).not.toHaveBeenCalled()
    expect(getAiChatMemory).not.toHaveBeenCalled()
    expect(memoryCtor).not.toHaveBeenCalled()
    expect(poolCtor).not.toHaveBeenCalled()
    expect(poolQuery).not.toHaveBeenCalled()
  })
})
