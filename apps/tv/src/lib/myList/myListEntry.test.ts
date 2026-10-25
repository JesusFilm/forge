import { toMyListEntry, type SaveableRecord } from "./myListEntry"

const STAMP = "2026-08-14T00:00:00.000Z"

function record(overrides: Partial<SaveableRecord> = {}): SaveableRecord {
  return {
    documentId: "vid-1",
    slug: "the-savior",
    title: "The Savior",
    label: "FEATURE_FILM",
    posterUrl: "https://img.example/savior.jpg",
    ...overrides,
  }
}

describe("toMyListEntry", () => {
  it("projects the record onto a saved row", () => {
    expect(toMyListEntry(record(), STAMP)).toEqual({
      videoId: "vid-1",
      slug: "the-savior",
      title: "The Savior",
      imageUrl: "https://img.example/savior.jpg",
      rawLabel: "FEATURE_FILM",
      addedAt: STAMP,
    })
  })

  it.each([
    ["null record", null],
    ["undefined record", undefined],
  ])("returns null for a %s", (_label, input) => {
    expect(toMyListEntry(input, STAMP)).toBeNull()
  })

  it.each([
    ["documentId", { documentId: "" }],
    ["slug", { slug: "" }],
  ])(
    "returns null without a %s — nothing to key or route on",
    (_f, missing) => {
      expect(toMyListEntry(record(missing), STAMP)).toBeNull()
    },
  )

  it("keeps a null title and image rather than inventing placeholders", () => {
    const entry = toMyListEntry(record({ title: null, posterUrl: null }), STAMP)
    expect(entry).toMatchObject({ title: null, imageUrl: null })
  })

  it.each(["SERIES", "COLLECTION", "EPISODE", "FEATURE_FILM"])(
    "copies the wire label %s verbatim",
    (label) => {
      // Verbatim is the contract: routing matches admin's uppercase literals,
      // so any normalization here silently breaks saved series.
      expect(toMyListEntry(record({ label }), STAMP)!.rawLabel).toBe(label)
    },
  )

  it("keeps a null label — routing reads that as a plain video", () => {
    expect(toMyListEntry(record({ label: null }), STAMP)!.rawLabel).toBeNull()
  })
})
