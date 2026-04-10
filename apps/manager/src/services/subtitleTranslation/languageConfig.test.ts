import { describe, expect, it } from "vitest"
import { loadLanguageConfig } from "./languageConfig"

describe("loadLanguageConfig", () => {
  it("loads an existing language config", async () => {
    await expect(loadLanguageConfig("ja")).resolves.toEqual({
      customPrompt:
        "Use natural, modern Japanese. Avoid overly formal keigo unless the speaker is clearly formal.",
      glossary: {
        "Jesus Film": "ジーザス・フィルム",
        Gospel: "福音",
        salvation: "救い",
      },
    })
  })

  it("returns undefined for a missing language config", async () => {
    await expect(
      loadLanguageConfig("zz-does-not-exist"),
    ).resolves.toBeUndefined()
  })

  it("returns the cached object on repeat calls", async () => {
    const first = await loadLanguageConfig("ja")
    const second = await loadLanguageConfig("ja")

    expect(first).toBe(second)
  })
})
