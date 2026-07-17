import {
  deriveSubtitleLabel,
  reconcileSeriesSubtitleSlug,
  resolveActiveSubtitle,
  resolveSeriesSubtitleLabel,
  resolveSubtitleActionLabel,
  subtitleNameToCache,
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
  it("returns 'Off' when subtitles are disabled, regardless of the slug", () => {
    expect(deriveSubtitleLabel(false, "french", SUBS)).toBe("Off")
    expect(deriveSubtitleLabel(false, null, SUBS)).toBe("Off")
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
  it("returns 'Off' when disabled, ignoring the fallback name", () => {
    expect(resolveSubtitleActionLabel(false, "english", SUBS, "French")).toBe(
      "Off",
    )
  })

  it("returns the resolved name when enabled and the slug matches", () => {
    expect(resolveSubtitleActionLabel(true, "english", SUBS, "French")).toBe(
      "English",
    )
  })

  it("returns 'Off' when the dub is loaded with no subtitle tracks", () => {
    // The reported bug: a loaded-empty dub ([]) must say "Off", not a stale name.
    expect(resolveSubtitleActionLabel(true, "arabic", [], "Arabic")).toBe("Off")
    expect(resolveSubtitleActionLabel(true, null, [], "French")).toBe("Off")
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

describe("resolveSeriesSubtitleLabel", () => {
  it("paints the cached name optimistically before the union resolves", () => {
    expect(
      resolveSeriesSubtitleLabel(true, "cantonese", "Cantonese", null, null),
    ).toBe("Cantonese")
  })

  it("returns 'Off' when subtitles are disabled", () => {
    expect(
      resolveSeriesSubtitleLabel(false, "english", "English", SUBS, null),
    ).toBe("Off")
    expect(
      resolveSeriesSubtitleLabel(false, "english", "English", null, null),
    ).toBe("Off")
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

  it("shows 'Off' when the resolved series has no subtitles", () => {
    // Empty union → the series has no subtitles: "Off", not the stale cached name.
    expect(
      resolveSeriesSubtitleLabel(true, "cantonese", "Cantonese", [], null),
    ).toBe("Off")
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
