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

// The device runtime has no WebCrypto, so the minter falls back to this module.
// The mock stands in for the native one; each case decides what it answers.
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn() }))

import * as ExpoCrypto from "expo-crypto"

import {
  PUSH_INSTALL_ID_PATTERN,
  PUSH_REGISTRATION_RECORD_VERSION,
  PUSH_REGISTRATION_STORAGE_KEY,
} from "../constants"
import { createPushRegistrationStore, mintInstallId } from "../store"

function createStore(
  options: {
    stored?: string | null
    failRead?: boolean
    failWrite?: boolean
    now?: () => number
    /** Overrides what the injected minter answers, shape included. */
    mint?: () => string
  } = {},
) {
  const storage = new Map<string, string>()
  if (options.stored != null) {
    storage.set(PUSH_REGISTRATION_STORAGE_KEY, options.stored)
  }
  const reads: string[] = []
  const writes: string[] = []
  const minted: string[] = []
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
    mintInstallId: () => {
      const id = options.mint?.() ?? `install-${minted.length + 1}`
      minted.push(id)
      return id
    },
  })
  return {
    store,
    reads,
    writes,
    minted,
    storage,
    healRead: () => {
      failRead = false
    },
  }
}

function serialized(record: {
  testDeviceId?: string | null
  installId?: unknown
  payloadHash?: string | null
  lastSuccessAt?: number | null
  revocationReportedAt?: number | null
  version?: number
}): string {
  return JSON.stringify({
    version: PUSH_REGISTRATION_RECORD_VERSION,
    testDeviceId: null,
    installId: null,
    payloadHash: null,
    lastSuccessAt: null,
    revocationReportedAt: null,
    ...record,
  })
}

/** Swaps `globalThis.crypto` for the run, then puts the real one back. */
function withRuntimeCrypto<T>(value: unknown, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")
  Object.defineProperty(globalThis, "crypto", {
    value,
    configurable: true,
    writable: true,
  })
  try {
    return fn()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor)
  }
}

/** Hermes as it ships: random bytes are reachable, `randomUUID` is not. */
function withoutRuntimeRandomUUID<T>(fn: () => T): T {
  return withRuntimeCrypto({ getRandomValues: () => undefined }, fn)
}

/** No WebCrypto at all, which leaves the compat generator as the last tier. */
function withoutRuntimeCrypto<T>(fn: () => T): T {
  return withRuntimeCrypto(undefined, fn)
}

