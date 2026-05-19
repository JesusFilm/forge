import { describe, expect, it } from "vitest"
import { enrichMediaItem } from "./enrichment"

const ADMIN_FALLBACK =
  "https://imagedelivery.net/account/abc/mobileCinematicHigh"
const ADMIN_OVERRIDE = "https://example.org/images/override.png"

const base = {
  videoId: "v-1",
  titleOverride: "Title",
  subtitleOverride: "Subtitle",
  labelOverride: "Feature Film",
  collectionSize: "61 chapters",
}

describe("enrichMediaItem image resolution", () => {
  it("prefers imageOverrideUrl over imageUrl when both are set", () => {
    const result = enrichMediaItem({
      ...base,
      imageUrl: ADMIN_FALLBACK,
      imageOverrideUrl: ADMIN_OVERRIDE,
    })
    expect(result.imageUrl).toBe(ADMIN_OVERRIDE)
  })

  it("falls back to imageUrl when imageOverrideUrl is null", () => {
    const result = enrichMediaItem({
      ...base,
      imageUrl: ADMIN_FALLBACK,
      imageOverrideUrl: null,
    })
    expect(result.imageUrl).toBe(ADMIN_FALLBACK)
  })

  it("falls back to imageUrl when imageOverrideUrl is an empty string", () => {
    // Admin's editor surface writes "" (not null) when an editor clears
    // the override. Empty string must NOT shadow a valid imageUrl.
    const result = enrichMediaItem({
      ...base,
      imageUrl: ADMIN_FALLBACK,
      imageOverrideUrl: "",
    })
    expect(result.imageUrl).toBe(ADMIN_FALLBACK)
  })

  it("falls back to imageUrl when imageOverrideUrl is omitted (Strapi-shape caller)", () => {
    const result = enrichMediaItem({
      ...base,
      imageUrl: ADMIN_FALLBACK,
    })
    expect(result.imageUrl).toBe(ADMIN_FALLBACK)
  })

  it("returns null when both image sources are missing or empty", () => {
    expect(
      enrichMediaItem({ ...base, imageUrl: null, imageOverrideUrl: null })
        .imageUrl,
    ).toBeNull()
    expect(
      enrichMediaItem({ ...base, imageUrl: "", imageOverrideUrl: "" }).imageUrl,
    ).toBeNull()
  })

  it("returns the override even when imageUrl is empty", () => {
    const result = enrichMediaItem({
      ...base,
      imageUrl: "",
      imageOverrideUrl: ADMIN_OVERRIDE,
    })
    expect(result.imageUrl).toBe(ADMIN_OVERRIDE)
  })
})

describe("enrichMediaItem other fields", () => {
  it("uses overrides for title/subtitle/label/collectionSize", () => {
    const result = enrichMediaItem({
      ...base,
      imageUrl: null,
      imageOverrideUrl: null,
    })
    expect(result.title).toBe("Title")
    expect(result.subtitle).toBe("Subtitle")
    expect(result.label).toBe("Feature Film")
    expect(result.collectionSize).toBe("61 chapters")
  })

  it("defaults to empty string when overrides are null", () => {
    const result = enrichMediaItem({
      videoId: "v-2",
      titleOverride: null,
      subtitleOverride: null,
      labelOverride: null,
      collectionSize: null,
      imageUrl: null,
    })
    expect(result.title).toBe("")
    expect(result.subtitle).toBe("")
    expect(result.label).toBe("")
    expect(result.collectionSize).toBe("")
  })

  it("uses videoId as the id and never populates videoSlug", () => {
    expect(
      enrichMediaItem({ ...base, imageUrl: null, videoId: "v-7" }).id,
    ).toBe("v-7")
    expect(
      enrichMediaItem({ ...base, imageUrl: null, videoId: "v-7" }).videoSlug,
    ).toBe("")
  })
})
