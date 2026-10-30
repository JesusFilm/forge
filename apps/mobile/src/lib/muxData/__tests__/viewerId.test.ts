/**
 * The Mux-only viewer id (R22, KTD8). One random id for each install, kept on
 * the phone, and shared with no other app id. The store cases drive an
 * injected storage seam; the app-wide cases use the vendor's AsyncStorage mock.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock("../../../env", () => ({ env: {} }))

import AsyncStorage from "@react-native-async-storage/async-storage"

import { env } from "../../../env"
import { PUSH_REGISTRATION_STORAGE_KEY } from "../../push/constants"
import {
  getPushRegistrationStore,
  resetPushRegistrationStoreForTests,
} from "../../push/store"
import { getViewerId } from "../../viewer-id"
import {
  createMuxViewerIdStore,
  getMuxViewerIdStore,
  resetMuxViewerIdStoreForTests,
  startMuxViewerIdRead,
} from "../viewerId"

const mockEnv = env as { EXPO_PUBLIC_MUX_DATA_ENV_KEY?: string }

// A literal, not the exported constant: a renamed key orphans every stored id,
// and each install then counts as a new Mux viewer.
const STORAGE_KEY = "mux-data-viewer-id"

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createStore(
  options: {
    storage?: Map<string, string>
    failRead?: boolean
    failWrite?: boolean
    /** The read waits for this before it answers. */
    holdRead?: Promise<void>
    /** Each store mints its own ids, so a restart cannot match by chance. */
    prefix?: string
  } = {},
) {
  const storage = options.storage ?? new Map<string, string>()
  const reads: string[] = []
  const writes: string[] = []
  const minted: string[] = []
  let failRead = options.failRead ?? false
  const store = createMuxViewerIdStore({
    getItem: async (key) => {
      reads.push(key)
      await options.holdRead
      if (failRead) throw new Error("storage unavailable")
      return storage.get(key) ?? null
    },
    setItem: async (key, value) => {
      writes.push(value)
      if (options.failWrite) throw new Error("storage full")
      storage.set(key, value)
    },
    mintViewerId: () => {
      const id = `${options.prefix ?? "viewer"}-${minted.length + 1}`
      minted.push(id)
      return id
    },
  })
  return {
    store,
    storage,
    reads,
    writes,
    minted,
    healRead: () => {
      failRead = false
    },
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe("createMuxViewerIdStore (R22, KTD8)", () => {
  it("mints an id on the first read, persists it, and returns it", async () => {
    const { store, storage, minted } = createStore()

    await expect(store.get()).resolves.toBe("viewer-1")
    expect(storage.get(STORAGE_KEY)).toBe("viewer-1")
    expect(minted).toEqual(["viewer-1"])
  })

  it("returns the same id on a later read and after a restart", async () => {
    const storage = new Map<string, string>()
    const first = createStore({ storage })
    await expect(first.store.get()).resolves.toBe("viewer-1")
    await expect(first.store.get()).resolves.toBe("viewer-1")

    const restarted = createStore({ storage, prefix: "relaunch" })
    await expect(restarted.store.get()).resolves.toBe("viewer-1")
    expect(restarted.minted).toEqual([])
    expect(restarted.writes).toEqual([])
  })

  it("gives two callers during one pending read the same id from one promise", async () => {
    let release!: () => void
    const holdRead = new Promise<void>((resolve) => {
      release = resolve
    })
    const { store, reads, writes, minted } = createStore({ holdRead })

    const first = store.get()
    const second = store.get()
    expect(second).toBe(first)

    release()
    await expect(Promise.all([first, second])).resolves.toEqual([
      "viewer-1",
      "viewer-1",
    ])
    expect(reads).toHaveLength(1)
    expect(minted).toEqual(["viewer-1"])
    expect(writes).toEqual(["viewer-1"])
  })

  it("keeps one minted id after a failed read and writes it once the read heals", async () => {
    const { store, storage, reads, writes, minted, healRead } = createStore({
      failRead: true,
    })

    await expect(store.get()).resolves.toBe("viewer-1")
    await expect(store.get()).resolves.toBe("viewer-1")
    // A failed read cannot tell an empty slot from a stored id it missed.
    expect(writes).toEqual([])

    healRead()
    await expect(store.get()).resolves.toBe("viewer-1")
    expect(storage.get(STORAGE_KEY)).toBe("viewer-1")
    expect(writes).toEqual(["viewer-1"])
    expect(minted).toEqual(["viewer-1"])
    expect(reads).toHaveLength(3)
  })
  // A write fault must not stop the attach: memory holds the id for this launch.
  it("returns the minted id when the write fails, and mints no second id", async () => {
    const { store, minted } = createStore({ failWrite: true })
    const first = await store.get()
    expect(first).toBe("viewer-1")
    expect(await store.get()).toBe(first)
    expect(minted).toEqual(["viewer-1"])
  })

  // A failed read cannot tell an empty slot from a stored id it missed.
  it("returns the stored id once a failed read heals, and writes nothing", async () => {
    const storage = new Map([[STORAGE_KEY, "stored-id"]])
    const { store, writes, healRead } = createStore({ storage, failRead: true })
    await store.get()
    healRead()
    expect(await store.get()).toBe("stored-id")
    expect(writes).toEqual([])
    expect(storage.get(STORAGE_KEY)).toBe("stored-id")
  })
})

describe("the app-wide Mux viewer id store", () => {
  beforeEach(async () => {
    await AsyncStorage.clear()
    jest.clearAllMocks()
    resetMuxViewerIdStoreForTests()
    resetPushRegistrationStoreForTests()
    delete mockEnv.EXPO_PUBLIC_MUX_DATA_ENV_KEY
  })

  it("mints a version 4 UUID and stores it under its own key", async () => {
    const id = await getMuxViewerIdStore().get()

    expect(id).toMatch(UUID_V4)
    await expect(AsyncStorage.getItem(STORAGE_KEY)).resolves.toBe(id)
  })

  it("shares no storage or value with the push install id or the search viewer id", async () => {
    const installId = await getPushRegistrationStore().ensureInstallId()
    const pushRecord = await AsyncStorage.getItem(PUSH_REGISTRATION_STORAGE_KEY)

    const id = await getMuxViewerIdStore().get()

    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(
      [PUSH_REGISTRATION_STORAGE_KEY, STORAGE_KEY].sort(),
    )
    await expect(
      AsyncStorage.getItem(PUSH_REGISTRATION_STORAGE_KEY),
    ).resolves.toBe(pushRecord)
    expect(id).not.toBe(installId)
    expect(id).not.toBe(getViewerId())
  })

  describe("startMuxViewerIdRead", () => {
    it("reads no storage while the gate is off", async () => {
      startMuxViewerIdRead()
      await flushMicrotasks()

      expect(AsyncStorage.getItem).not.toHaveBeenCalled()
      expect(AsyncStorage.setItem).not.toHaveBeenCalled()
    })

    it("starts the one read at launch when the gate is on, and a later get joins it", async () => {
      mockEnv.EXPO_PUBLIC_MUX_DATA_ENV_KEY = "k0abc123"

      startMuxViewerIdRead()
      await flushMicrotasks()
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(STORAGE_KEY)

      const id = await getMuxViewerIdStore().get()
      expect(id).toMatch(UUID_V4)
      expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1)
    })
  })
})
