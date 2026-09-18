import { describe, expect, it } from "vitest"

import {
  attributionFor,
  authorOf,
  firstPublishedYear,
} from "./reflection-attribution"

const EN = "Adapted from a trusted classic"

describe("attributionFor", () => {
  it("names the author and the year the work was first published", () => {
    expect(
      attributionFor("J.C. Ryle, Expository Thoughts on the Gospels: Luke", EN),
    ).toBe("Adapted from a trusted classic · J.C. Ryle, 1858")
    expect(
      attributionFor(
        "J.C. Ryle, Expository Thoughts on the Gospels: Matthew",
        EN,
      ),
    ).toBe("Adapted from a trusted classic · J.C. Ryle, 1856")
    expect(
      attributionFor(
        "Matthew Henry, Commentary on the Whole Bible (Gospels: Mark, Luke, John)",
        EN,
      ),
    ).toBe("Adapted from a trusted classic · Matthew Henry, 1710")
    expect(attributionFor("Charles Spurgeon, Morning and Evening", EN)).toBe(
      "Adapted from a trusted classic · Charles Spurgeon, 1865",
    )
  })

  it("takes the localized prefix as given", () => {
    expect(
      attributionFor(
        "J.C. Ryle, Expository Thoughts on the Gospels: Luke",
        "Adaptado de un clásico de confianza",
      ),
    ).toBe("Adaptado de un clásico de confianza · J.C. Ryle, 1858")
  })

  it("shows the name alone when the work's year is unknown", () => {
    expect(attributionFor("Someone Else, A Book", EN)).toBe(
      "Adapted from a trusted classic · Someone Else",
    )
    expect(firstPublishedYear("Someone Else, A Book")).toBeNull()
    expect(authorOf("Someone Else, A Book")).toBe("Someone Else")
  })
})
