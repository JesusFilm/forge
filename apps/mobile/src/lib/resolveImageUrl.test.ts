jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}))

import { resolveImageUrl, WEB_BASE_URL } from "./resolveImageUrl"

describe("resolveImageUrl", () => {
  it("returns null for null input", () => {
    expect(resolveImageUrl(null)).toBeNull()
  })

  it("returns null for undefined input", () => {
    expect(resolveImageUrl(undefined)).toBeNull()
  })

  it("returns absolute HTTPS URL as-is", () => {
    expect(resolveImageUrl("https://cdn.example.com/img.jpg")).toBe(
      "https://cdn.example.com/img.jpg",
    )
  })

  it("returns absolute HTTP URL as-is", () => {
    expect(resolveImageUrl("http://example.com/img.jpg")).toBe(
      "http://example.com/img.jpg",
    )
  })

  it("prepends WEB_BASE_URL to relative path with leading slash", () => {
    expect(resolveImageUrl("/images/thumb.jpg")).toBe(
      `${WEB_BASE_URL}/images/thumb.jpg`,
    )
  })

  it("returns null for relative path without leading slash", () => {
    expect(resolveImageUrl("images/thumb.jpg")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(resolveImageUrl("")).toBeNull()
  })
})
