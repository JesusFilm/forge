import { describe, expect, it } from "vitest"

import {
  firstNonBlankText,
  humanizeContentSlug,
  resolveVideoDisplayTitle,
  type VideoDisplayTitleInput,
} from "./index"

describe("content display title policy", () => {
  describe("firstNonBlankText", () => {
    it("trims and returns the first nonblank candidate", () => {
      expect(
        firstNonBlankText([null, "   ", "  Requested title  ", "Later"]),
      ).toBe("Requested title")
    })

    it("returns undefined when every candidate is absent or blank", () => {
      expect(firstNonBlankText([undefined, null, "\t\n"])).toBeUndefined()
    })
  })

  describe("humanizeContentSlug", () => {
    it("turns repeated hyphen and underscore separators into readable words", () => {
      expect(humanizeContentSlug("  miraculous--catch_of-fish  ")).toBe(
        "Miraculous Catch Of Fish",
      )
    })

    it("returns undefined for an absent or separator-only slug", () => {
      expect(humanizeContentSlug(undefined)).toBeUndefined()
      expect(humanizeContentSlug(" --__-- ")).toBeUndefined()
    })
  })

  describe("resolveVideoDisplayTitle", () => {
    it("prefers the first trimmed requested title", () => {
      expect(
        resolveVideoDisplayTitle({
          requestedTitles: ["  Arabic title  ", "Later requested title"],
          englishTitles: ["English title"],
          slug: "video-slug",
        }),
      ).toBe("Arabic title")
    })

    it("uses a later requested title before English when earlier rows are blank", () => {
      expect(
        resolveVideoDisplayTitle({
          requestedTitles: [null, "   ", "Second requested title"],
          englishTitles: ["English title"],
          slug: "video-slug",
        }),
      ).toBe("Second requested title")
    })

    it("falls back to the first trimmed English title", () => {
      expect(
        resolveVideoDisplayTitle({
          requestedTitles: [" "],
          englishTitles: [null, "  English title  "],
          slug: "video-slug",
        }),
      ).toBe("English title")
    })

    it("humanizes the slug only after requested and English candidates", () => {
      expect(
        resolveVideoDisplayTitle({
          requestedTitles: [null, " "],
          englishTitles: [undefined, ""],
          slug: "miraculous--catch_of-fish",
        }),
      ).toBe("Miraculous Catch Of Fish")
    })

    it("returns undefined when no title or usable slug exists", () => {
      expect(
        resolveVideoDisplayTitle({
          requestedTitles: [" "],
          englishTitles: [],
          slug: "__--",
        }),
      ).toBeUndefined()
    })

    it("does not accept record identifiers as display fallbacks", () => {
      const legacyRecord = {
        requestedTitles: [],
        englishTitles: [],
        coreId: "core-id-must-not-render",
        documentId: "document-id-must-not-render",
      } as VideoDisplayTitleInput

      expect(resolveVideoDisplayTitle(legacyRecord)).toBeUndefined()
    })
  })
})
