/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  LANGUAGE_PREFERENCE_COOKIE,
  writePreferredLanguageSlug,
} from "./language-preference-client"
import { shouldRedirectForPreference } from "./language-preference-server"

describe("writePreferredLanguageSlug", () => {
  beforeEach(() => {
    document.cookie
      .split(";")
      .map((c) => c.split("=")[0]?.trim())
      .filter(Boolean)
      .forEach((name) => {
        document.cookie = `${name}=; path=/watch; max-age=0`
      })
  })

  it("uses the expected cookie name", () => {
    expect(LANGUAGE_PREFERENCE_COOKIE).toBe("forge_watch_lang")
  })

  it("writes the slug with path=/watch, max-age=1y, samesite=lax", () => {
    const setSpy = vi.fn<(value: string) => void>()
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get() {
        return ""
      },
      set(value: string) {
        setSpy(value)
      },
    })

    writePreferredLanguageSlug("spanish")

    expect(setSpy).toHaveBeenCalledOnce()
    const written = setSpy.mock.calls[0]![0]
    expect(written).toContain("forge_watch_lang=spanish")
    expect(written).toContain("path=/watch")
    expect(written).toContain("max-age=31536000")
    expect(written.toLowerCase()).toContain("samesite=lax")
  })

  it("URL-encodes special characters in the slug", () => {
    const setSpy = vi.fn<(value: string) => void>()
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get() {
        return ""
      },
      set(value: string) {
        setSpy(value)
      },
    })

    writePreferredLanguageSlug("zh hant")

    expect(setSpy.mock.calls[0]![0]).toContain(
      `forge_watch_lang=${encodeURIComponent("zh hant")}`,
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})

describe("shouldRedirectForPreference", () => {
  const playable = (slug: string) => ({
    language: { slug },
    published: true,
    hls: "https://stream.mux.com/x.m3u8",
  })

  it("returns null when no preference is set", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: null,
        rawLocale: "english",
        variants: [playable("english"), playable("spanish")],
      }),
    ).toBeNull()
  })

  it("returns null when preference matches the URL locale", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "spanish",
        variants: [playable("spanish")],
      }),
    ).toBeNull()
  })

  it("returns null when no playable variant exists for the preference", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "english",
        variants: [playable("english"), playable("french")],
      }),
    ).toBeNull()
  })

  it("returns null when the matching variant is unpublished", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "english",
        variants: [
          playable("english"),
          { ...playable("spanish"), published: false },
        ],
      }),
    ).toBeNull()
  })

  it("returns null when the matching variant has null hls", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "english",
        variants: [playable("english"), { ...playable("spanish"), hls: null }],
      }),
    ).toBeNull()
  })

  it("returns the preference slug when a published HLS variant exists", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "english",
        variants: [playable("english"), playable("spanish")],
      }),
    ).toBe("spanish")
  })

  it("tolerates null and missing entries in the variants list", () => {
    expect(
      shouldRedirectForPreference({
        preferredSlug: "spanish",
        rawLocale: "english",
        variants: [null, playable("english"), playable("spanish")],
      }),
    ).toBe("spanish")
  })
})
