import { normalizeChildDubLanguages } from "./normalizeVideo"

describe("normalizeChildDubLanguages (lazy series language union)", () => {
  it("returns [] for null / undefined / empty (pending or unfetchable)", () => {
    expect(normalizeChildDubLanguages(null)).toEqual([])
    expect(normalizeChildDubLanguages(undefined)).toEqual([])
    expect(normalizeChildDubLanguages([])).toEqual([])
  })

  it("dedupes by slug (never bcp47 — ko/ko-kmr collide) and drops blank/null slugs", () => {
    const out = normalizeChildDubLanguages([
      { slug: "en", name: null, bcp47: "en" },
      { slug: "en", name: null, bcp47: "en" }, // duplicate slug → dropped
      { slug: "", name: null, bcp47: "xx" }, // blank slug → dropped
      { slug: null, name: null, bcp47: null }, // null slug → dropped
      { slug: "ko", name: null, bcp47: "ko" },
    ])
    expect(out).toEqual([
      { slug: "en", name: null, bcp47: "en" },
      { slug: "ko", name: null, bcp47: "ko" },
    ])
  })

  it("passes bcp47 through and null-coalesces a missing one", () => {
    const out = normalizeChildDubLanguages([
      { slug: "fr", name: null, bcp47: "fr" },
      { slug: "xx", name: null, bcp47: null },
    ])
    expect(out.map((l) => l.bcp47)).toEqual(["fr", null])
  })

  // The truthy-name branch resolves the JSON locale map via pickLocalizedName —
  // the path the old normalizeSeries tests covered before U1 moved this out.
  it("resolves a JSON locale-map name to the localized string", () => {
    const out = normalizeChildDubLanguages([
      { slug: "en", name: { en: "English" }, bcp47: "en" },
    ])
    expect(out[0]).toEqual({ slug: "en", name: "English", bcp47: "en" })
  })
})
