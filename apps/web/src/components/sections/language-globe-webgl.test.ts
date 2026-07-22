/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest"

import { startLanguageGlobeRuntime } from "./language-globe-webgl"

describe("language globe WebGL runtime", () => {
  it("returns a static fallback when WebGL is unavailable", () => {
    const canvas = document.createElement("canvas")
    vi.spyOn(canvas, "getContext").mockReturnValue(null)
    const onReady = vi.fn()

    const runtime = startLanguageGlobeRuntime({
      canvas,
      stage: document.createElement("div"),
      root: document.createElement("section"),
      getLanguages: () => [],
      getLabelElements: () => [],
      getPaused: () => false,
      getMobile: () => false,
      onReady,
    })

    expect(onReady).toHaveBeenCalledWith(false)
    expect(() => runtime.requestRender()).not.toThrow()
    expect(() => runtime.dispose()).not.toThrow()
  })
})
