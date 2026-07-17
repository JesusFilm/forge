import {
  DEFAULT_LANGUAGE_PREFS,
  LANGUAGE_PREFS_STORAGE_KEY,
  loadLanguagePrefs,
  mergeLanguagePrefs,
  parseStoredLanguagePrefs,
  saveLanguagePrefs,
} from "./languagePrefs"
import { _resetStorageForTests, getStorage } from "./safeStorage"

describe("parseStoredLanguagePrefs", () => {
  it("defaults on absent value", () => {
    expect(parseStoredLanguagePrefs(null)).toEqual(DEFAULT_LANGUAGE_PREFS)
  })

  it("defaults on corrupt JSON", () => {
    expect(parseStoredLanguagePrefs("{not json")).toEqual(
      DEFAULT_LANGUAGE_PREFS,
    )
  })

  it("defaults on non-record roots", () => {
    expect(parseStoredLanguagePrefs("[]")).toEqual(DEFAULT_LANGUAGE_PREFS)
    expect(parseStoredLanguagePrefs('"korean"')).toEqual(DEFAULT_LANGUAGE_PREFS)
  })

  it("parses both prefs", () => {
    expect(
      parseStoredLanguagePrefs(
        JSON.stringify({
          audio: { slug: "korean", name: "Korean" },
          subtitle: { slug: "french", name: "French" },
        }),
      ),
    ).toEqual({
      audio: { slug: "korean", name: "Korean" },
      subtitle: { slug: "french", name: "French" },
    })
  })

  it("parses each field independently — a bad one drops without killing the other", () => {
    expect(
      parseStoredLanguagePrefs(
        JSON.stringify({
          audio: { slug: "", name: "Blank" },
          subtitle: { slug: "korean", name: "Korean" },
        }),
      ),
    ).toEqual({ audio: null, subtitle: { slug: "korean", name: "Korean" } })
  })

  it("normalizes a missing or blank name to null", () => {
    expect(
      parseStoredLanguagePrefs(
        JSON.stringify({ audio: { slug: "korean" }, subtitle: null }),
      ),
    ).toEqual({ audio: { slug: "korean", name: null }, subtitle: null })
    expect(
      parseStoredLanguagePrefs(
        JSON.stringify({ audio: { slug: "korean", name: "" } }),
      ).audio,
    ).toEqual({ slug: "korean", name: null })
  })

  it("rejects a non-string slug", () => {
    expect(
      parseStoredLanguagePrefs(JSON.stringify({ audio: { slug: 42 } })).audio,
    ).toBeNull()
  })

  it("drops unknown fields from a newer writer", () => {
    expect(
      parseStoredLanguagePrefs(
        JSON.stringify({
          audio: { slug: "korean", name: "Korean", future: true },
          futureField: 1,
        }),
      ),
    ).toEqual({ audio: { slug: "korean", name: "Korean" }, subtitle: null })
  })
})

describe("mergeLanguagePrefs", () => {
  const onDisk = {
    audio: { slug: "korean", name: "Korean" },
    subtitle: null,
  }

  it("pending wins where the user chose — including choosing null", () => {
    expect(mergeLanguagePrefs(onDisk, { audio: null })).toEqual({
      audio: null,
      subtitle: null,
    })
  })

  it("keeps on-disk values with no pending choice", () => {
    expect(mergeLanguagePrefs(onDisk, {})).toEqual(onDisk)
  })
})

describe("load/save round trip", () => {
  beforeEach(() => {
    _resetStorageForTests()
  })

  it("round-trips prefs through storage", async () => {
    await saveLanguagePrefs({
      audio: { slug: "spanish-latin-american", name: "Spanish" },
      subtitle: { slug: "korean", name: "Korean" },
    })
    await expect(loadLanguagePrefs()).resolves.toEqual({
      audio: { slug: "spanish-latin-american", name: "Spanish" },
      subtitle: { slug: "korean", name: "Korean" },
    })
  })

  it("defaults when nothing is stored", async () => {
    await expect(loadLanguagePrefs()).resolves.toEqual(DEFAULT_LANGUAGE_PREFS)
  })

  it("defaults when the stored value is corrupt", async () => {
    await getStorage().setItem(LANGUAGE_PREFS_STORAGE_KEY, "{corrupt")
    await expect(loadLanguagePrefs()).resolves.toEqual(DEFAULT_LANGUAGE_PREFS)
  })
})
