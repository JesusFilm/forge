import { afterEach, describe, expect, it, vi } from "vitest"

import { loadShortFonts, SHORT_FONT_FAMILIES } from "./fonts"
import {
  INTER_LATIN_WOFF2_BASE64,
  MONTSERRAT_LATIN_WOFF2_BASE64,
} from "./fonts-data"

const WOFF2_MAGIC = "wOF2"

describe("fonts-data", () => {
  it.each([
    ["Montserrat", MONTSERRAT_LATIN_WOFF2_BASE64],
    ["Inter", INTER_LATIN_WOFF2_BASE64],
  ])("embeds %s as non-empty base64 woff2 bytes", (_family, base64) => {
    expect(typeof base64).toBe("string")
    expect(base64.length).toBeGreaterThan(1000)
    const bytes = Buffer.from(base64, "base64")
    expect(bytes.subarray(0, 4).toString("latin1")).toBe(WOFF2_MAGIC)
  })
})

describe("fonts", () => {
  it("exposes loadShortFonts as a function (not executed — needs DOM)", () => {
    expect(typeof loadShortFonts).toBe("function")
  })

  it("maps the captionFont knob values to CSS family names", () => {
    expect(SHORT_FONT_FAMILIES.montserrat).toBe("Montserrat")
    expect(SHORT_FONT_FAMILIES.inter).toBe("Inter")
  })
})

describe("loadShortFonts failure caching", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock("remotion")
    vi.resetModules()
  })

  it("clears the memoized promise on failure so a later mount retries", async () => {
    // Fresh module instance so this test owns the module-level fontsPromise.
    vi.resetModules()

    const delayRender = vi.fn(() => 7)
    const continueRender = vi.fn()
    // Real cancelRender THROWS — pinning that shape is what proves the cache
    // is cleared BEFORE cancelRender (a clear placed after would never run).
    const cancelRender = vi.fn((error: unknown) => {
      throw error
    })
    vi.doMock("remotion", () => ({ delayRender, continueRender, cancelRender }))

    let failLoads = true
    class FakeFontFace {
      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors?: unknown,
      ) {}
      async load(): Promise<FakeFontFace> {
        if (failLoads) {
          throw new Error("font load failed")
        }
        return this
      }
    }
    const fontsAdd = vi.fn()
    vi.stubGlobal("FontFace", FakeFontFace)
    vi.stubGlobal("document", { fonts: { add: fontsAdd } })

    const { loadShortFonts: load } = await import("./fonts")

    const first = load()
    await expect(first).rejects.toThrow("font load failed")
    expect(cancelRender).toHaveBeenCalledTimes(1)
    expect(continueRender).not.toHaveBeenCalled()

    // The failure must not be cached: the second call starts a NEW load
    // (new promise, new delayRender handle) and succeeds.
    failLoads = false
    const second = load()
    expect(second).not.toBe(first)
    await expect(second).resolves.toBeUndefined()
    expect(delayRender).toHaveBeenCalledTimes(2)
    expect(continueRender).toHaveBeenCalledWith(7)
    expect(fontsAdd).toHaveBeenCalledTimes(2) // both font families registered

    // Success IS memoized: a third call returns the cached promise.
    expect(load()).toBe(second)
  })
})
