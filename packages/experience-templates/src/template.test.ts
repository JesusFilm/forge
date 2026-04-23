import { describe, expect, it } from "vitest"

import { normalizeComponent } from "./aliases"
import { buildSectionKey, computePlatformOrdering } from "./template"

describe("buildSectionKey", () => {
  it("normalizes user-provided text into kebab-case", () => {
    expect(buildSectionKey("Forgiveness & Mercy", "Video 1")).toBe(
      "forgiveness-mercy-video-1",
    )
  })
})

describe("computePlatformOrdering", () => {
  it("returns declaration-order indices for both platforms", () => {
    expect(computePlatformOrdering(4)).toEqual({
      web: [0, 1, 2, 3],
      mobile: [0, 1, 2, 3],
    })
  })
})

describe("normalizeComponent", () => {
  it("maps wrapper aliases to the canonical section component", () => {
    expect(normalizeComponent(" Wrapper ")).toBe("sections.section")
    expect(normalizeComponent("navigation")).toBe(
      "sections.navigation-carousel",
    )
  })
})
