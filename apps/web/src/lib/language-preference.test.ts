/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { cookies } from "next/headers"

import {
  LANGUAGE_PREFERENCE_COOKIE,
  writePreferredLanguageSlug,
} from "./language-preference-client"
import {
  LANGUAGE_PREFERENCE_COOKIE as SERVER_LANGUAGE_PREFERENCE_COOKIE,
  readPreferredLanguageSlug,
  shouldRedirectForPreference,
} from "./language-preference-server"

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}))

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

  it("uses the same cookie name as the server module", () => {
    expect(LANGUAGE_PREFERENCE_COOKIE).toBe(SERVER_LANGUAGE_PREFERENCE_COOKIE)
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

  it("omits the Secure flag outside production", () => {
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
    const original = process.env.NODE_ENV
    // @ts-expect-error read-only in types but writable at runtime
    process.env.NODE_ENV = "test"
    try {
      writePreferredLanguageSlug("english")
    } finally {
      // @ts-expect-error read-only in types but writable at runtime
      process.env.NODE_ENV = original
    }
    expect(setSpy.mock.calls[0]![0].toLowerCase()).not.toContain("secure")
  })

  it("includes the Secure flag in production", () => {
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
    const original = process.env.NODE_ENV
    // @ts-expect-error read-only in types but writable at runtime
    process.env.NODE_ENV = "production"
    try {
      writePreferredLanguageSlug("english")
    } finally {
      // @ts-expect-error read-only in types but writable at runtime
      process.env.NODE_ENV = original
    }
    expect(setSpy.mock.calls[0]![0].toLowerCase()).toContain("secure")
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

describe("readPreferredLanguageSlug", () => {
  beforeEach(() => {
    vi.mocked(cookies).mockReset()
  })

  it("returns the cookie value when present", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === "forge_watch_lang" ? { value: "spanish" } : undefined,
    } as never)
    expect(await readPreferredLanguageSlug()).toBe("spanish")
  })

  it("returns null when the cookie is absent", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never)
    expect(await readPreferredLanguageSlug()).toBeNull()
  })
})
