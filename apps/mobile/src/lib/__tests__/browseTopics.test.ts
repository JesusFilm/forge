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

  it("uses distinct lowercase, non-empty search terms", () => {
    for (const t of BROWSE_TOPICS) {
      expect(t.searchTerm).toBe(t.searchTerm.toLowerCase())
      expect(t.searchTerm.trim().length).toBeGreaterThan(0)
    }
    // searchTerm is the identity key for the thumbnail cache, the React list
    // key, and expo-image recyclingKey — a duplicate would silently collide all
    // three.
    expect(new Set(BROWSE_TOPICS.map((t) => t.searchTerm)).size).toBe(
      BROWSE_TOPICS.length,
    )
  })

  it("gives every topic a distinct two-stop hex gradient and glyph", () => {
    expect(new Set(BROWSE_TOPICS.map((t) => t.gradient.join("-"))).size).toBe(6)
    expect(new Set(BROWSE_TOPICS.map((t) => t.glyph)).size).toBe(6)
    for (const t of BROWSE_TOPICS) {
      expect(t.gradient).toHaveLength(2)
      for (const stop of t.gradient) {
        expect(stop).toMatch(/^#[0-9A-Fa-f]{6}$/)
      }
      expect(t.glyph.length).toBeGreaterThan(0)
    }
  })
})