describe("the push registration store", () => {
  it("reads nothing before hydration and an empty record after one", async () => {
    const { store } = createStore()

    expect(store.getRecord()).toBeNull()
    await store.hydrate()

    expect(store.getRecord()).toEqual({
      version: PUSH_REGISTRATION_RECORD_VERSION,
      testDeviceId: null,
      installId: null,
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
      installId: null,
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
        "installId",
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

  it("clears the change key when it marks a revocation reported", async () => {
    // Admin drops a denied row from every audience. If the key survived, the
    // next granted pass would read its own payload as unchanged and send
    // nothing until the weekly refresh.
    const { store } = createStore({ now: () => 3_000 })
    await store.hydrate()
    await store.recordSuccess({
      testDeviceId: "abc12345",
      payloadHash: "0123456789abcdef",
    })

    await store.markRevocationReported()

    expect(store.getRecord()).toEqual({
      version: PUSH_REGISTRATION_RECORD_VERSION,
      testDeviceId: "abc12345",
      installId: null,
      payloadHash: null,
      lastSuccessAt: 3_000,
      revocationReportedAt: 3_000,
    })
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

describe("the install id", () => {
  it("mints one id per install and persists it", async () => {
    const harness = createStore()

    const first = await harness.store.ensureInstallId()
    const second = await harness.store.ensureInstallId()

    expect(second).toBe(first)
    expect(harness.minted).toEqual([first])
    expect(
      JSON.parse(harness.storage.get(PUSH_REGISTRATION_STORAGE_KEY) ?? "{}")
        .installId,
    ).toBe(first)
  })

  it("mints one id for two callers that arrive together", async () => {
    // The registration pass and a revocation report can both read it inside
    // one launch, and a second id would take the first row out of nothing.
    const harness = createStore()

    const [first, second] = await Promise.all([
      harness.store.ensureInstallId(),
      harness.store.ensureInstallId(),
    ])

    expect(second).toBe(first)
    expect(harness.minted).toHaveLength(1)
  })

  it("returns the stored id and mints nothing", async () => {
    const harness = createStore({
      stored: serialized({ installId: "install-stored" }),
    })

    expect(await harness.store.ensureInstallId()).toBe("install-stored")
    expect(harness.minted).toEqual([])
  })

  it("keeps the id across a revocation report and a later success", async () => {
    const harness = createStore()
    const installId = await harness.store.ensureInstallId()

    await harness.store.markRevocationReported()
    expect(harness.store.getRecord()?.installId).toBe(installId)

    await harness.store.recordSuccess({
      testDeviceId: "abc12345",
      payloadHash: "0123456789abcdef",
    })

    expect(harness.store.getRecord()?.installId).toBe(installId)
    expect(await harness.store.ensureInstallId()).toBe(installId)
    expect(harness.minted).toEqual([installId])
  })

  it("re-mints an id admin would refuse, which nothing else would replace", async () => {
    // A stored id outside admin's 8-to-64 bound loses every registration this
    // install ever makes, and the id is never regenerated on its own.
    const harness = createStore({ stored: serialized({ installId: "short" }) })

    const installId = await harness.store.ensureInstallId()

    expect(installId).not.toBe("short")
    expect(harness.minted).toEqual([installId])
  })

  it("overrules a MINTED id outside admin's bound too", async () => {
    // The stored-id check never sees a fresh id, so a minter tier that answers
    // an unusable shape would hand admin BAD_USER_INPUT for the install's life.
    const harness = createStore({ mint: () => "a:b" })

    const installId = await harness.store.ensureInstallId()

    expect(PUSH_INSTALL_ID_PATTERN.test(installId)).toBe(true)
    expect(installId).not.toBe("a:b")
    // Anti-vacuous: the minter really did answer the refused shape.
    expect(harness.minted).toEqual(["a:b"])
    // The overruling id is the one that gets kept and persisted.
    expect(await harness.store.ensureInstallId()).toBe(installId)
    expect(
      JSON.parse(harness.storage.get(PUSH_REGISTRATION_STORAGE_KEY) ?? "{}")
        .installId,
    ).toBe(installId)
  })

  it("re-hydrates a record from the previous version as empty", async () => {
    const old = createStore({
      stored: serialized({
        version: PUSH_REGISTRATION_RECORD_VERSION - 1,
        testDeviceId: "abc12345",
        installId: "install-stored",
      }),
    })
    await old.store.hydrate()

    expect(old.store.getRecord()?.installId).toBeNull()
    expect(old.store.getRecord()?.testDeviceId).toBeNull()

    // Anti-vacuous: the same blob at the current version does hydrate, so the
    // version is what refused it and not the shape.
    const current = createStore({
      stored: serialized({
        testDeviceId: "abc12345",
        installId: "install-stored",
      }),
    })
    await current.store.hydrate()

    expect(current.store.getRecord()?.installId).toBe("install-stored")
  })

  it("serves an id after a failed read without clobbering the record", async () => {
    // Persisting here would write over a test ID and a change key the store
    // could not read. The next launch reads them and keeps this id.
    const harness = createStore({
      stored: serialized({ testDeviceId: "abc12345" }),
      failRead: true,
    })

    const installId = await harness.store.ensureInstallId()

    expect(installId).toBe("install-1")
    expect(harness.writes).toEqual([])

    harness.healRead()
    await harness.store.hydrate()

    expect(harness.store.getRecord()?.testDeviceId).toBe("abc12345")
    expect(await harness.store.ensureInstallId()).toBe(installId)
    expect(harness.minted).toEqual([installId])
    expect(
      JSON.parse(harness.storage.get(PUSH_REGISTRATION_STORAGE_KEY) ?? "{}"),
    ).toMatchObject({ installId, testDeviceId: "abc12345" })
  })
})

describe("the production install-id minter", () => {
  const expoRandomUUID = ExpoCrypto.randomUUID as jest.Mock

  beforeEach(() => {
    expoRandomUUID.mockReset()
  })

  it("answers admin's shape from the runtime's own generator", () => {
    // Anti-vacuous: this env really does carry the first tier.
    expect(typeof globalThis.crypto?.randomUUID).toBe("function")

    const id = mintInstallId()

    expect(PUSH_INSTALL_ID_PATTERN.test(id)).toBe(true)
    expect(id).not.toBe(mintInstallId())
    expect(expoRandomUUID).not.toHaveBeenCalled()
  })

  it("answers admin's shape from expo-crypto on a runtime with none", () => {
    expoRandomUUID.mockReturnValue("6f1b9d64-9b25-4f0e-9b55-0f2a7c1e4d33")

    withoutRuntimeRandomUUID(() => {
      const id = mintInstallId()
      expect(id).toBe("6f1b9d64-9b25-4f0e-9b55-0f2a7c1e4d33")
      expect(PUSH_INSTALL_ID_PATTERN.test(id)).toBe(true)
    })

    expect(expoRandomUUID).toHaveBeenCalledTimes(1)
  })

  it("answers admin's shape from the compat generator when neither is there", () => {
    expoRandomUUID.mockImplementation(() => {
      throw new Error("native module missing")
    })

    withoutRuntimeCrypto(() => {
      const id = mintInstallId()
      expect(PUSH_INSTALL_ID_PATTERN.test(id)).toBe(true)
      expect(id).not.toBe(mintInstallId())
    })

    expect(expoRandomUUID).toHaveBeenCalledTimes(2)
  })
})
