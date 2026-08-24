import {
  cleanStreamUrl,
  validateStreamingUrl,
  validateActionUrl,
  isAllowedQuizUrl,
} from "./validateUrl"

describe("cleanStreamUrl", () => {
  it("trims outer whitespace", () => {
    expect(cleanStreamUrl("  https://stream.mux.com/abc123.m3u8\n")).toBe(
      "https://stream.mux.com/abc123.m3u8",
    )
  })

  it("rejects interior whitespace", () => {
    expect(cleanStreamUrl("https://stream.mux.com/abc\n123.m3u8")).toBeNull()
  })

  it("rejects missing and whitespace-only values", () => {
    expect(cleanStreamUrl(null)).toBeNull()
    expect(cleanStreamUrl(undefined)).toBeNull()
    expect(cleanStreamUrl("  \n")).toBeNull()
  })
})

describe("isAllowedQuizUrl", () => {
  it("allows https://nextstep.is", () => {
    expect(isAllowedQuizUrl("https://nextstep.is/quiz")).toBe(true)
  })

  it("allows subdomains of nextstep.is", () => {
    expect(isAllowedQuizUrl("https://your.nextstep.is/path")).toBe(true)
  })

  it("allows paths and query strings", () => {
    expect(isAllowedQuizUrl("https://nextstep.is/quiz?expand=false")).toBe(true)
  })

  it("rejects http://", () => {
    expect(isAllowedQuizUrl("http://nextstep.is/quiz")).toBe(false)
  })

  it("rejects non-nextstep.is domains", () => {
    expect(isAllowedQuizUrl("https://evil.com/quiz")).toBe(false)
  })

  it("rejects URLs with non-default ports", () => {
    expect(isAllowedQuizUrl("https://nextstep.is:1234/quiz")).toBe(false)
  })

  it("rejects URLs with credentials", () => {
    expect(isAllowedQuizUrl("https://user:pass@nextstep.is/quiz")).toBe(false)
  })

  it("rejects URLs with username only", () => {
    expect(isAllowedQuizUrl("https://user@nextstep.is/quiz")).toBe(false)
  })

  it("rejects malformed URLs", () => {
    expect(isAllowedQuizUrl("not-a-url")).toBe(false)
  })

  it("rejects empty string", () => {
    expect(isAllowedQuizUrl("")).toBe(false)
  })

  it("rejects domains that merely end with nextstep.is (e.g. evilnextstep.is)", () => {
    expect(isAllowedQuizUrl("https://evilnextstep.is/quiz")).toBe(false)
  })
})

describe("validateStreamingUrl", () => {
  it("allows Mux streaming URLs", () => {
    expect(validateStreamingUrl("https://stream.mux.com/abc123.m3u8")).toBe(
      true,
    )
  })

  it("rejects non-Mux URLs", () => {
    expect(validateStreamingUrl("https://evil.com/stream.m3u8")).toBe(false)
  })

  it("rejects null and undefined", () => {
    expect(validateStreamingUrl(null)).toBe(false)
    expect(validateStreamingUrl(undefined)).toBe(false)
  })
})

describe("validateActionUrl", () => {
  it("allows https URLs", () => {
    expect(validateActionUrl("https://example.com")).toBe(true)
  })

  it("rejects javascript: URLs", () => {
    expect(validateActionUrl("javascript:alert(1)")).toBe(false)
  })

  it("rejects data: URLs", () => {
    expect(validateActionUrl("data:text/html,<h1>hi</h1>")).toBe(false)
  })

  it("rejects null and undefined", () => {
    expect(validateActionUrl(null)).toBe(false)
    expect(validateActionUrl(undefined)).toBe(false)
  })
})
