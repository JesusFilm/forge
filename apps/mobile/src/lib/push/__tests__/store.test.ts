/**
 * The stored registration record. It holds what R3 and R29 need across
 * launches — the change key, the last success, the remembered revocation — and
 * the test ID R31 shows on Profile. It never holds the push token or a viewer
 * handle, which is the property the Profile row and the audience both rest on.
 *
 * Every case drives an injected storage seam. The vendor's own AsyncStorage
 * mock stands in for the native module the module-scope import needs.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import {
  PUSH_REGISTRATION_RECORD_VERSION,
  PUSH_REGISTRATION_STORAGE_KEY,
} from "../constants"
import { createPushRegistrationStore } from "../store"

function createStore(
  options: {
    stored?: string | null
    failRead?: boolean
    failWrite?: boolean
    now?: () => number
  } = {},
) {
  const storage = new Map<string, string>()
  if (options.stored != null) {
    storage.set(PUSH_REGISTRATION_STORAGE_KEY, options.stored)
  }
  const reads: string[] = []
  const writes: string[] = []
  let failRead = options.failRead ?? false
  const store = createPushRegistrationStore({
    getItem: async (key) => {
      reads.push(key)
      if (failRead) throw new Error("storage unavailable")
      return storage.get(key) ?? null
    },
    setItem: async (key, value) => {
      writes.push(value)
      if (options.failWrite) throw new Error("storage full")
      storage.set(key, value)
    },
    now: options.now ?? (() => 1_000),
  })
  return {
    store,
    reads,
    writes,
    storage,
    healRead: () => {
      failRead = false
    },
  }
}

function serialized(record: {
  testDeviceId?: string | null
  payloadHash?: string | null
  lastSuccessAt?: number | null
  revocationReportedAt?: number | null
  version?: number
}): string {
  return JSON.stringify({
    version: PUSH_REGISTRATION_RECORD_VERSION,
    testDeviceId: null,
    payloadHash: null,
    lastSuccessAt: null,
    revocationReportedAt: null,
    ...record,
  })
}

describe("the push registration store", () => {
  it("reads nothing before hydration and an empty record after one", async () => {
    const { store } = createStore()

    expect(store.getRecord()).toBeNull()
    await store.hydrate()

    expect(store.getRecord()).toEqual({
      version: PUSH_REGISTRATION_RECORD_VERSION,
      testDeviceId: null,
      payloadHash: null,
      lastSuccessAt: null,
      revocationReportedAt: null,
    })
  })

  it("hydrates a stored record once, however many callers ask", async () => {
    const { store, reads } = createStore({
      stored: serialized({
        testDeviceId: "abc12345",
        payloadHash: "deadbeefdeadbeef",
        lastSuccessAt: 500,
      }),
    })

    await Promise.all([store.hydrate(), store.hydrate()])
    await store.hydrate()

    expect(reads).toHaveLength(1)
    expect(store.getRecord()?.testDeviceId).toBe("abc12345")
    expect(store.getSnapshot().testDeviceId).toBe("abc12345")
  })

  it("lets a later hydration retry after a failed read", async () => {
    // A failed read must not memoize "no record": the next pass would then
    // re-register a phone that is already registered, every launch.
    const harness = createStore({
      stored: serialized({ testDeviceId: "abc12345" }),
      failRead: true,
    })

    await harness.store.hydrate()
    expect(harness.store.getRecord()).toBeNull()

    harness.healRead()
    await harness.store.hydrate()

    expect(harness.store.getRecord()?.testDeviceId).toBe("abc12345")
    expect(harness.reads).toHaveLength(2)
  })

  it("refuses a record of another version, a bad shape, or junk", async () => {
    for (const stored of [
      serialized({ version: PUSH_REGISTRATION_RECORD_VERSION + 1 }),
      "{not json",
      "null",
      JSON.stringify([1, 2]),
      JSON.stringify({ version: 1, testDeviceId: 42 }),
    ]) {
      const { store } = createStore({ stored })
      await store.hydrate()
      expect(store.getRecord()?.testDeviceId ?? null).toBeNull()
    }
  })

  it("stores the test ID and the change key on a success", async () => {
    const { store, storage } = createStore({ now: () => 2_000 })
    await store.hydrate()

    await store.recordSuccess({
      testDeviceId: "abc12345",
      payloadHash: "0123456789abcdef",
    })

    expect(store.getRecord()).toEqual({
      version: PUSH_REGISTRATION_RECORD_VERSION,
      testDeviceId: "abc12345",
      payloadHash: "0123456789abcdef",
      lastSuccessAt: 2_000,
      revocationReportedAt: null,
    })
    expect(
      JSON.parse(storage.get(PUSH_REGISTRATION_STORAGE_KEY) ?? "{}")
        .testDeviceId,
    ).toBe("abc12345")
  })

  it("never writes a push token or a viewer handle", async () => {
    const { store, writes } = createStore()
    await store.hydrate()

    await store.recordSuccess({
      testDeviceId: "abc12345",
      payloadHash: "0123456789abcdef",
    })
    await store.markRevocationReported()

    for (const blob of writes) {
      expect(blob).not.toContain("ExponentPushToken")
      expect(Object.keys(JSON.parse(blob)).sort()).toEqual([
        "lastSuccessAt",
        "payloadHash",
        "revocationReportedAt",
        "testDeviceId",
        "version",
      ])
    }
  })

  it("remembers a reported revocation, and a later success re-arms it", async () => {
    const { store } = createStore({ now: () => 3_000 })
    await store.hydrate()
    await store.recordSuccess({
      testDeviceId: "abc12345",
      payloadHash: "hash",
    })

    await store.markRevocationReported()
    expect(store.getRecord()?.revocationReportedAt).toBe(3_000)

    // A viewer who turns notifications back on and registers again must be
    // able to report the NEXT revocation; R29 is once per revocation.
    await store.recordSuccess({ testDeviceId: "abc12345", payloadHash: "hash" })
    expect(store.getRecord()?.revocationReportedAt).toBeNull()
  })

  it("keeps serving from memory when the write fails", async () => {
    const { store } = createStore({ failWrite: true })
    await store.hydrate()

    await store.recordSuccess({
      testDeviceId: "abc12345",
      payloadHash: "hash",
    })

    expect(store.getRecord()?.testDeviceId).toBe("abc12345")
  })

  it("serves a stable snapshot object so a subscriber cannot loop", async () => {
    const { store } = createStore()
    await store.hydrate()

    const first = store.getSnapshot()
    expect(store.getSnapshot()).toBe(first)

    store.setPermission("granted")
    const second = store.getSnapshot()
    expect(second).not.toBe(first)
    expect(store.getSnapshot()).toBe(second)
    // An unchanged write keeps the same object, or useSyncExternalStore
    // re-renders on every pass.
    store.setPermission("granted")
    expect(store.getSnapshot()).toBe(second)
  })

  it("notifies subscribers on a change and never after they leave", async () => {
    const { store } = createStore()
    await store.hydrate()
    const seen: string[] = []
    const unsubscribe = store.subscribe(() => {
      seen.push(store.getSnapshot().permission)
    })

    store.setPermission("denied")
    store.setPermission("denied")
    await store.recordSuccess({ testDeviceId: "abc12345", payloadHash: "hash" })
    unsubscribe()
    store.setPermission("granted")

    expect(seen).toEqual(["denied", "denied"])
    expect(store.getSnapshot().permission).toBe("granted")
  })

  it("starts with an unknown permission, so Profile shows no denial by default", async () => {
    const { store } = createStore()

    expect(store.getSnapshot()).toEqual({
      testDeviceId: null,
      permission: "unknown",
    })
  })
})
