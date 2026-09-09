import { _resetStorageForTests, getStorage } from "./safeStorage"

// The native Datadog SDK never links under jest; stub the emit surface so read/
// write-failure logging is assertable without pulling it in.
jest.mock("./datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { datadogLog } from "./datadog"
import {
  DEFAULT_WATCH_PREFERENCES,
  WATCH_PREFERENCES_STORAGE_KEY,
  loadWatchPreferences,
  mergeWatchPreferences,
  parseStoredPreferences,
  saveWatchPreferences,
} from "./watchPreferences"

// getStorage() warns once per reset when AsyncStorage isn't linked (always, under
// jest). Silence it so the reset-per-test doesn't drown the run.
beforeAll(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
})

beforeEach(() => {
  _resetStorageForTests()
  jest.clearAllMocks()
})

describe("parseStoredPreferences", () => {
  it("returns defaults when nothing is stored", () => {
    expect(parseStoredPreferences(null)).toEqual(DEFAULT_WATCH_PREFERENCES)
    expect(parseStoredPreferences("")).toEqual(DEFAULT_WATCH_PREFERENCES)
  })

  it("reads a stored audio-language slug", () => {
    expect(parseStoredPreferences('{"audioLanguageSlug":"ko-kmr"}')).toEqual({
      audioLanguageSlug: "ko-kmr",
      nativePlayerVariant: "existing",
    })
  })

  it("falls back to defaults on corrupt JSON", () => {
    expect(parseStoredPreferences("{{{not json")).toEqual(
      DEFAULT_WATCH_PREFERENCES,
    )
  })

  it("falls back to defaults when the payload is not an object", () => {
    expect(parseStoredPreferences("[true]")).toEqual(DEFAULT_WATCH_PREFERENCES)
    expect(parseStoredPreferences("null")).toEqual(DEFAULT_WATCH_PREFERENCES)
    expect(parseStoredPreferences("42")).toEqual(DEFAULT_WATCH_PREFERENCES)
  })

  it("treats an empty or non-string slug as unset", () => {
    expect(parseStoredPreferences('{"audioLanguageSlug":""}')).toEqual({
      audioLanguageSlug: null,
      nativePlayerVariant: "existing",
    })
    expect(parseStoredPreferences('{"audioLanguageSlug":7}')).toEqual({
      audioLanguageSlug: null,
      nativePlayerVariant: "existing",
    })
  })

  it("ignores unknown fields from a future writer", () => {
    expect(
      parseStoredPreferences('{"audioLanguageSlug":"ru","subtitleSlug":"fr"}'),
    ).toEqual({
      audioLanguageSlug: "ru",
      nativePlayerVariant: "existing",
    })
  })

  it("preserves the exact slug — bcp47 prefixes never coalesce", () => {
    // ko-kmr collides with ko under bcp47 prefix matching; the store keys on the
    // unique slug, so each round-trips to itself and the two stay distinct.
    expect(parseStoredPreferences('{"audioLanguageSlug":"ko"}')).toEqual({
      audioLanguageSlug: "ko",
      nativePlayerVariant: "existing",
    })
    expect(parseStoredPreferences('{"audioLanguageSlug":"ko-kmr"}')).toEqual({
      audioLanguageSlug: "ko-kmr",
      nativePlayerVariant: "existing",
    })
  })

  it("migrates the legacy native-player toggle to Native A", () => {
    expect(
      parseStoredPreferences(
        '{"audioLanguageSlug":null,"nativeSwiftPlayerEnabled":true}',
      ),
    ).toEqual({
      audioLanguageSlug: null,
      nativePlayerVariant: "native-a",
    })
  })

  it("reads Native A and Native B as separate experiments", () => {
    expect(
      parseStoredPreferences('{"nativePlayerVariant":"native-a"}'),
    ).toEqual({
      audioLanguageSlug: null,
      nativePlayerVariant: "native-a",
    })
    expect(
      parseStoredPreferences('{"nativePlayerVariant":"native-b"}'),
    ).toEqual({
      audioLanguageSlug: null,
      nativePlayerVariant: "native-b",
    })
  })
})

