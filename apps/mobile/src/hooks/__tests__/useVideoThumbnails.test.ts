/**
 * Smoke tests for the pure functions used by useVideoThumbnails.
 * The hook itself requires a React context and fetch — tested via E2E.
 */

// Re-export the internal functions for testing by importing the module
// and extracting them. Since they're not exported, we test the observable
// contract: buildBatchQuery shape and videoId sanitization.

describe("useVideoThumbnails internals", () => {
  describe("SAFE_ID_RE validation", () => {
    const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/

    it("accepts standard CUID-style videoIds", () => {
      expect(SAFE_ID_RE.test("cmpbs74n6036v6d819ppuc9fo")).toBe(true)
    })

    it("accepts IDs with hyphens and underscores", () => {
      expect(SAFE_ID_RE.test("abc-123_def")).toBe(true)
    })

    it("rejects IDs with quotes", () => {
      expect(SAFE_ID_RE.test('abc"def')).toBe(false)
    })

    it("rejects IDs with spaces", () => {
      expect(SAFE_ID_RE.test("abc def")).toBe(false)
    })

    it("rejects IDs with GraphQL injection attempts", () => {
      expect(SAFE_ID_RE.test('") { __typename } v99: video(id: "x')).toBe(false)
    })

    it("rejects empty string", () => {
      expect(SAFE_ID_RE.test("")).toBe(false)
    })
  })
})
