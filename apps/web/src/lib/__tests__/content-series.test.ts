import { describe, expect, it } from "vitest"

import { isSeriesRecord } from "@/lib/content"

// The series resolver's discriminator is the central piece of U1. The
// network-level resolver (`resolveSeriesBySlug`) is exercised end-to-end at
// the route layer (see U5 page-routing tests); here we cover every shape of
// label the discriminator must accept or reject.

type RecordShape = {
  label?: string | null
  children?: { documentId: string }[] | null
}

function makeRecord(
  overrides: RecordShape = {},
): Parameters<typeof isSeriesRecord>[0] {
  return {
    label: null,
    children: [],
    ...overrides,
  } as Parameters<typeof isSeriesRecord>[0]
}

describe("isSeriesRecord — series discriminator (U1)", () => {
  it("accepts lowercase Strapi 'collection' label", () => {
    expect(isSeriesRecord(makeRecord({ label: "collection" }))).toBe(true)
  })

  it("accepts lowercase Strapi 'series' label", () => {
    expect(isSeriesRecord(makeRecord({ label: "series" }))).toBe(true)
  })

  it("accepts uppercase admin 'COLLECTION' label", () => {
    expect(isSeriesRecord(makeRecord({ label: "COLLECTION" }))).toBe(true)
  })

  it("accepts uppercase admin 'SERIES' label", () => {
    expect(isSeriesRecord(makeRecord({ label: "SERIES" }))).toBe(true)
  })

  it("falls back to children-presence when label is null and children exist", () => {
    expect(
      isSeriesRecord(
        makeRecord({ label: null, children: [{ documentId: "child-1" }] }),
      ),
    ).toBe(true)
  })

  it("rejects null label with empty children (not series-shaped)", () => {
    expect(isSeriesRecord(makeRecord({ label: null, children: [] }))).toBe(
      false,
    )
  })

  it("rejects single-video labels (episode, featureFilm, etc.)", () => {
    expect(isSeriesRecord(makeRecord({ label: "episode" }))).toBe(false)
    expect(isSeriesRecord(makeRecord({ label: "featureFilm" }))).toBe(false)
    expect(isSeriesRecord(makeRecord({ label: "FEATURE_FILM" }))).toBe(false)
    expect(isSeriesRecord(makeRecord({ label: "trailer" }))).toBe(false)
  })

  it("rejects single-video labels even when children happen to exist", () => {
    // Belt-and-suspenders: an episode that the editor has accidentally
    // attached children to is still an episode, not a series — label wins
    // over children-presence when label is set.
    expect(
      isSeriesRecord(
        makeRecord({
          label: "episode",
          children: [{ documentId: "child-1" }],
        }),
      ),
    ).toBe(false)
  })
})
