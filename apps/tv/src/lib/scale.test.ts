function atWidth(platform: "ios" | "android", width: number) {
  jest.doMock("react-native", () => ({
    Platform: { OS: platform },
    Dimensions: { get: () => ({ width, height: 1080 }) },
  }))
  let utilities!: typeof import("./scale")
  jest.isolateModules(() => {
    utilities = jest.requireActual<typeof import("./scale")>("./scale")
  })
  jest.dontMock("react-native")
  return utilities
}

describe("readableFontSize", () => {
  it("keeps tvOS small text readable without changing display text", () => {
    const { readableFontSize } = atWidth("ios", 1920)
    expect(readableFontSize(14)).toBe(28)
    expect(readableFontSize(42)).toBe(42)
  })

  it.each([
    { width: 960, minimum: 14, display: 21, intermediate: 16 },
    { width: 1280, minimum: 19, display: 28, intermediate: 21 },
    { width: 1366, minimum: 20, display: 30, intermediate: 22 },
  ])(
    "scales the reference floor and rounds Android text at width $width",
    ({ width, minimum, display, intermediate }) => {
      const { readableFontSize } = atWidth("android", width)
      expect(readableFontSize(14)).toBe(minimum)
      expect(readableFontSize(42)).toBe(display)
      expect(readableFontSize(31)).toBe(intermediate)
    },
  )

  it("uses the reference width when Android has not reported a window width", () => {
    const { readableFontSize } = atWidth("android", 0)
    expect(readableFontSize(14)).toBe(28)
    expect(readableFontSize(42)).toBe(42)
  })
})
