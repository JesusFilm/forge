/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  SUBTITLE_PREFERENCE_COOKIE,
  readSubtitlePreference,
  writeSubtitlePreference,
} from "./subtitle-preference-client"

function clearCookies() {
  document.cookie
    .split(";")
    .map((c) => c.split("=")[0]?.trim())
    .filter(Boolean)
    .forEach((name) => {
      document.cookie = `${name}=; path=/watch; max-age=0`
    })
}

describe("SUBTITLE_PREFERENCE_COOKIE", () => {
  it("uses the expected cookie name", () => {
    expect(SUBTITLE_PREFERENCE_COOKIE).toBe("forge_watch_subs")
  })
})

describe("writeSubtitlePreference", () => {
  let setSpy: ReturnType<typeof vi.fn<(value: string) => void>>

  beforeEach(() => {
    setSpy = vi.fn<(value: string) => void>()
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get() {
        return ""
      },
      set(value: string) {
        setSpy(value)
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("writes the language slug when enabled", () => {
    writeSubtitlePreference(true, "spanish")
    const written = setSpy.mock.calls[0]![0]
    expect(written).toContain("forge_watch_subs=spanish")
    expect(written).toContain("path=/watch")
    expect(written).toContain("max-age=31536000")
    expect(written.toLowerCase()).toContain("samesite=lax")
  })

  it("writes 'off' when disabled", () => {
    writeSubtitlePreference(false, null)
    expect(setSpy.mock.calls[0]![0]).toContain("forge_watch_subs=off")
  })

  it("writes 'off' when enabled but languageSlug is null", () => {
    writeSubtitlePreference(true, null)
    expect(setSpy.mock.calls[0]![0]).toContain("forge_watch_subs=off")
  })

  it("URL-encodes special characters in the slug", () => {
    writeSubtitlePreference(true, "zh hant")
    expect(setSpy.mock.calls[0]![0]).toContain(
      `forge_watch_subs=${encodeURIComponent("zh hant")}`,
    )
  })

  it("omits the Secure flag outside production", () => {
    const original = process.env.NODE_ENV
    // @ts-expect-error read-only in types but writable at runtime
    process.env.NODE_ENV = "test"
    try {
      writeSubtitlePreference(true, "english")
    } finally {
      // @ts-expect-error read-only in types but writable at runtime
      process.env.NODE_ENV = original
    }
    expect(setSpy.mock.calls[0]![0].toLowerCase()).not.toContain("secure")
  })

  it("includes the Secure flag in production", () => {
    const original = process.env.NODE_ENV
    // @ts-expect-error read-only in types but writable at runtime
    process.env.NODE_ENV = "production"
    try {
      writeSubtitlePreference(true, "english")
    } finally {
      // @ts-expect-error read-only in types but writable at runtime
      process.env.NODE_ENV = original
    }
    expect(setSpy.mock.calls[0]![0].toLowerCase()).toContain("secure")
  })
})

describe("readSubtitlePreference", () => {
  beforeEach(() => {
    clearCookies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns enabled false when no cookie exists", () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
    })
    expect(readSubtitlePreference()).toEqual({
      enabled: false,
      languageSlug: null,
    })
  })

  it("returns enabled false when cookie is 'off'", () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "forge_watch_subs=off",
    })
    expect(readSubtitlePreference()).toEqual({
      enabled: false,
      languageSlug: null,
    })
  })

  it("returns enabled true with the language slug", () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "forge_watch_subs=spanish",
    })
    expect(readSubtitlePreference()).toEqual({
      enabled: true,
      languageSlug: "spanish",
    })
  })

  it("decodes URL-encoded slugs", () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => `forge_watch_subs=${encodeURIComponent("zh hant")}`,
    })
    expect(readSubtitlePreference()).toEqual({
      enabled: true,
      languageSlug: "zh hant",
    })
  })

  it("reads correctly when other cookies exist", () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "forge_watch_lang=english; forge_watch_subs=french; other=val",
    })
    expect(readSubtitlePreference()).toEqual({
      enabled: true,
      languageSlug: "french",
    })
  })

  it("overwrites previous value on re-write", () => {
    const setSpy = vi.fn<(value: string) => void>()
    let currentCookie = "forge_watch_subs=english"
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => currentCookie,
      set(value: string) {
        setSpy(value)
        const [pair] = value.split(";")
        currentCookie = pair!
      },
    })

    writeSubtitlePreference(true, "french")
    expect(readSubtitlePreference()).toEqual({
      enabled: true,
      languageSlug: "french",
    })
  })
})
