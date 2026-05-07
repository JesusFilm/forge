import { describe, expect, it } from "vitest"

import { compareNormalizedRoutes } from "./compare"
import type { AllowListEntry } from "./allow-list"
import type { NormalizedExperienceRoute } from "./shared-shape"

const OPTIONS = { urlLocale: "en" } as const

function makeRoute(
  source: "strapi" | "admin",
  overrides: Partial<NormalizedExperienceRoute> = {},
): NormalizedExperienceRoute {
  return {
    id: source === "strapi" ? "doc-1" : "exp-loc-1",
    slug: "test-slug",
    locale: "en",
    title: "Test Experience",
    description: null,
    ogImage: null,
    blocks: [],
    meta: {
      source,
      potentiallyTruncated: false,
      rawUrls: {},
    },
    ...overrides,
  }
}

const NO_ALLOW_LIST: ReadonlyArray<AllowListEntry> = []

describe("compareNormalizedRoutes — happy path", () => {
  it("identical inputs produce empty diff across all channels", () => {
    const strapi = makeRoute("strapi", { id: "same-id" })
    const admin = makeRoute("admin", { id: "same-id" })
    const report = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    expect(report.structural).toEqual([])
    expect(report.value).toEqual([])
    expect(report.order).toEqual([])
    expect(report.semantic).toEqual([])
    expect(report.potentiallyTruncated).toEqual([])
  })
})

describe("compareNormalizedRoutes — structural class", () => {
  it("flags admin-missing-description as structural { side: 'admin' }", () => {
    const strapi = makeRoute("strapi", {
      id: "x",
      description: "S desc",
    })
    const admin = makeRoute("admin", { id: "x", description: null })
    const report = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    expect(report.structural).toHaveLength(1)
    expect(report.structural[0]).toMatchObject({
      path: "/description",
      side: "admin",
    })
  })

  it("treats null and missing-key as equivalent post-normalization", () => {
    const strapi = makeRoute("strapi", { id: "x", description: null })
    const admin = makeRoute("admin", { id: "x", description: null })
    const report = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    expect(report.structural).toEqual([])
  })
})

describe("compareNormalizedRoutes — value class", () => {
  it("flags differing titles as value with both raw values", () => {
    const strapi = makeRoute("strapi", { id: "x", title: "Easter" })
    const admin = makeRoute("admin", { id: "x", title: "Easter Story" })
    const report = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    expect(report.value).toHaveLength(1)
    expect(report.value[0]).toMatchObject({
      path: "/title",
      strapi: "Easter",
      admin: "Easter Story",
    })
  })
})

describe("compareNormalizedRoutes — order class", () => {
  it("flags blocks reordered (same set, different order) as order diff", () => {
    const blocksStrapi = [
      { kind: "text", id: "a", data: {} },
      { kind: "cta", id: "b", data: {} },
      { kind: "video", id: "c", data: {} },
    ] as const
    const blocksAdmin = [
      { kind: "text", id: "a", data: {} },
      { kind: "video", id: "c", data: {} },
      { kind: "cta", id: "b", data: {} },
    ] as const
    const strapi = makeRoute("strapi", {
      id: "x",
      blocks: blocksStrapi as unknown as NormalizedExperienceRoute["blocks"],
    })
    const admin = makeRoute("admin", {
      id: "x",
      blocks: blocksAdmin as unknown as NormalizedExperienceRoute["blocks"],
    })
    const report = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    expect(report.order).toHaveLength(1)
    expect(report.order[0]?.path).toBe("/blocks")
    expect(report.order[0]?.strapiOrder).toEqual(["a", "b", "c"])
    expect(report.order[0]?.adminOrder).toEqual(["a", "c", "b"])
  })
})

describe("compareNormalizedRoutes — semantic locale-mismatch", () => {
  it("fires when strapi resolved locale differs from URL locale", () => {
    const strapi = makeRoute("strapi", { id: "x", locale: "es" })
    const admin = makeRoute("admin", { id: "x", locale: "en" })
    const report = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    expect(report.semantic).toHaveLength(1)
    expect(report.semantic[0]).toMatchObject({
      path: "/locale",
      subclass: "locale-mismatch",
      strapi: "es",
      admin: "en",
    })
  })

  it("fires when admin resolved locale differs from URL locale (Strapi was correct)", () => {
    const strapi = makeRoute("strapi", { id: "x", locale: "en" })
    const admin = makeRoute("admin", { id: "x", locale: "es" })
    const report = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    expect(report.semantic).toHaveLength(1)
    expect(report.semantic[0]?.subclass).toBe("locale-mismatch")
  })

  it("does not fire when both sides match the URL locale", () => {
    const strapi = makeRoute("strapi", { id: "x", locale: "en" })
    const admin = makeRoute("admin", { id: "x", locale: "en" })
    const report = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    expect(report.semantic).toEqual([])
  })
})

