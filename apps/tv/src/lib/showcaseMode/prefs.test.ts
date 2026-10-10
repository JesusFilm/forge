import { _resetStorageForTests, getStorage } from "../safeStorage"
import {
  DEFAULT_SHOWCASE_PREFS,
  SHOWCASE_PREFS_STORAGE_KEY,
  loadShowcasePrefs,
  mergeShowcasePrefs,
  parseStoredPrefs,
  saveShowcasePrefs,
} from "./prefs"

// getStorage() warns once per reset when AsyncStorage isn't linked (always, under
// jest). Silence it so the reset-per-test doesn't drown the run.
beforeAll(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
})

beforeEach(() => {
  _resetStorageForTests()
})

describe("parseStoredPrefs", () => {
  it("returns defaults when nothing is stored", () => {
    expect(parseStoredPrefs(null)).toEqual(DEFAULT_SHOWCASE_PREFS)
  })

  it("reads a stored autoStart choice", () => {
    expect(parseStoredPrefs('{"autoStart":true}')).toEqual({ autoStart: true })
  })

  it("falls back to defaults on corrupted JSON", () => {
    expect(parseStoredPrefs("{{{not json")).toEqual(DEFAULT_SHOWCASE_PREFS)
  })

  it("falls back to defaults when autoStart is not a boolean", () => {
    expect(parseStoredPrefs('{"autoStart":"yes"}')).toEqual(
      DEFAULT_SHOWCASE_PREFS,
    )
  })

  it("falls back to defaults when the payload is not an object", () => {
    expect(parseStoredPrefs("[true]")).toEqual(DEFAULT_SHOWCASE_PREFS)
    expect(parseStoredPrefs("null")).toEqual(DEFAULT_SHOWCASE_PREFS)
  })

  it("ignores unknown fields from a future writer", () => {
    expect(parseStoredPrefs('{"autoStart":true,"dwellMs":9000}')).toEqual({
      autoStart: true,
    })
  })
})

describe("mergeShowcasePrefs", () => {
  it("takes the stored value when no local write happened before hydration", () => {
    expect(mergeShowcasePrefs({ autoStart: true }, {})).toEqual({
      autoStart: true,
    })
  })

  it("keeps a local write that raced ahead of hydration", () => {
    // The whole point: `false` is both the default AND a real user choice, so
    // only an explicit pending write — never the value — can win over disk.
    expect(
      mergeShowcasePrefs({ autoStart: true }, { autoStart: false }),
    ).toEqual({ autoStart: false })
    expect(
      mergeShowcasePrefs({ autoStart: false }, { autoStart: true }),
    ).toEqual({ autoStart: true })
  })

  it("does not mutate its inputs", () => {
    const onDisk = { autoStart: true }
    mergeShowcasePrefs(onDisk, { autoStart: false })
    expect(onDisk).toEqual({ autoStart: true })
  })
})

describe("loadShowcasePrefs / saveShowcasePrefs", () => {
  it("hydrates defaults from empty storage", async () => {
    await expect(loadShowcasePrefs()).resolves.toEqual(DEFAULT_SHOWCASE_PREFS)
  })

  it("defaults autoStart off", () => {
    expect(DEFAULT_SHOWCASE_PREFS.autoStart).toBe(false)
  })

  it("re-hydrates a persisted toggle", async () => {
    await saveShowcasePrefs({ autoStart: true })
    await expect(loadShowcasePrefs()).resolves.toEqual({ autoStart: true })
  })

  it("re-hydrates a toggle turned back off", async () => {
    await saveShowcasePrefs({ autoStart: true })
    await saveShowcasePrefs({ autoStart: false })
    await expect(loadShowcasePrefs()).resolves.toEqual({ autoStart: false })
  })

  it("discards data written under an older key version", async () => {
    await getStorage().setItem("tv.showcaseMode.v0", '{"autoStart":true}')
    await expect(loadShowcasePrefs()).resolves.toEqual(DEFAULT_SHOWCASE_PREFS)
  })

  it("hydrates defaults when stored JSON is corrupt", async () => {
    await getStorage().setItem(SHOWCASE_PREFS_STORAGE_KEY, "{{{not json")
    await expect(loadShowcasePrefs()).resolves.toEqual(DEFAULT_SHOWCASE_PREFS)
  })

  // AE2: exits must leave auto-start untouched. Reading is the only prefs call an
  // exit path makes, so hydration staying write-free is what makes that hold.
  it("never writes while hydrating", async () => {
    await getStorage().setItem(SHOWCASE_PREFS_STORAGE_KEY, "{{{not json")
    await loadShowcasePrefs()
    await expect(
      getStorage().getItem(SHOWCASE_PREFS_STORAGE_KEY),
    ).resolves.toBe("{{{not json")
  })

  it("hydrates defaults when the storage read throws", async () => {
    jest.spyOn(getStorage(), "getItem").mockRejectedValueOnce(new Error("nope"))
    await expect(loadShowcasePrefs()).resolves.toEqual(DEFAULT_SHOWCASE_PREFS)
  })

  it("swallows a failed persist rather than throwing at the caller", async () => {
    jest.spyOn(getStorage(), "setItem").mockRejectedValueOnce(new Error("full"))
    await expect(
      saveShowcasePrefs({ autoStart: true }),
    ).resolves.toBeUndefined()
  })
})
