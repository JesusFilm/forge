/**
 * The reader settings store (feat-553 U5, R33, KTD5). Each case builds its own
 * store over its own fake storage. The hook cases wrap the element in
 * StrictMode (RTL is not installed here).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import AsyncStorage from "@react-native-async-storage/async-storage"
import { StrictMode, act, createElement } from "react"

import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  DEFAULT_READER_SETTINGS,
  DEFAULT_TEXT_SIZE_STEP,
  READER_SETTINGS_STORAGE_KEY,
  READER_SETTINGS_VERSION,
  READER_TEXT_SIZE_STEPS,
  parseStoredReaderSettings,
  readerTextSize,
  serializeReaderSettings,
  type ReaderSettings,
} from "../settings/snapshot"
import {
  createReaderSettingsStore,
  getReaderSettingsStore,
  resetReaderSettingsStoreForTests,
  useReaderSettings,
  type ReaderSettingsSnapshot,
  type ReaderSettingsStore,
} from "../settings/store"

const KEY = READER_SETTINGS_STORAGE_KEY

const CHANGED: ReaderSettings = {
  mode: "light",
  textSizeStep: READER_TEXT_SIZE_STEPS.length - 1,
  palette: "trueDark",
  typeface: "sans",
  lineSpacing: "relaxed",
  verseNumbers: false,
  showArrows: true,
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function makeStorage(seed: string | null = null) {
  const items = new Map<string, string>()
  if (seed != null) items.set(KEY, seed)
  return {
    items,
    getItem: jest.fn(async (key: string) => items.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      items.set(key, value)
    }),
  }
}

function stored(storage: ReturnType<typeof makeStorage>) {
  return parseStoredReaderSettings(storage.items.get(KEY) ?? null)
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

function withVersion(fields: Record<string, unknown>): string {
  return JSON.stringify({ version: READER_SETTINGS_VERSION, ...fields })
}

describe("R33 defaults", () => {
  it("defaults to Dark, Classic, serif, the middle size, normal spacing, verse numbers on, arrows off", () => {
    expect(DEFAULT_READER_SETTINGS).toEqual({
      mode: "dark",
      palette: "classic",
      typeface: "serif",
      textSizeStep: DEFAULT_TEXT_SIZE_STEP,
      lineSpacing: "normal",
      verseNumbers: true,
      showArrows: false,
    })
    expect(READER_TEXT_SIZE_STEPS.length % 2).toBe(1)
    expect(DEFAULT_TEXT_SIZE_STEP).toBe((READER_TEXT_SIZE_STEPS.length - 1) / 2)
  })

  it("lists the text sizes as ascending points", () => {
    const steps = [...READER_TEXT_SIZE_STEPS]
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    expect(new Set(steps).size).toBe(steps.length)
    expect(readerTextSize(DEFAULT_TEXT_SIZE_STEP)).toBe(
      READER_TEXT_SIZE_STEPS[DEFAULT_TEXT_SIZE_STEP],
    )
  })

  it("opens a fresh install with the defaults", async () => {
    const store = createReaderSettingsStore(makeStorage())

    await store.hydrate()

    expect(store.getSnapshot()).toEqual({
      ...DEFAULT_READER_SETTINGS,
      status: "ready",
    })
  })
})

describe("snapshot", () => {
  it("round-trips every setting", () => {
    expect(parseStoredReaderSettings(serializeReaderSettings(CHANGED))).toEqual(
      CHANGED,
    )
  })

  it("reads bad JSON or another version as no record", () => {
    expect(parseStoredReaderSettings(null)).toBeNull()
    expect(parseStoredReaderSettings("{bad")).toBeNull()
    expect(
      parseStoredReaderSettings(
        JSON.stringify({ ...CHANGED, version: READER_SETTINGS_VERSION + 1 }),
      ),
    ).toBeNull()
  })

  it("keeps the good fields when one field is bad", () => {
    const raw = withVersion({ ...CHANGED, palette: "neon", showArrows: "yes" })

    expect(parseStoredReaderSettings(raw)).toEqual({
      ...CHANGED,
      palette: DEFAULT_READER_SETTINGS.palette,
      showArrows: DEFAULT_READER_SETTINGS.showArrows,
    })
  })

  it("clamps a text size step to the list and refuses a fraction", () => {
    const last = READER_TEXT_SIZE_STEPS.length - 1
    const step = (textSizeStep: unknown) =>
      parseStoredReaderSettings(withVersion({ ...CHANGED, textSizeStep }))
        ?.textSizeStep

    expect(step(99)).toBe(last)
    expect(step(-3)).toBe(0)
    expect(step(1.5)).toBe(DEFAULT_TEXT_SIZE_STEP)
    expect(step("2")).toBe(DEFAULT_TEXT_SIZE_STEP)
    expect(readerTextSize(99)).toBe(READER_TEXT_SIZE_STEPS[last])
  })
})

describe("store", () => {
  it("keeps each setting on the device across a restart", async () => {
    const storage = makeStorage()
    const store = createReaderSettingsStore(storage)
    await store.hydrate()

    expect(store.update(CHANGED)).toBe(true)
    await settle()

    const restarted = createReaderSettingsStore(storage)
    await restarted.hydrate()
    expect(restarted.getSnapshot()).toEqual({ ...CHANGED, status: "ready" })
  })

  it("ignores a value that is not a setting", async () => {
    const storage = makeStorage()
    const store = createReaderSettingsStore(storage)
    await store.hydrate()
    const bad = {
      mode: "sepia",
      textSizeStep: 2.5,
    } as unknown as Partial<ReaderSettings>

    expect(store.update(bad)).toBe(false)
    expect(store.update({ ...bad, typeface: "sans" })).toBe(true)
    await settle()

    expect(store.getSnapshot()).toMatchObject({
      mode: "dark",
      textSizeStep: DEFAULT_TEXT_SIZE_STEP,
      typeface: "sans",
    })
  })

  it("keeps a change made before the read settles, and adopts the other stored fields", async () => {
    const storage = makeStorage(serializeReaderSettings(CHANGED))
    const read = deferred<string | null>()
    storage.getItem.mockReturnValueOnce(read.promise)
    const store = createReaderSettingsStore(storage)
    void store.hydrate()

    store.update({ mode: "light" })
    read.resolve(serializeReaderSettings(CHANGED))
    await settle()

    const expected = { ...CHANGED, mode: "light" }
    expect(store.getSnapshot()).toEqual({ ...expected, status: "ready" })
    expect(stored(storage)).toEqual(expected)
  })
})

describe("useReaderSettings under StrictMode", () => {
  const mounted: TestInstance[] = []

  afterEach(() => {
    act(() => {
      mounted.splice(0).forEach((renderer) => renderer.unmount())
    })
  })

  function render(store: ReaderSettingsStore) {
    const seen: ReaderSettingsSnapshot[] = []
    function Host() {
      seen.push(useReaderSettings(store))
      return null
    }
    act(() => {
      mounted.push(
        TestRenderer.create(
          createElement(StrictMode, null, createElement(Host)),
        ),
      )
    })
    return () => seen[seen.length - 1]
  }

  it("runs the remount cycle, reads once, and shows the stored settings", async () => {
    const storage = makeStorage(serializeReaderSettings(CHANGED))
    const inner = createReaderSettingsStore(storage)
    const events: string[] = []
    const store: ReaderSettingsStore = {
      ...inner,
      subscribe: (listener) => {
        events.push("subscribe")
        const unsubscribe = inner.subscribe(listener)
        return () => {
          events.push("unsubscribe")
          unsubscribe()
        }
      },
    }

    const latest = render(store)
    await act(settle)

    expect(events.slice(0, 3)).toEqual([
      "subscribe",
      "unsubscribe",
      "subscribe",
    ])
    expect(storage.getItem).toHaveBeenCalledTimes(1)
    expect(latest()).toEqual({ ...CHANGED, status: "ready" })
  })

  it("re-renders on a change after the cycle", async () => {
    const store = createReaderSettingsStore(makeStorage())
    const latest = render(store)
    await act(settle)

    act(() => {
      store.update({ palette: "trueDark" })
    })

    expect(latest()?.palette).toBe("trueDark")
  })
})

describe("the app store", () => {
  beforeEach(async () => {
    resetReaderSettingsStoreForTests()
    await AsyncStorage.clear()
  })

  it("is one store that saves under the settings key", async () => {
    const store = getReaderSettingsStore()
    expect(getReaderSettingsStore()).toBe(store)

    await store.hydrate()
    store.update({ verseNumbers: false })
    await settle()

    const raw = await AsyncStorage.getItem(KEY)
    expect(parseStoredReaderSettings(raw)?.verseNumbers).toBe(false)
  })
})
