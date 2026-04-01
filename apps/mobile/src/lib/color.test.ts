import { hexToRgba } from "./color"

describe("hexToRgba", () => {
  it("converts 6-digit hex to rgba", () => {
    expect(hexToRgba("#FF0000", 0.5)).toBe("rgba(255,0,0,0.5)")
  })

  it("converts 3-digit hex to rgba", () => {
    expect(hexToRgba("#F00", 0.5)).toBe("rgba(255,0,0,0.5)")
  })

  it("handles hex without # prefix", () => {
    expect(hexToRgba("00FF00", 1)).toBe("rgba(0,255,0,1)")
  })

  it("handles alpha 0 (transparent)", () => {
    expect(hexToRgba("#000000", 0)).toBe("rgba(0,0,0,0)")
  })

  it("handles alpha 1 (opaque)", () => {
    expect(hexToRgba("#FFFFFF", 1)).toBe("rgba(255,255,255,1)")
  })

  it("falls back to default for invalid hex", () => {
    expect(hexToRgba("not-a-color", 0.5)).toBe("rgba(26,24,21,0.5)")
  })

  it("falls back to default for empty string", () => {
    expect(hexToRgba("", 0.5)).toBe("rgba(26,24,21,0.5)")
  })

  it("falls back to default for too-short hex", () => {
    expect(hexToRgba("#F", 0.5)).toBe("rgba(26,24,21,0.5)")
  })
})
