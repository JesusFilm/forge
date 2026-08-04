import { WATCH_PROGRESS_QUEUE_STORAGE_KEY } from "../queue"
import { WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY } from "../snapshot"
import {
  attachProgressLifecycle,
  type ProgressLifecycleDeps,
} from "../lifecycle"

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function buildDeps(initialAccountId: string | null = null) {
  let accountId = initialAccountId
  const listeners = new Set<() => void>()
  const calls: string[] = []
  const deps: ProgressLifecycleDeps = {
    getAccountId: () => accountId,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    hydrateFromSnapshot: jest.fn(async () => {
      calls.push("snapshot")
    }),
    hydrateFromServer: jest.fn(async () => {
      calls.push("server")
    }),
    flushQueue: jest.fn(async () => {
      calls.push("flush")
    }),
    resetStore: jest.fn(() => {
      calls.push("reset")
    }),
    removeStorageItem: jest.fn(async (key: string) => {
      calls.push(`remove:${key}`)
    }),
  }
  return {
    deps,
    calls,
    setAccount(next: string | null) {
      accountId = next
      for (const listener of listeners) listener()
    },
  }
}

describe("attachProgressLifecycle", () => {
  it("hydrates snapshot → server → queue flush on sign-in", async () => {
    const { deps, calls, setAccount } = buildDeps(null)
    attachProgressLifecycle(deps)

    setAccount("user-1")
    await flushMicrotasks()

    expect(calls).toEqual(["snapshot", "server", "flush"])
  })

  it("runs the signed-in path immediately for a cold launch with a session", async () => {
    const { deps, calls } = buildDeps("user-1")
    attachProgressLifecycle(deps)
    await flushMicrotasks()

    expect(calls).toEqual(["snapshot", "server", "flush"])
  })

  it("sign-out clears the store, snapshot, and queue (the U8 integration)", async () => {
    const { deps, calls, setAccount } = buildDeps("user-1")
    attachProgressLifecycle(deps)
    await flushMicrotasks()
    calls.length = 0

    setAccount(null)
    await flushMicrotasks()

    expect(calls).toEqual([
      "reset",
      `remove:${WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY}`,
      `remove:${WATCH_PROGRESS_QUEUE_STORAGE_KEY}`,
    ])
  })

  it("an account switch clears the old account before hydrating the new one", async () => {
    const { deps, calls, setAccount } = buildDeps("user-1")
    attachProgressLifecycle(deps)
    await flushMicrotasks()
    calls.length = 0

    setAccount("user-2")
    await flushMicrotasks()

    expect(calls).toEqual([
      "reset",
      `remove:${WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY}`,
      `remove:${WATCH_PROGRESS_QUEUE_STORAGE_KEY}`,
      "snapshot",
      "server",
      "flush",
    ])
  })

  it("ignores same-identity notifications", async () => {
    const { deps, calls, setAccount } = buildDeps("user-1")
    attachProgressLifecycle(deps)
    await flushMicrotasks()
    calls.length = 0

    setAccount("user-1")
    await flushMicrotasks()

    expect(calls).toEqual([])
  })

  it("detaches cleanly", async () => {
    const { deps, calls, setAccount } = buildDeps(null)
    const detach = attachProgressLifecycle(deps)
    detach()

    setAccount("user-1")
    await flushMicrotasks()

    expect(calls).toEqual([])
  })
})
