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
  DEFAULT_LINE_SPACING_STEP,
  DEFAULT_READER_SETTINGS,
  DEFAULT_TEXT_SIZE_STEP,
  READER_LINE_SPACING_STEPS,
  READER_SETTINGS_STORAGE_KEY,
  READER_SETTINGS_VERSION,
  READER_TEXT_SIZE_STEPS,
  parseStoredReaderSettings,
  readerLineSpacing,
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
  mode: "trueDark",
  textSizeStep: READER_TEXT_SIZE_STEPS.length - 1,
  typeface: "sans",
  lineSpacingStep: READER_LINE_SPACING_STEPS.length - 1,
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
  it("defaults to Dark, serif, 30 pt, the middle spacing, verse numbers on, arrows off", () => {
    expect(DEFAULT_READER_SETTINGS).toEqual({
      mode: "dark",
      typeface: "serif",
      textSizeStep: DEFAULT_TEXT_SIZE_STEP,
      lineSpacingStep: DEFAULT_LINE_SPACING_STEP,
      verseNumbers: true,
      showArrows: false,
    })
    expect(readerTextSize(DEFAULT_TEXT_SIZE_STEP)).toBe(30)
    expect(DEFAULT_LINE_SPACING_STEP).toBe(
      (READER_LINE_SPACING_STEPS.length - 1) / 2,
    )
  })

  it("gives the text size slider eleven steps of 2 pt from 22 to 42", () => {
    expect([...READER_TEXT_SIZE_STEPS]).toEqual([
      22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42,
    ])
  })

  it("gives the line spacing slider five ascending steps from compact to relaxed", () => {
    const steps = [...READER_LINE_SPACING_STEPS]
    expect(steps).toEqual([1.2, 1.3, 1.4, 1.5, 1.6])
    expect(readerLineSpacing(0)).toBe(1.2)
    expect(readerLineSpacing(99)).toBe(1.6)
    expect(readerLineSpacing(0.5)).toBe(
      READER_LINE_SPACING_STEPS[DEFAULT_LINE_SPACING_STEP],
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
    const raw = withVersion({ ...CHANGED, mode: "neon", showArrows: "yes" })

    expect(parseStoredReaderSettings(raw)).toEqual({
      ...CHANGED,
      mode: DEFAULT_READER_SETTINGS.mode,
      showArrows: DEFAULT_READER_SETTINGS.showArrows,
    })
  })

  it("stores True Dark as a mode, with no palette field", () => {
    const raw = JSON.parse(serializeReaderSettings(CHANGED)) as Record<
      string,
      unknown
    >
    expect(raw.mode).toBe("trueDark")
    expect(raw).not.toHaveProperty("palette")
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

  it("clamps a line spacing step to the list and refuses a fraction", () => {
    const step = (lineSpacingStep: unknown) =>
      parseStoredReaderSettings(withVersion({ ...CHANGED, lineSpacingStep }))
        ?.lineSpacingStep

    expect(step(99)).toBe(READER_LINE_SPACING_STEPS.length - 1)
    expect(step(-3)).toBe(0)
    expect(step(1.5)).toBe(DEFAULT_LINE_SPACING_STEP)
    expect(step("relaxed")).toBe(DEFAULT_LINE_SPACING_STEP)
  })
})

describe("a version 1 record", () => {
  // Version 1 had five sizes (22, 26, 30, 36, 42 pt), three named spacings,
  // and a palette. The literal 1, not a constant: a version bump must not
  // move this test.
  const v1 = (fields: Record<string, unknown>) =>
    parseStoredReaderSettings(
      JSON.stringify({
        version: 1,
        mode: "light",
        palette: "classic",
        typeface: "sans",
        verseNumbers: false,
        showArrows: true,
        ...fields,
      }),
    )

  it("keeps each old text size, and 30 pt as the default", () => {
    const sizes = [0, 1, 2, 3, 4].map((textSizeStep) =>
      readerTextSize(
        v1({ textSizeStep, lineSpacing: "normal" })?.textSizeStep ?? -1,
      ),
    )
    expect(sizes).toEqual([22, 26, 30, 36, 42])
    expect(v1({ textSizeStep: 2 })?.textSizeStep).toBe(DEFAULT_TEXT_SIZE_STEP)
  })

  it("keeps compact and relaxed at the ends, and normal at the middle step", () => {
    const spacing = (lineSpacing: string) =>
      readerLineSpacing(v1({ lineSpacing })?.lineSpacingStep ?? -1)
    expect(spacing("compact")).toBe(1.2)
    expect(spacing("normal")).toBe(1.4)
    expect(spacing("relaxed")).toBe(1.6)
    expect(v1({ lineSpacing: "normal" })?.lineSpacingStep).toBe(
      DEFAULT_LINE_SPACING_STEP,
    )
  })

  it("makes Dark with the True Dark palette the True Dark mode", () => {
    expect(v1({ mode: "dark", palette: "trueDark" })?.mode).toBe("trueDark")
    expect(v1({ mode: "dark", palette: "classic" })?.mode).toBe("dark")
  })

  it("drops the palette from Light and System", () => {
    // True Dark's light variant is gone, so these keep their mode.
    expect(v1({ mode: "light", palette: "trueDark" })?.mode).toBe("light")
    expect(v1({ mode: "system", palette: "trueDark" })?.mode).toBe("system")
    expect(v1({ mode: "light", palette: "trueDark" })).not.toHaveProperty(
      "palette",
    )
  })

  it("keeps every other setting, and defaults a bad old value", () => {
    expect(
      v1({ textSizeStep: 4, lineSpacing: "relaxed", mode: "sepia" }),
    ).toEqual({
      mode: DEFAULT_READER_SETTINGS.mode,
      typeface: "sans",
      textSizeStep: READER_TEXT_SIZE_STEPS.length - 1,
      lineSpacingStep: READER_LINE_SPACING_STEPS.length - 1,
      verseNumbers: false,
      showArrows: true,
    })
    expect(
      v1({ textSizeStep: "big", lineSpacing: "constructor" }),
    ).toMatchObject({
      textSizeStep: DEFAULT_TEXT_SIZE_STEP,
      lineSpacingStep: DEFAULT_LINE_SPACING_STEP,
    })
  })

  it("is written back as the current version on the next change", async () => {
    const storage = makeStorage(
      JSON.stringify({ version: 1, textSizeStep: 3, lineSpacing: "compact" }),
    )
    const store = createReaderSettingsStore(storage)
    await store.hydrate()

    store.update({ typeface: "sans" })
    await settle()

    const raw = JSON.parse(storage.items.get(KEY) ?? "{}") as Record<
      string,
      unknown
    >
    expect(raw.version).toBe(READER_SETTINGS_VERSION)
    expect(raw.lineSpacing).toBeUndefined()
    expect(stored(storage)).toMatchObject({
      textSizeStep: 7,
      lineSpacingStep: 0,
    })
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
      store.update({ mode: "trueDark" })
    })

    expect(latest()?.mode).toBe("trueDark")
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
