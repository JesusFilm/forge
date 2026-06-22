import {
  deriveSubtitleLabel,
  resolveActiveSubtitle,
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

  it("falls back to the cached name when enabled but unresolved (cold load)", () => {
    // The whole point of the feature: paint the persisted name during the gap.
    expect(resolveSubtitleActionLabel(true, null, [], "French")).toBe("French")
    expect(resolveSubtitleActionLabel(true, "german", SUBS, "French")).toBe(
      "French",
    )
  })

  it("returns null when enabled, unresolved, and there is no cached name", () => {
    expect(resolveSubtitleActionLabel(true, null, [], null)).toBeNull()
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
