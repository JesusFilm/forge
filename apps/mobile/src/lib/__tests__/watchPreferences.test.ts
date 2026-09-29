// `es` is a fixture catalog, so a case can run the store on a Spanish UI.
const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(jest.requireActual("../../i18n/catalogs.generated"), {
      es: {},
    }),
)
jest.mock("../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../i18n/pluralData.generated"),
      ["es"],
    ),
)

import {
  getCatalogTag,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import {
  audioIso3BackfillPatch,
  audioLanguagePatch,
  cachedSubtitleName,
  DEFAULT_WATCH_PREFERENCES,
  languageIso3ForSlug,
  parseStoredPreferences,
  serializeWatchPreferences,
  subtitleNamePatch,
  type WatchPreferences,
} from "../watchPreferences"

// KTD16: the cached subtitle name is display text in one UI language.
describe("the stored subtitle name and its locale", () => {
  const stored = (fields: Record<string, unknown>) => JSON.stringify(fields)

  afterEach(() => resetLocaleStoreForTests())

  it("does not paint a name from en when the UI tag is es", () => {
    const raw = stored({
      subtitleLanguageSlug: "french",
      subtitleLanguageName: "French",
      subtitleLanguageNameLocale: "en",
    })
    expect(parseStoredPreferences(raw, "es")).toMatchObject({
      subtitleLanguageSlug: "french",
      subtitleLanguageName: null,
      subtitleLanguageNameLocale: null,
    })
    expect(parseStoredPreferences(raw, "en")).toMatchObject({
      subtitleLanguageName: "French",
      subtitleLanguageNameLocale: "en",
    })
  })

  it("reads the UI tag from the store by default", () => {
    mockGetLocales.mockReturnValue(phoneLocales("es-MX"))
    startLocaleSync()
    expect(getCatalogTag()).toBe("es")
    const raw = stored({
      subtitleLanguageName: "French",
      subtitleLanguageNameLocale: "en",
    })
    expect(parseStoredPreferences(raw).subtitleLanguageName).toBeNull()
  })

  it("reads a name stored before the locale existed as English", () => {
    // The app showed Admin's English names before it had any UI catalog.
    const legacy = stored({ subtitleLanguageName: "French" })
    expect(parseStoredPreferences(legacy, "en")).toMatchObject({
      subtitleLanguageName: "French",
      subtitleLanguageNameLocale: "en",
    })
    expect(parseStoredPreferences(legacy, "es").subtitleLanguageName).toBeNull()
  })

  it.each([null, "", 42])(
    "drops a name whose stored locale is %j",
    (subtitleLanguageNameLocale) => {
      const raw = stored({
        subtitleLanguageName: "French",
        subtitleLanguageNameLocale,
      })
      expect(parseStoredPreferences(raw, "en")).toMatchObject({
        subtitleLanguageName: null,
        subtitleLanguageNameLocale: null,
      })
    },
  )

  it("writes a new name with the UI tag it was read in", () => {
    expect(subtitleNamePatch("Francés", "es")).toEqual({
      subtitleLanguageName: "Francés",
      subtitleLanguageNameLocale: "es",
    })
    expect(subtitleNamePatch(null, "es")).toEqual({
      subtitleLanguageName: null,
      subtitleLanguageNameLocale: null,
    })
  })

  it("stamps a name that has no locale when it is saved", () => {
    const prefs: WatchPreferences = {
      ...DEFAULT_WATCH_PREFERENCES,
      subtitleLanguageName: "Francés",
    }
    const raw = serializeWatchPreferences(prefs, "es")
    expect(JSON.parse(raw).subtitleLanguageNameLocale).toBe("es")
    expect(parseStoredPreferences(raw, "es").subtitleLanguageName).toBe(
      "Francés",
    )
  })

  it("keeps the locale a name already has when it is saved", () => {
    const prefs: WatchPreferences = {
      ...DEFAULT_WATCH_PREFERENCES,
      ...subtitleNamePatch("French", "en"),
    }
    // A later save under another UI tag must not relabel the old name.
    const raw = serializeWatchPreferences(prefs, "es")
    expect(parseStoredPreferences(raw, "es").subtitleLanguageName).toBeNull()
  })
})

// KTD16: a screen reads the name in the tag it captured, not the live UI tag.
describe("cachedSubtitleName", () => {
  // Cached in English; the live UI tag is Spanish after a live change.
  const englishName = subtitleNamePatch("French", "en")

  afterEach(() => resetLocaleStoreForTests())

  it("gives the name to a screen that captured the name's tag", () => {
    mockGetLocales.mockReturnValue(phoneLocales("es-MX"))
    startLocaleSync()
    expect(getCatalogTag()).toBe("es")

    expect(cachedSubtitleName(englishName, "en")).toBe("French")
  })

  it("hides the name from a screen that captured another tag", () => {
    expect(cachedSubtitleName(englishName, "es")).toBeNull()
  })

  it("hides the name while the screen has no captured tag", () => {
    expect(cachedSubtitleName(englishName, undefined)).toBeNull()
  })
})

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
      audioLanguageIso3: "spa",
      subtitleLanguageSlug: "english",
      subtitleLanguageName: "English",
      subtitlesEnabled: true,
      wifiOnly: true,
    })
    expect(parseStoredPreferences(raw)).toEqual({
      audioLanguageSlug: "spanish",
      audioLanguageIso3: "spa",
      subtitleLanguageSlug: "english",
      subtitleLanguageName: "English",
      subtitleLanguageNameLocale: "en",
      subtitlesEnabled: true,
      wifiOnly: true,
      longPressHintSeen: false,
      exploreMuted: false,
    })
  })

  it("fills missing fields from defaults (forward/backward compatible)", () => {
    expect(
      parseStoredPreferences(JSON.stringify({ audioLanguageSlug: "french" })),
    ).toEqual({
      audioLanguageSlug: "french",
      audioLanguageIso3: null,
      subtitleLanguageSlug: null,
      subtitleLanguageName: null,
      subtitleLanguageNameLocale: null,
      subtitlesEnabled: false,
      wifiOnly: false,
      longPressHintSeen: false,
      exploreMuted: false,
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
      audioLanguageIso3: null,
      subtitleLanguageSlug: null,
      subtitleLanguageName: null,
      subtitleLanguageNameLocale: null,
      subtitlesEnabled: true,
      wifiOnly: false,
      longPressHintSeen: false,
      exploreMuted: false,
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
      audioLanguageIso3: "por",
      subtitleLanguageSlug: "spanish",
      subtitleLanguageName: "Spanish",
      subtitleLanguageNameLocale: "en",
      subtitlesEnabled: true,
      wifiOnly: true,
      longPressHintSeen: true,
      exploreMuted: true,
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

describe("parseStoredPreferences — longPressHintSeen", () => {
  it("defaults longPressHintSeen to false", () => {
    expect(DEFAULT_WATCH_PREFERENCES.longPressHintSeen).toBe(false)
    expect(parseStoredPreferences(null).longPressHintSeen).toBe(false)
    expect(parseStoredPreferences("{}").longPressHintSeen).toBe(false)
  })

  it("reads longPressHintSeen true only for a strict boolean true", () => {
    expect(
      parseStoredPreferences(JSON.stringify({ longPressHintSeen: true }))
        .longPressHintSeen,
    ).toBe(true)
    expect(
      parseStoredPreferences(JSON.stringify({ longPressHintSeen: "yes" }))
        .longPressHintSeen,
    ).toBe(false)
    expect(
      parseStoredPreferences(JSON.stringify({ longPressHintSeen: 1 }))
        .longPressHintSeen,
    ).toBe(false)
  })

  it("keeps longPressHintSeen default when other fields are present (partial blob)", () => {
    const out = parseStoredPreferences(
      JSON.stringify({ audioLanguageSlug: "korean" }),
    )
    expect(out.audioLanguageSlug).toBe("korean")
    expect(out.longPressHintSeen).toBe(false)
  })
})

describe("parseStoredPreferences — exploreMuted", () => {
  it("defaults to unmuted, so Explore clips start with sound (R11)", () => {
    expect(DEFAULT_WATCH_PREFERENCES.exploreMuted).toBe(false)
    expect(parseStoredPreferences(null).exploreMuted).toBe(false)
  })

  it("reads a stored blob written before the field existed as unmuted", () => {
    const beforeTheField = JSON.stringify({
      audioLanguageSlug: "swahili",
      subtitlesEnabled: true,
      wifiOnly: true,
      longPressHintSeen: true,
    })
    const out = parseStoredPreferences(beforeTheField)
    expect(out.exploreMuted).toBe(false)
    expect(out.audioLanguageSlug).toBe("swahili")
  })

  it("reads exploreMuted true only for a strict boolean true", () => {
    expect(
      parseStoredPreferences(JSON.stringify({ exploreMuted: true }))
        .exploreMuted,
    ).toBe(true)
    expect(
      parseStoredPreferences(JSON.stringify({ exploreMuted: "true" }))
        .exploreMuted,
    ).toBe(false)
    expect(
      parseStoredPreferences(JSON.stringify({ exploreMuted: 1 })).exploreMuted,
    ).toBe(false)
  })

  it("round-trips a muted choice through serialize → parse", () => {
    const muted: WatchPreferences = {
      ...DEFAULT_WATCH_PREFERENCES,
      exploreMuted: true,
    }
    const raw = serializeWatchPreferences(muted)
    expect(JSON.parse(raw)).toMatchObject({ exploreMuted: true })
    expect(parseStoredPreferences(raw)).toEqual(muted)
  })

  it("still drops unknown fields beside the mute field", () => {
    const raw = JSON.stringify({
      exploreMuted: true,
      exploreVolume: 0.4,
      muted: true,
    })
    const out = parseStoredPreferences(raw)
    expect(out).toEqual({ ...DEFAULT_WATCH_PREFERENCES, exploreMuted: true })
    expect(Object.keys(out).sort()).toEqual(
      Object.keys(DEFAULT_WATCH_PREFERENCES).sort(),
    )
  })
})

describe("parseStoredPreferences — audioLanguageIso3", () => {
  it("defaults the audio language code to unknown", () => {
    expect(DEFAULT_WATCH_PREFERENCES.audioLanguageIso3).toBeNull()
    expect(parseStoredPreferences(null).audioLanguageIso3).toBeNull()
    expect(parseStoredPreferences("{}").audioLanguageIso3).toBeNull()
  })

  it("reads a record from before the code existed with the code unknown", () => {
    const out = parseStoredPreferences(
      JSON.stringify({ audioLanguageSlug: "spanish", subtitlesEnabled: true }),
    )
    expect(out.audioLanguageSlug).toBe("spanish")
    expect(out.audioLanguageIso3).toBeNull()
    expect(out.subtitlesEnabled).toBe(true)
  })

  it("keeps a stored code exactly as admin sent it, macrolanguages included", () => {
    for (const code of ["spa", "zho", "ara"]) {
      expect(
        parseStoredPreferences(
          JSON.stringify({ audioLanguageSlug: "x", audioLanguageIso3: code }),
        ).audioLanguageIso3,
      ).toBe(code)
    }
  })

  it("reads a blank or non-string code as unknown", () => {
    for (const code of ["", "   ", 42, true, null, { iso3: "spa" }]) {
      expect(
        parseStoredPreferences(
          JSON.stringify({
            audioLanguageSlug: "spanish",
            audioLanguageIso3: code,
          }),
        ).audioLanguageIso3,
      ).toBeNull()
    }
  })

  it("drops a code that has no slug to describe", () => {
    expect(
      parseStoredPreferences(JSON.stringify({ audioLanguageIso3: "spa" }))
        .audioLanguageIso3,
    ).toBeNull()
    expect(
      parseStoredPreferences(
        JSON.stringify({ audioLanguageSlug: "", audioLanguageIso3: "spa" }),
      ).audioLanguageIso3,
    ).toBeNull()
  })
})

describe("audioLanguagePatch (an audio language pick)", () => {
  const SPANISH = { audioLanguageSlug: "spanish", audioLanguageIso3: "spa" }

  it("stores the picked dub's code with its slug", () => {
    expect(
      audioLanguagePatch(DEFAULT_WATCH_PREFERENCES, "spanish", "spa"),
    ).toEqual(SPANISH)
  })

  it("clears the previous code when the new language carries none", () => {
    expect(audioLanguagePatch(SPANISH, "thai", null)).toEqual({
      audioLanguageSlug: "thai",
      audioLanguageIso3: null,
    })
  })

  it("replaces the previous code with the new language's code", () => {
    expect(audioLanguagePatch(SPANISH, "french", "fra")).toEqual({
      audioLanguageSlug: "french",
      audioLanguageIso3: "fra",
    })
  })

  it("keeps the stored code when the viewer picks the same language without one", () => {
    // The series sheet has no code to send. A slug is one admin Language, so
    // the stored code still describes it.
    expect(audioLanguagePatch(SPANISH, "spanish", null)).toEqual(SPANISH)
  })

  it("reads a blank code as none", () => {
    expect(audioLanguagePatch(SPANISH, "thai", "  ")).toEqual({
      audioLanguageSlug: "thai",
      audioLanguageIso3: null,
    })
  })

  it("clears both when the slug is cleared", () => {
    expect(audioLanguagePatch(SPANISH, null, "spa")).toEqual({
      audioLanguageSlug: null,
      audioLanguageIso3: null,
    })
  })
})

describe("audioIso3BackfillPatch (a stored slug without a code)", () => {
  const OLD_RECORD = { audioLanguageSlug: "spanish", audioLanguageIso3: null }

  it("fills the missing code for the stored slug", () => {
    expect(audioIso3BackfillPatch(OLD_RECORD, "spanish", "spa")).toEqual({
      audioLanguageIso3: "spa",
    })
  })

  it("writes nothing when the stored slug has changed since", () => {
    expect(audioIso3BackfillPatch(OLD_RECORD, "french", "fra")).toBeNull()
  })

  it("writes nothing when a code is already stored", () => {
    expect(
      audioIso3BackfillPatch(
        { audioLanguageSlug: "spanish", audioLanguageIso3: "spa" },
        "spanish",
        "xyz",
      ),
    ).toBeNull()
  })

  it("writes nothing for a blank code", () => {
    expect(audioIso3BackfillPatch(OLD_RECORD, "spanish", "")).toBeNull()
    expect(audioIso3BackfillPatch(OLD_RECORD, "spanish", null)).toBeNull()
  })
})

describe("languageIso3ForSlug", () => {
  const dub = (languageSlug: string | null, languageIso3: string | null) => ({
    languageSlug,
    languageIso3,
  })

  it("returns the code of the dub in that language", () => {
    expect(
      languageIso3ForSlug(
        [dub("thai", "tha"), dub("spanish", "spa")],
        "spanish",
      ),
    ).toBe("spa")
  })

  it("skips a matching dub without a code and takes one that carries it", () => {
    expect(
      languageIso3ForSlug(
        [dub("spanish", null), dub("spanish", " "), dub("spanish", "spa")],
        "spanish",
      ),
    ).toBe("spa")
  })

  it("returns null when no dub in that language carries a code", () => {
    expect(languageIso3ForSlug([dub("spanish", null)], "spanish")).toBeNull()
    expect(languageIso3ForSlug([dub("thai", "tha")], "spanish")).toBeNull()
    expect(languageIso3ForSlug([], "spanish")).toBeNull()
  })
})
