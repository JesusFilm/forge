import { describe, expect, it } from "vitest"

import { compareNormalizedRoutes } from "../compare"
import {
  CANARY_EXPERIENCE,
  CAPTURED_FIXTURES,
} from "./captured/canary-experience"
import {
  ORDER_BLOCKS_REORDERED,
  PER_CLASS_FIXTURES,
  SEMANTIC_LOCALE_FALLTHROUGH,
  STRUCTURAL_MISSING_FIELD,
  VALUE_TITLE_MISMATCH,
} from "./hand-rolled/per-class"

describe("hand-rolled per-class fixtures", () => {
  it("STRUCTURAL_MISSING_FIELD produces exactly one structural diff", () => {
    const r = compareNormalizedRoutes(
      STRUCTURAL_MISSING_FIELD.strapi,
      STRUCTURAL_MISSING_FIELD.admin,
      { urlLocale: "en" },
    )
    expect(r.value).toEqual([])
    expect(r.semantic).toEqual([])
    expect(r.order).toEqual([])
    expect(r.structural).toHaveLength(1)
    expect(r.structural[0]?.path).toBe("/description")
    expect(r.structural[0]?.side).toBe("admin")
  })

  it("VALUE_TITLE_MISMATCH produces exactly one value diff", () => {
    const r = compareNormalizedRoutes(
      VALUE_TITLE_MISMATCH.strapi,
      VALUE_TITLE_MISMATCH.admin,
      { urlLocale: "en" },
    )
    expect(r.structural).toEqual([])
    expect(r.semantic).toEqual([])
    expect(r.order).toEqual([])
    expect(r.value).toHaveLength(1)
    expect(r.value[0]?.path).toBe("/title")
  })

  it("ORDER_BLOCKS_REORDERED produces exactly one order diff", () => {
    const r = compareNormalizedRoutes(
      ORDER_BLOCKS_REORDERED.strapi,
      ORDER_BLOCKS_REORDERED.admin,
      { urlLocale: "en" },
    )
    expect(r.structural).toEqual([])
    expect(r.value).toEqual([])
    expect(r.semantic).toEqual([])
    expect(r.order).toHaveLength(1)
    expect(r.order[0]?.path).toBe("/blocks")
  })

  it("SEMANTIC_LOCALE_FALLTHROUGH produces exactly one semantic locale-mismatch", () => {
    const r = compareNormalizedRoutes(
      SEMANTIC_LOCALE_FALLTHROUGH.strapi,
      SEMANTIC_LOCALE_FALLTHROUGH.admin,
      { urlLocale: "en" },
    )
    expect(r.structural).toEqual([])
    expect(r.value).toEqual([])
    expect(r.order).toEqual([])
    expect(r.semantic).toHaveLength(1)
    expect(r.semantic[0]?.subclass).toBe("locale-mismatch")
  })

  it("each per-class fixture produces a non-empty report (smoke check)", () => {
    for (const fixture of PER_CLASS_FIXTURES) {
      const r = compareNormalizedRoutes(fixture.strapi, fixture.admin, {
        urlLocale: "en",
      })
      const totalDiffs =
        r.structural.length +
        r.value.length +
        r.order.length +
        r.semantic.length
      expect(totalDiffs, `fixture ${fixture.name}`).toBeGreaterThan(0)
    }
  })
})

describe("captured fixtures (placeholder)", () => {
  it("canary-experience placeholder is structured and labeled (will be populated in U5)", () => {
    expect(CANARY_EXPERIENCE.name).toBe("canary-experience-placeholder")
    expect(CANARY_EXPERIENCE.strapi).toBeNull()
    expect(CANARY_EXPERIENCE.admin).toBeNull()
    expect(CAPTURED_FIXTURES).toHaveLength(1)
  })

  // When U5 populates the canary fixture, the test above flips to assert
  // that compareNormalizedRoutes produces an empty diff (modulo the
  // default allow-list) when given the captured strapi + admin sides.
  // For now, the placeholder structurally reserves the slot.
})