describe("compareNormalizedRoutes — truncation downgrade", () => {
  it("admin-tail entries land in potentiallyTruncated when strapi side is flagged truncated", () => {
    const blocksStrapi = [
      { kind: "text", id: "a", data: {} },
      { kind: "text", id: "b", data: {} },
    ] as const
    const blocksAdmin = [
      { kind: "text", id: "a", data: {} },
      { kind: "text", id: "b", data: {} },
      { kind: "text", id: "c", data: {} },
      { kind: "text", id: "d", data: {} },
    ] as const
    const strapi = makeRoute("strapi", {
      id: "x",
      blocks: blocksStrapi as unknown as NormalizedExperienceRoute["blocks"],
      meta: {
        source: "strapi",
        potentiallyTruncated: true,
        rawUrls: {},
      },
    })
    const admin = makeRoute("admin", {
      id: "x",
      blocks: blocksAdmin as unknown as NormalizedExperienceRoute["blocks"],
    })
    const report = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    // Tail entries reclassified out of structural.
    expect(report.structural).toEqual([])
    expect(report.potentiallyTruncated).toHaveLength(2)
    expect(report.potentiallyTruncated.every((e) => e.side === "strapi")).toBe(
      true,
    )
  })
})

describe("compareNormalizedRoutes — allow-list", () => {
  it("filters out entries whose path+channel match the allow-list", () => {
    // Realistic case: admin cuid vs Strapi documentId differ.
    const strapi = makeRoute("strapi", { id: "doc-strapi-1" })
    const admin = makeRoute("admin", { id: "exp-loc-cuid-1" })
    const report = compareNormalizedRoutes(strapi, admin, OPTIONS)
    // Default allow-list suppresses /id on the value channel.
    expect(report.value.find((e) => e.path === "/id")).toBeUndefined()
    expect(report.meta.appliedAllowList.some((e) => e.path === "/id")).toBe(
      true,
    )
  })

  it("indexAllowList rejects entries with empty rationale", () => {
    expect(() =>
      compareNormalizedRoutes(makeRoute("strapi"), makeRoute("admin"), {
        ...OPTIONS,
        allowList: [{ path: "/x", channel: "value", rationale: "" }],
      }),
    ).toThrow(/empty rationale/)
  })
})

describe("compareNormalizedRoutes — determinism", () => {
  it("two consecutive runs over identical inputs produce byte-identical JSON", () => {
    const blocksStrapi = [
      { kind: "text", id: "a", data: {} },
      { kind: "cta", id: "b", data: {} },
      { kind: "video", id: "c", data: {} },
    ] as const
    const strapi = makeRoute("strapi", {
      id: "same",
      blocks: blocksStrapi as unknown as NormalizedExperienceRoute["blocks"],
    })
    const admin = makeRoute("admin", {
      id: "same",
      blocks: [
        { kind: "text", id: "a", data: {} },
        { kind: "video", id: "c", data: {} },
        { kind: "cta", id: "b", data: {} },
      ] as unknown as NormalizedExperienceRoute["blocks"],
    })
    const report1 = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    const report2 = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    expect(JSON.stringify(report1)).toBe(JSON.stringify(report2))
  })

  it("path-pointer numeric-aware sort: /blocks/2 precedes /blocks/10", () => {
    // 11 blocks each so /blocks/10 is a meaningful path; differ entries
    // appear at every index where contents differ.
    const strapiBlocks = Array.from(
      { length: 11 },
      (_, i) =>
        ({ kind: "text", id: `b-${i}`, data: { v: i } }) as unknown as never,
    )
    const adminBlocks = Array.from(
      { length: 11 },
      (_, i) =>
        ({
          kind: "text",
          id: `b-${i}`,
          data: { v: i + 100 }, // every value differs
        }) as unknown as never,
    )
    const strapi = makeRoute("strapi", {
      id: "x",
      blocks: strapiBlocks as unknown as NormalizedExperienceRoute["blocks"],
    })
    const admin = makeRoute("admin", {
      id: "x",
      blocks: adminBlocks as unknown as NormalizedExperienceRoute["blocks"],
    })
    const report = compareNormalizedRoutes(strapi, admin, {
      ...OPTIONS,
      allowList: NO_ALLOW_LIST,
    })
    const valuePaths = report.value.map((e) => e.path)
    // Find indices of /blocks/2 and /blocks/10 in the sorted output.
    const idx2 = valuePaths.indexOf("/blocks/2/data/v")
    const idx10 = valuePaths.indexOf("/blocks/10/data/v")
    expect(idx2).toBeGreaterThanOrEqual(0)
    expect(idx10).toBeGreaterThanOrEqual(0)
    expect(idx2).toBeLessThan(idx10)
  })
})
