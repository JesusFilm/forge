import { BROWSE_TOPICS } from "../browseTopics"

describe("BROWSE_TOPICS", () => {
  it("has exactly six topics in the web-parity order", () => {
    expect(BROWSE_TOPICS).toHaveLength(6)
    expect(BROWSE_TOPICS.map((t) => t.label)).toEqual([
      "Bible Stories",
      "Parables",
      "Animated",
      "Study",
      "Family",
      "Christmas",
    ])
  })

  it("uses lowercase, non-empty search terms", () => {
    for (const t of BROWSE_TOPICS) {
      expect(t.searchTerm).toBe(t.searchTerm.toLowerCase())
      expect(t.searchTerm.trim().length).toBeGreaterThan(0)
    }
  })

  it("gives every topic a distinct hex base color and glyph", () => {
    expect(new Set(BROWSE_TOPICS.map((t) => t.baseColor)).size).toBe(6)
    expect(new Set(BROWSE_TOPICS.map((t) => t.glyph)).size).toBe(6)
    for (const t of BROWSE_TOPICS) {
      expect(t.baseColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(t.glyph.length).toBeGreaterThan(0)
    }
  })
})
