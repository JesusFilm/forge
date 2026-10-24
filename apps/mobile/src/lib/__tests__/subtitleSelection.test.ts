// The phone's languages reach the resolver through the real locale store.
const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))

import {
  defaultAudioLanguage,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import {
  deriveSubtitleLabel,
  reconcileSeriesSubtitleSlug,
  resolveActiveSubtitle,
  resolveSeriesSubtitleLabel,
  resolveSubtitleActionLabel,
  subtitleLabelText,
  subtitleNameToCache,
  SUBTITLES_OFF,
} from "../subtitleSelection"
import type { WatchSubtitle } from "../normalizeVideo"

function sub(languageSlug: string, languageName: string): WatchSubtitle {
  return {
    documentId: `doc-${languageSlug}`,
    languageSlug,
    languageName,
    languageBcp47: languageSlug,
    vttSrc: `https://example.test/${languageSlug}.vtt`,
    primary: false,
    aiGenerated: false,
  }
}

const SUBS = [sub("english", "English"), sub("french", "French")]

describe("resolveActiveSubtitle", () => {
  it("returns null for a null slug", () => {
    expect(resolveActiveSubtitle(null, SUBS)).toBeNull()
  })

  it("returns null for an undefined slug", () => {
    expect(resolveActiveSubtitle(undefined, SUBS)).toBeNull()
  })

  it("returns null when the slug has no matching track", () => {
    expect(resolveActiveSubtitle("german", SUBS)).toBeNull()
  })

  it("returns null when the track list is empty (lazy media not loaded)", () => {
    expect(resolveActiveSubtitle("english", [])).toBeNull()
  })

  it("returns the matching subtitle, keyed on languageSlug", () => {
    expect(resolveActiveSubtitle("french", SUBS)?.languageName).toBe("French")
  })
})

describe("deriveSubtitleLabel", () => {
  it("returns the off state when subtitles are disabled, regardless of the slug", () => {
    expect(deriveSubtitleLabel(false, "french", SUBS)).toBe(SUBTITLES_OFF)
    expect(deriveSubtitleLabel(false, null, SUBS)).toBe(SUBTITLES_OFF)
  })

  it("returns null when enabled but no slug is selected", () => {
    expect(deriveSubtitleLabel(true, null, SUBS)).toBeNull()
  })

  it("returns null when enabled but the slug isn't in this dub's media", () => {
    // Cross-dub slug or lazy media not yet landed — caller shows a static label.
    expect(deriveSubtitleLabel(true, "german", SUBS)).toBeNull()
  })

  it("returns the language name when enabled and the slug matches", () => {
    expect(deriveSubtitleLabel(true, "english", SUBS)).toBe("English")
  })

  it("returns null when enabled with an undefined slug (delegated path)", () => {
    expect(deriveSubtitleLabel(true, undefined, SUBS)).toBeNull()
  })
})

describe("resolveSubtitleActionLabel", () => {
  it("returns the off state when disabled, ignoring the fallback name", () => {
    expect(resolveSubtitleActionLabel(false, "english", SUBS, "French")).toBe(
      SUBTITLES_OFF,
    )
  })

  it("returns the resolved name when enabled and the slug matches", () => {
    expect(resolveSubtitleActionLabel(true, "english", SUBS, "French")).toBe(
      "English",
    )
  })

  it("returns the off state when the dub is loaded with no subtitle tracks", () => {
    // The reported bug: a loaded-empty dub ([]) must say "Off", not a stale name.
    expect(resolveSubtitleActionLabel(true, "arabic", [], "Arabic")).toBe(
      SUBTITLES_OFF,
    )
    expect(resolveSubtitleActionLabel(true, null, [], "French")).toBe(
      SUBTITLES_OFF,
    )
  })

  it("paints the cached name while the dub media is still loading (null)", () => {
    // null = not loaded yet → optimistic paint; distinct from [] = loaded-empty.
    expect(resolveSubtitleActionLabel(true, null, null, "French")).toBe(
      "French",
    )
    // Loaded with tracks but the slug isn't among them → cached name during the
    // gap before the pre-select effect reconciles to a supported track.
    expect(resolveSubtitleActionLabel(true, "german", SUBS, "French")).toBe(
      "French",
    )
  })

  it("returns null when enabled, not loaded, and there is no cached name", () => {
    expect(resolveSubtitleActionLabel(true, null, null, null)).toBeNull()
  })
})

// KTD15: logic returns the off state as a sentinel, never the word "Off";
// only the render turns it into catalog text.
describe("the off state", () => {
  it("is not a string, so no caller can show it untranslated", () => {
    expect(typeof SUBTITLES_OFF).not.toBe("string")
  })

  it("becomes the text the render passes in", () => {
    expect(subtitleLabelText(SUBTITLES_OFF, "Выкл.")).toBe("Выкл.")
    expect(subtitleLabelText("English", "Выкл.")).toBe("English")
    expect(subtitleLabelText(null, "Выкл.")).toBeNull()
  })
})

describe("reconcileSeriesSubtitleSlug", () => {
  it("returns null when disabled or the series has no subtitles", () => {
    expect(reconcileSeriesSubtitleSlug(false, "english", SUBS, null)).toBeNull()
    expect(reconcileSeriesSubtitleSlug(true, "english", [], null)).toBeNull()
  })

  it("keeps the preferred slug when the series offers it", () => {
    expect(reconcileSeriesSubtitleSlug(true, "french", SUBS, null)).toBe(
      "french",
    )
  })

  it("falls back to a supported track when the preference is unavailable", () => {
    // Cantonese isn't in the series → must resolve to a track it actually has,
    // never the unsupported preference (the reported bug).
    const slug = reconcileSeriesSubtitleSlug(true, "cantonese", SUBS, null)
    expect(slug).not.toBe("cantonese")
    expect(["english", "french"]).toContain(slug)
  })
})

// R22, KD11: with no pick, the default subtitle follows the same phone
// language as the default audio.
describe("the default subtitle language", () => {
  afterEach(() => resetLocaleStoreForTests())

  function setPhone(...tags: string[]) {
    resetLocaleStoreForTests()
    mockGetLocales.mockReturnValue(tags.flatMap((tag) => phoneLocales(tag)))
    startLocaleSync()
  }

  function track(languageSlug: string, languageBcp47: string): WatchSubtitle {
    return { ...sub(languageSlug, languageSlug), languageBcp47 }
  }

  it("follows the phone's first language, the same as the default audio, not the UI fallback", () => {
    setPhone("ha-NG", "en-US")
    const union = [track("english", "en"), track("hausa", "ha")]
    expect(reconcileSeriesSubtitleSlug(true, null, union, "en")).toBe("hausa")
    expect(defaultAudioLanguage()?.slug).toBe("hausa")
  })

  it("picks Traditional Chinese for a zh-Hant-TW phone, whatever the order", () => {
    setPhone("zh-Hant-TW")
    const union = [
      track("chinese-simplified", "zh-hans"),
      track("chinese-traditional", "zh-hant"),
    ]
    expect(reconcileSeriesSubtitleSlug(true, null, union, null)).toBe(
      "chinese-traditional",
    )
  })

  it("uses the primary language when the phone list is empty", () => {
    setPhone()
    const union = [track("english", "en"), track("french", "fr")]
    expect(reconcileSeriesSubtitleSlug(true, null, union, "fr")).toBe("french")
  })
})

describe("resolveSeriesSubtitleLabel", () => {
  it("paints the cached name optimistically before the union resolves", () => {
    expect(
      resolveSeriesSubtitleLabel(true, "cantonese", "Cantonese", null, null),
    ).toBe("Cantonese")
  })

  it("returns the off state when subtitles are disabled", () => {
    expect(
      resolveSeriesSubtitleLabel(false, "english", "English", SUBS, null),
    ).toBe(SUBTITLES_OFF)
    expect(
      resolveSeriesSubtitleLabel(false, "english", "English", null, null),
    ).toBe(SUBTITLES_OFF)
  })

  it("shows the preferred name when the resolved union offers it", () => {
    expect(
      resolveSeriesSubtitleLabel(true, "french", "French", SUBS, null),
    ).toBe("French")
  })

  it("falls back to a supported track, never the unsupported cached name", () => {
    // The fix: a Cantonese pref on an English/French series must NOT paint
    // "Cantonese" once we know the series doesn't carry it.
    const label = resolveSeriesSubtitleLabel(
      true,
      "cantonese",
      "Cantonese",
      SUBS,
      null,
    )
    expect(label).not.toBe("Cantonese")
    expect(["English", "French"]).toContain(label)
  })

  it("shows the off state when the resolved series has no subtitles", () => {
    // Empty union → the series has no subtitles: "Off", not the stale cached name.
    expect(
      resolveSeriesSubtitleLabel(true, "cantonese", "Cantonese", [], null),
    ).toBe(SUBTITLES_OFF)
  })
})

describe("subtitleNameToCache", () => {
  it("returns null when the slug isn't present in the loaded media", () => {
    expect(subtitleNameToCache("german", SUBS, null)).toBeNull()
    expect(subtitleNameToCache("english", [], null)).toBeNull()
    expect(subtitleNameToCache(null, SUBS, null)).toBeNull()
  })

  it("returns null (no-op) when the resolved name already matches the cache", () => {
    expect(subtitleNameToCache("english", SUBS, "English")).toBeNull()
  })

  it("returns the new name when it differs from the cache", () => {
    expect(subtitleNameToCache("english", SUBS, null)).toBe("English")
    expect(subtitleNameToCache("french", SUBS, "English")).toBe("French")
  })
})
