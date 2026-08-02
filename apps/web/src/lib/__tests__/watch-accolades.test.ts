import { describe, expect, it } from "vitest"
import { watchAccoladeForSlug } from "@/lib/watch-accolades"

describe("watchAccoladeForSlug", () => {
  it("awards the most-translated-film record to the JESUS feature film", () => {
    expect(watchAccoladeForSlug("jesus")).toBe("most-translated-film")
  })

  it.each(["jesus-film", "the-jesus-film"])(
    "admits the %s alias for the same film",
    (slug) => {
      expect(watchAccoladeForSlug(slug)).toBe("most-translated-film")
    },
  )

  it("normalizes case and surrounding whitespace", () => {
    expect(watchAccoladeForSlug("  JESUS  ")).toBe("most-translated-film")
  })

  // The record belongs to the feature film, not to its chapter segments or to
  // the other titles that merely mention Jesus. A substring or prefix rule
  // would stamp the Guinness claim onto all of these.
  it.each([
    "jesus-is-brought-to-pilate",
    "jesus-calms-the-storm",
    "the-story-of-jesus-for-children",
    "birth-of-jesus",
    "lumo-the-gospel-of-luke",
    "magdalena",
  ])("does not award the record to %s", (slug) => {
    expect(watchAccoladeForSlug(slug)).toBeNull()
  })

  it.each([null, undefined, "", "   "])(
    "returns null for the empty slug %s",
    (slug) => {
      expect(watchAccoladeForSlug(slug)).toBeNull()
    },
  )
})
