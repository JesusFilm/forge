import { describe, expect, it } from "vitest"

import { findSeriesParent } from "../content"
import type { WatchParent, WatchVideoRecord } from "../content"

function parent(
  slug: string | null,
  documentId = `p-${slug ?? "null"}`,
): WatchParent {
  return {
    documentId,
    slug,
    title: null,
    noIndex: null,
    label: null,
    images: [],
    children: [],
  }
}

function record(parents: WatchParent[]): WatchVideoRecord {
  return {
    documentId: "ep-1",
    slug: "wedding-in-cana",
    publishedAt: null,
    localePublishedAt: null,
    title: null,
    snippet: null,
    description: null,
    noIndex: null,
    label: null,
    imageAlt: null,
    images: [],
    primaryLanguage: null,
    parents,
    children: [],
    childDubLanguages: [],
    variants: [],
    subtitles: [],
    studyQuestions: [],
    bibleCitations: [],
  }
}

describe("findSeriesParent", () => {
  it("returns the parent whose slug matches the requested series", () => {
    const lumo = parent("lumo-the-gospel-of-john")
    const result = findSeriesParent(record([lumo]), "lumo-the-gospel-of-john")
    expect(result).toBe(lumo)
  })

  it("returns the matching parent even when others are present", () => {
    const collection = parent("easter")
    const lumo = parent("lumo-the-gospel-of-john")
    const result = findSeriesParent(
      record([collection, lumo]),
      "lumo-the-gospel-of-john",
    )
    expect(result).toBe(lumo)
  })

  it("returns null when no parent matches the requested series", () => {
    const result = findSeriesParent(
      record([parent("easter")]),
      "lumo-the-gospel-of-john",
    )
    expect(result).toBeNull()
  })

  it("returns null when the video has no parents at all", () => {
    expect(findSeriesParent(record([]), "lumo")).toBeNull()
  })

  it("returns null when comparing against a null parent slug", () => {
    expect(findSeriesParent(record([parent(null)]), "lumo")).toBeNull()
  })

  it("is case-sensitive on the slug (matches production contract)", () => {
    const result = findSeriesParent(
      record([parent("lumo-the-gospel-of-john")]),
      "LUMO-the-Gospel-of-John",
    )
    expect(result).toBeNull()
  })
})
