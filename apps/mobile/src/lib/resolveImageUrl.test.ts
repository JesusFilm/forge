import { resolveImageUrl, WEB_BASE_URL } from "./resolveImageUrl"

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}))

describe("resolveImageUrl", () => {
  it("returns null for null input", () => {
    expect(resolveImageUrl(null)).toBeNull()
  })

  it("returns null for undefined input", () => {
    expect(resolveImageUrl(undefined)).toBeNull()
  })

  it("returns absolute HTTPS URL from trusted host as-is", () => {
    expect(
      resolveImageUrl("https://d1wl257kev7hsz.cloudfront.net/img.jpg"),
    ).toBe("https://d1wl257kev7hsz.cloudfront.net/img.jpg")
  })

  it("returns absolute HTTP URL from trusted host as-is", () => {
    expect(resolveImageUrl("http://images.jesusfilm.org/img.jpg")).toBe(
      "http://images.jesusfilm.org/img.jpg",
    )
  })

  it("allows URLs from trusted hosts", () => {
    expect(
      resolveImageUrl("https://d1wl257kev7hsz.cloudfront.net/img.jpg"),
    ).toBe("https://d1wl257kev7hsz.cloudfront.net/img.jpg")
    expect(resolveImageUrl("https://images.jesusfilm.org/img.jpg")).toBe(
      "https://images.jesusfilm.org/img.jpg",
    )
  })

  it("rejects URLs from untrusted hosts", () => {
    expect(
      resolveImageUrl("https://evil-tracker.example.com/pixel.png"),
    ).toBeNull()
    expect(resolveImageUrl("https://google.com/img.jpg")).toBeNull()
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