describe("mergeWatchPreferences", () => {
  it("takes the stored value when no local write raced hydration", () => {
    expect(
      mergeWatchPreferences(
        { audioLanguageSlug: "ru", nativePlayerVariant: "existing" },
        {},
      ),
    ).toEqual({
      audioLanguageSlug: "ru",
      nativePlayerVariant: "existing",
    })
  })

  it("lets an explicit null clear win over a stored slug", () => {
    // null is both the default AND a real choice (clear), so only an explicit
    // pending key — never the value — can win over disk.
    expect(
      mergeWatchPreferences(
        { audioLanguageSlug: "ru", nativePlayerVariant: "existing" },
        {
          audioLanguageSlug: null,
        },
      ),
    ).toEqual({
      audioLanguageSlug: null,
      nativePlayerVariant: "existing",
    })
  })

  it("lets a pending slug win over a stored null", () => {
    expect(
      mergeWatchPreferences(
        { audioLanguageSlug: null, nativePlayerVariant: "existing" },
        {
          audioLanguageSlug: "ur",
        },
      ),
    ).toEqual({
      audioLanguageSlug: "ur",
      nativePlayerVariant: "existing",
    })
  })

  it("does not mutate its inputs", () => {
    const onDisk = {
      audioLanguageSlug: "ru",
      nativePlayerVariant: "existing" as const,
    }
    mergeWatchPreferences(onDisk, { audioLanguageSlug: null })
    expect(onDisk).toEqual({
      audioLanguageSlug: "ru",
      nativePlayerVariant: "existing",
    })
  })
})

describe("loadWatchPreferences / saveWatchPreferences", () => {
  it("hydrates defaults from empty storage", async () => {
    await expect(loadWatchPreferences()).resolves.toEqual(
      DEFAULT_WATCH_PREFERENCES,
    )
  })

  it("round-trips a persisted slug", async () => {
    await saveWatchPreferences({
      audioLanguageSlug: "ru",
      nativePlayerVariant: "existing",
    })
    await expect(loadWatchPreferences()).resolves.toEqual({
      audioLanguageSlug: "ru",
      nativePlayerVariant: "existing",
    })
  })

  it("round-trips the selected native player experiment", async () => {
    await saveWatchPreferences({
      audioLanguageSlug: null,
      nativePlayerVariant: "native-b",
    })
    await expect(loadWatchPreferences()).resolves.toEqual({
      audioLanguageSlug: null,
      nativePlayerVariant: "native-b",
    })
  })

  it("round-trips a preference cleared back to null", async () => {
    await saveWatchPreferences({
      audioLanguageSlug: "ru",
      nativePlayerVariant: "existing",
    })
    await saveWatchPreferences({
      audioLanguageSlug: null,
      nativePlayerVariant: "existing",
    })
    await expect(loadWatchPreferences()).resolves.toEqual({
      audioLanguageSlug: null,
      nativePlayerVariant: "existing",
    })
  })

  it("round-trips the exact slug through storage (ko is not ko-kmr)", async () => {
    await saveWatchPreferences({
      audioLanguageSlug: "ko",
      nativePlayerVariant: "existing",
    })
    await expect(loadWatchPreferences()).resolves.toEqual({
      audioLanguageSlug: "ko",
      nativePlayerVariant: "existing",
    })
    await saveWatchPreferences({
      audioLanguageSlug: "ko-kmr",
      nativePlayerVariant: "existing",
    })
    await expect(loadWatchPreferences()).resolves.toEqual({
      audioLanguageSlug: "ko-kmr",
      nativePlayerVariant: "existing",
    })
  })

  it("discards data written under an older key version", async () => {
    await getStorage().setItem(
      "tv.watchPreferences.v0",
      '{"audioLanguageSlug":"ru"}',
    )
    await expect(loadWatchPreferences()).resolves.toEqual(
      DEFAULT_WATCH_PREFERENCES,
    )
  })

  it("hydrates defaults when stored JSON is corrupt", async () => {
    await getStorage().setItem(WATCH_PREFERENCES_STORAGE_KEY, "{{{not json")
    await expect(loadWatchPreferences()).resolves.toEqual(
      DEFAULT_WATCH_PREFERENCES,
    )
  })

  it("never writes while hydrating", async () => {
    await getStorage().setItem(WATCH_PREFERENCES_STORAGE_KEY, "{{{not json")
    await loadWatchPreferences()
    await expect(
      getStorage().getItem(WATCH_PREFERENCES_STORAGE_KEY),
    ).resolves.toBe("{{{not json")
  })

  it("logs and defaults when the storage read throws", async () => {
    jest.spyOn(getStorage(), "getItem").mockRejectedValueOnce(new Error("nope"))
    await expect(loadWatchPreferences()).resolves.toEqual(
      DEFAULT_WATCH_PREFERENCES,
    )
    expect(datadogLog.warn).toHaveBeenCalledWith(
      "watch_prefs.read_failed",
      expect.any(Object),
    )
  })

  it("logs and swallows a failed persist rather than throwing at the caller", async () => {
    jest.spyOn(getStorage(), "setItem").mockRejectedValueOnce(new Error("full"))
    await expect(
      saveWatchPreferences({
        audioLanguageSlug: "ru",
        nativePlayerVariant: "existing",
      }),
    ).resolves.toBeUndefined()
    expect(datadogLog.warn).toHaveBeenCalledWith(
      "watch_prefs.write_failed",
      expect.any(Object),
    )
  })
})
