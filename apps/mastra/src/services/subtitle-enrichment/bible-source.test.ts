import { describe, expect, it, vi } from "vitest"

import {
  loadConfiguredBiblePassage,
  normalizeApiBibleReference,
  _internals,
} from "./bible-source"

describe("Bible source adapter", () => {
  it("normalizes supported references to API.Bible passage ids", () => {
    expect(normalizeApiBibleReference("Luke 2")).toBe("LUK.2")
    expect(normalizeApiBibleReference("Luke 1-2")).toBe("LUK.1-LUK.2")
    expect(normalizeApiBibleReference("Luke 1:26-2:20")).toBe(
      "LUK.1.26-LUK.2.20",
    )
    expect(normalizeApiBibleReference("John 3:16")).toBe("JHN.3.16")
    expect(normalizeApiBibleReference("1 Corinthians 13:4-7")).toBe(
      "1CO.13.4-1CO.13.7",
    )
  })

  it("returns undefined for unsupported reference shapes", () => {
    expect(normalizeApiBibleReference("Birth of Jesus")).toBeUndefined()
    expect(normalizeApiBibleReference("Luke")).toBeUndefined()
  })

  it("builds API.Bible URLs without leaking config into callers", () => {
    expect(
      _internals
        .apiBibleUrl("https://api.example.test/v1/", "bible-1", "LUK.2")
        ?.toString(),
    ).toBe(
      "https://api.example.test/v1/bibles/bible-1/passages/LUK.2?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=false",
    )
  })

  it("falls back when provider config is absent", async () => {
    await expect(
      loadConfiguredBiblePassage({
        targetLanguage: "es",
        references: ["Luke 2"],
        timeoutMs: 30_000,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "provider_config_missing",
    })
  })

  it("loads every configured reference before using target Bible text", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input))
      return Response.json({
        data: {
          reference: url.pathname.endsWith("LUK.2") ? "Luke 2" : "Matthew 2",
          content: url.pathname.endsWith("LUK.2")
            ? "Mary gave birth to her firstborn son."
            : "Wise men came from the east.",
          copyright: "Public domain test text.",
        },
      })
    })

    await expect(
      loadConfiguredBiblePassage({
        targetLanguage: "en-US",
        references: ["Luke 2", "Matthew 2"],
        timeoutMs: 30_000,
        fetchImpl,
        config: {
          SUBTITLE_VALIDATION_BIBLE_PROVIDER: "api_bible",
          SUBTITLE_VALIDATION_BIBLE_MAP_JSON: JSON.stringify({
            en: "bible-1",
          }),
          API_BIBLE_API_KEY: "api-key",
          API_BIBLE_BASE_URL: "https://api.example.test/v1",
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      passage: {
        referenceCount: 2,
        provider: {
          bibleId: "bible-1",
          reference: "Luke 2, Matthew 2",
        },
        text: expect.stringContaining("[Luke 2]"),
      },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("LUK.2")
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("MAT.2")
  })

  it("falls back when optional provider configuration is invalid", async () => {
    await expect(
      loadConfiguredBiblePassage({
        targetLanguage: "en",
        references: ["Luke 2"],
        timeoutMs: 30_000,
        config: {
          SUBTITLE_VALIDATION_BIBLE_PROVIDER: "typo",
          SUBTITLE_VALIDATION_BIBLE_MAP_JSON: JSON.stringify({
            en: "bible-1",
          }),
          API_BIBLE_API_KEY: "api-key",
          API_BIBLE_BASE_URL: "not a url",
        },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "provider_config_missing",
    })
  })

  it("does not send API keys to non-allowlisted production Bible URLs", async () => {
    const fetchImpl = vi.fn()

    await expect(
      loadConfiguredBiblePassage({
        targetLanguage: "en",
        references: ["Luke 2"],
        timeoutMs: 30_000,
        fetchImpl,
        config: {
          NODE_ENV: "production",
          SUBTITLE_VALIDATION_BIBLE_PROVIDER: "api_bible",
          SUBTITLE_VALIDATION_BIBLE_MAP_JSON: JSON.stringify({
            en: "bible-1",
          }),
          API_BIBLE_API_KEY: "api-key",
          API_BIBLE_BASE_URL: "http://api.scripture.api.bible/v1",
          API_BIBLE_ALLOWED_HOSTS: "api.scripture.api.bible",
        },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "provider_config_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("does not use partial target Bible text when one reference is unsupported", async () => {
    const fetchImpl = vi.fn()

    await expect(
      loadConfiguredBiblePassage({
        targetLanguage: "en",
        references: ["Luke 2", "Birth of Jesus"],
        timeoutMs: 30_000,
        fetchImpl,
        config: {
          SUBTITLE_VALIDATION_BIBLE_PROVIDER: "api_bible",
          SUBTITLE_VALIDATION_BIBLE_MAP_JSON: JSON.stringify({
            en: "bible-1",
          }),
          API_BIBLE_API_KEY: "api-key",
          API_BIBLE_BASE_URL: "https://api.example.test/v1",
        },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "reference_unsupported",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("maps provider status failures to fallback reasons", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }))

    await expect(
      loadConfiguredBiblePassage({
        targetLanguage: "en",
        references: ["Luke 2"],
        timeoutMs: 30_000,
        fetchImpl,
        config: {
          SUBTITLE_VALIDATION_BIBLE_PROVIDER: "api_bible",
          SUBTITLE_VALIDATION_BIBLE_MAP_JSON: JSON.stringify({
            en: "bible-1",
          }),
          API_BIBLE_API_KEY: "api-key",
          API_BIBLE_BASE_URL: "https://api.example.test/v1",
        },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "provider_rate_limited",
    })
  })
})
