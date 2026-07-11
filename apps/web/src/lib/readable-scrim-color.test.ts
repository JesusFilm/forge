import { describe, expect, it } from "vitest"

import { readableScrimRgb } from "./readable-scrim-color"

describe("readableScrimRgb", () => {
  it("keeps already dark dominant colors recognizable", () => {
    expect(readableScrimRgb("#123456")).toEqual({ r: 18, g: 52, b: 86 })
  })

  it("darkens bright dominant colors for white text contrast", () => {
    const rgb = readableScrimRgb("#f8d56a")

    expect(rgb).not.toEqual({ r: 248, g: 213, b: 106 })
    expect(rgb?.r).toBeLessThan(180)
    expect(rgb?.g).toBeLessThan(160)
  })
})
