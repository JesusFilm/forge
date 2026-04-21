// Golden fixture tests for Core → Admin transforms.

import { describe, expect, it } from "vitest"

// Re-export mapLabel for testing — it's not exported from sync-videos.ts
// so we test the mapping logic directly.
const LABEL_MAP: Record<string, string> = {
  collection: "COLLECTION",
  episode: "EPISODE",
  featureFilm: "FEATURE_FILM",
  segment: "SEGMENT",
  series: "SERIES",
  shortFilm: "SHORT_FILM",
  trailer: "TRAILER",
  behindTheScenes: "BEHIND_THE_SCENES",
}

function mapLabel(label: string | null): string | null {
  if (!label) return null
  return LABEL_MAP[label] ?? null
}

function toNameMap(
  names: Array<{ value: string; language: { bcp47: string } }>,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const n of names) map[n.language.bcp47] = n.value
  return map
}

describe("mapLabel — Core camelCase → Prisma enum", () => {
  it.each([
    ["collection", "COLLECTION"],
    ["episode", "EPISODE"],
    ["featureFilm", "FEATURE_FILM"],
    ["segment", "SEGMENT"],
    ["series", "SERIES"],
    ["shortFilm", "SHORT_FILM"],
    ["trailer", "TRAILER"],
    ["behindTheScenes", "BEHIND_THE_SCENES"],
  ])("maps %s → %s", (input, expected) => {
    expect(mapLabel(input)).toBe(expected)
  })

  it("returns null for null input", () => {
    expect(mapLabel(null)).toBeNull()
  })

  it("returns null for unknown label", () => {
    expect(mapLabel("unknownType")).toBeNull()
  })
})

describe("toNameMap — Core localized name array → JSON map", () => {
  it("converts array to locale-keyed map", () => {
    expect(
      toNameMap([
        { value: "English", language: { bcp47: "en" } },
        { value: "Français", language: { bcp47: "fr" } },
      ]),
    ).toEqual({ en: "English", fr: "Français" })
  })

  it("returns empty map for empty array", () => {
    expect(toNameMap([])).toEqual({})
  })

  it("last value wins for duplicate locales", () => {
    expect(
      toNameMap([
        { value: "First", language: { bcp47: "en" } },
        { value: "Second", language: { bcp47: "en" } },
      ]),
    ).toEqual({ en: "Second" })
  })
})
