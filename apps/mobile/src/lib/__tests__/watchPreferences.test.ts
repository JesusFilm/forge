import {
  DEFAULT_WATCH_PREFERENCES,
  parseStoredPreferences,
  serializeWatchPreferences,
  type WatchPreferences,
} from "../watchPreferences"

describe("parseStoredPreferences", () => {
  it("returns defaults for a null (never-written) blob", () => {
    expect(parseStoredPreferences(null)).toEqual(DEFAULT_WATCH_PREFERENCES)
  })

  it("returns defaults for malformed JSON instead of throwing", () => {
    expect(parseStoredPreferences("{not json")).toEqual(
      DEFAULT_WATCH_PREFERENCES,
    )
  })

  it("returns defaults for valid JSON that isn't an object", () => {
    expect(parseStoredPreferences("42")).toEqual(DEFAULT_WATCH_PREFERENCES)
    expect(parseStoredPreferences("null")).toEqual(DEFAULT_WATCH_PREFERENCES)
    expect(parseStoredPreferences('"es"')).toEqual(DEFAULT_WATCH_PREFERENCES)
  })

  it("reads a fully-populated blob", () => {
    const raw = JSON.stringify({
      audioLanguageSlug: "spanish",
      subtitleLanguageSlug: "english",
      subtitleLanguageName: "English",
      subtitlesEnabled: true,
      wifiOnly: true,
    })
    expect(parseStoredPreferences(raw)).toEqual({
      audioLanguageSlug: "spanish",
      subtitleLanguageSlug: "english",
      subtitleLanguageName: "English",
      subtitlesEnabled: true,
      wifiOnly: true,
    })
  })

  it("fills missing fields from defaults (forward/backward compatible)", () => {
    expect(
      parseStoredPreferences(JSON.stringify({ audioLanguageSlug: "french" })),
    ).toEqual({
      audioLanguageSlug: "french",
      subtitleLanguageSlug: null,
      subtitleLanguageName: null,
      subtitlesEnabled: false,
      wifiOnly: false,
    })
  })

  it("reads an older bcp47-shaped blob back as defaults (migration)", () => {
    // Pre-fix blobs used audioBcp47/subtitleBcp47. Those field names no longer
    // exist, so a stale blob degrades to defaults and the user re-picks once.
    const legacy = JSON.stringify({
      audioBcp47: "fr",
      subtitleBcp47: "cs",
      subtitlesEnabled: true,
    })
    expect(parseStoredPreferences(legacy)).toEqual({
      audioLanguageSlug: null,
      subtitleLanguageSlug: null,
      subtitleLanguageName: null,
      subtitlesEnabled: true,
      wifiOnly: false,
    })
  })

  it("preserves the cached subtitle display name, dropping an empty one", () => {
    expect(
      parseStoredPreferences(
        JSON.stringify({ subtitleLanguageName: "Arabic, Modern Standard" }),
      ).subtitleLanguageName,
    ).toBe("Arabic, Modern Standard")
    expect(
      parseStoredPreferences(JSON.stringify({ subtitleLanguageName: "" }))
        .subtitleLanguageName,
    ).toBeNull()
  })

  it("coerces wrong-typed fields to safe values", () => {
    const raw = JSON.stringify({
      audioLanguageSlug: 123,
      subtitleLanguageSlug: "",
      subtitleLanguageName: 42,
      subtitlesEnabled: "yes",
    })
    // numeric/empty languages + numeric display name → null; non-boolean enabled
    // → false (only strict `true` enables, so a truthy string never silently
    // turns subs on).
    expect(parseStoredPreferences(raw)).toEqual(DEFAULT_WATCH_PREFERENCES)
  })

  it("round-trips through serialize → parse", () => {
    const prefs: WatchPreferences = {
      audioLanguageSlug: "portuguese",
      subtitleLanguageSlug: "spanish",
      subtitleLanguageName: "Spanish",
      subtitlesEnabled: true,
      wifiOnly: true,
    }
    expect(parseStoredPreferences(serializeWatchPreferences(prefs))).toEqual(
      prefs,
    )
  })
})

describe("parseStoredPreferences — wifiOnly", () => {
  it("defaults wifiOnly to false", () => {
    expect(DEFAULT_WATCH_PREFERENCES.wifiOnly).toBe(false)
    expect(parseStoredPreferences(null).wifiOnly).toBe(false)
    expect(parseStoredPreferences("{}").wifiOnly).toBe(false)
  })

  it("reads wifiOnly true only for a strict boolean true", () => {
    expect(
      parseStoredPreferences(JSON.stringify({ wifiOnly: true })).wifiOnly,
    ).toBe(true)
    expect(
      parseStoredPreferences(JSON.stringify({ wifiOnly: "yes" })).wifiOnly,
    ).toBe(false)
    expect(
      parseStoredPreferences(JSON.stringify({ wifiOnly: 1 })).wifiOnly,
    ).toBe(false)
  })

  it("keeps wifiOnly default when other fields are present (partial blob)", () => {
    const out = parseStoredPreferences(
      JSON.stringify({ audioLanguageSlug: "korean" }),
    )
    expect(out.audioLanguageSlug).toBe("korean")
    expect(out.wifiOnly).toBe(false)
  })
})
