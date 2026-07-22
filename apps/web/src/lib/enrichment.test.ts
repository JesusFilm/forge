import { describe, expect, it } from "vitest"
import { enrichMediaItem, enrichRouteRelatedVideo } from "./enrichment"

const ADMIN_FALLBACK =
  "https://imagedelivery.net/account/abc/mobileCinematicHigh"
const ADMIN_OVERRIDE = "https://example.org/images/override.png"
const ADMIN_FALLBACK_BLUR = "data:image/jpeg;base64,FALLBACK"
const ADMIN_OVERRIDE_BLUR = "data:image/jpeg;base64,OVERRIDE"
const ADMIN_VIDEO_BLUR = "data:image/jpeg;base64,VIDEO"
const ADMIN_FALLBACK_COLOR = "#112233"
const ADMIN_OVERRIDE_COLOR = "#445566"
const ADMIN_VIDEO_COLOR = "#778899"
const GENERIC_ASSET_BLUR =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIHZpZXdCb3g9IjAgMCA4IDgiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiMxMTE4MjciLz48L3N2Zz4="

const base = {
  videoId: "v-1",
  resolvedTitle: "Title",
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

  it("falls back to known local watch-home thumbnails by coreId", () => {
    const result = enrichMediaItem({
      ...base,
      coreId: "GOMattCollection",
      imageUrl: null,
      imageOverrideUrl: null,
    })
    expect(result.imageUrl).toBe(
      "/watch/images/thumbnails/GOMattCollection-vertical.png",
    )
  })

  it("adds local watch-home blur data by coreId for demo rendering", () => {
    const result = enrichMediaItem({
      ...base,
      coreId: "GOMattCollection",
      imageUrl: null,
      imageOverrideUrl: null,
    })
    expect(result.blurDataUrl).toMatch(/^data:image\/jpeg;base64,/)
  })

  it("prefers override asset blur data over linked video blur data", () => {
    const result = enrichMediaItem({
      ...base,
      imageUrl: ADMIN_FALLBACK,
      videoImageBlurDataUrl: ADMIN_VIDEO_BLUR,
      imageBlurDataUrl: ADMIN_FALLBACK_BLUR,
      imageOverrideUrl: ADMIN_OVERRIDE,
      imageOverrideBlurDataUrl: ADMIN_OVERRIDE_BLUR,
    })
    expect(result.blurDataUrl).toBe(ADMIN_OVERRIDE_BLUR)
  })

  it("does not use linked video blur data for override images without override blur data", () => {
    const result = enrichMediaItem({
      ...base,
      imageUrl: ADMIN_FALLBACK,
      videoImageBlurDataUrl: ADMIN_VIDEO_BLUR,
      imageBlurDataUrl: ADMIN_FALLBACK_BLUR,
      imageOverrideUrl: ADMIN_OVERRIDE,
      imageOverrideBlurDataUrl: null,
    })
    expect(result.blurDataUrl).toBeNull()
  })

  it("prefers override asset dominant color over linked video dominant color", () => {
    const result = enrichMediaItem({
      ...base,
      imageUrl: ADMIN_FALLBACK,
      videoImageDominantColor: ADMIN_VIDEO_COLOR,
      imageDominantColor: ADMIN_FALLBACK_COLOR,
      imageOverrideUrl: ADMIN_OVERRIDE,
      imageOverrideDominantColor: ADMIN_OVERRIDE_COLOR,
    })
    expect(result.dominantColor).toBe(ADMIN_OVERRIDE_COLOR)
  })

  it("does not use linked video dominant color for override images without override color", () => {
    const result = enrichMediaItem({
      ...base,
      imageUrl: ADMIN_FALLBACK,
      videoImageDominantColor: ADMIN_VIDEO_COLOR,
      imageDominantColor: ADMIN_FALLBACK_COLOR,
      imageOverrideUrl: ADMIN_OVERRIDE,
      imageOverrideDominantColor: null,
    })
    expect(result.dominantColor).toBeNull()
  })

  it("ignores the generic fallback dominant color", () => {
    const result = enrichMediaItem({
      ...base,
      imageUrl: ADMIN_FALLBACK,
      videoImageDominantColor: "#111827",
    })
    expect(result.dominantColor).toBeNull()
  })

  it("carries route related image blur and dominant color metadata", () => {
    const item = enrichRouteRelatedVideo({
      documentId: "route-video-1",
      title: "Route Video",
      slug: "route-video",
      label: "Episode",
      muxPlaybackId: "mux-route",
      images: [
        {
          url: "https://cdn.example/route.jpg",
          blurDataUrl: ADMIN_VIDEO_BLUR,
          dominantColor: ADMIN_VIDEO_COLOR,
        },
      ],
    })

    expect(item).toMatchObject({
      imageUrl: "https://cdn.example/route.jpg",
      blurDataUrl: ADMIN_VIDEO_BLUR,
      dominantColor: ADMIN_VIDEO_COLOR,
    })
  })

  it("ignores generic asset blur data and falls back to local watch-home blur data", () => {
    const result = enrichMediaItem({
      ...base,
      coreId: "GOMattCollection",
      imageUrl: ADMIN_FALLBACK,
      imageOverrideBlurDataUrl: GENERIC_ASSET_BLUR,
    })
    expect(result.blurDataUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(result.blurDataUrl).not.toBe(GENERIC_ASSET_BLUR)
  })

  it("falls back to a mux thumbnail when no authored or local thumbnail exists", () => {
    const result = enrichMediaItem({
      ...base,
      coreId: "unknown-core-id",
      muxPlaybackId: "mux-authored-item",
      imageUrl: null,
      imageOverrideUrl: null,
    })
    expect(result.imageUrl).toBe(
      "https://image.mux.com/mux-authored-item/thumbnail.jpg",
    )
  })
})

describe("enrichMediaItem other fields", () => {
  it("uses the Admin-resolved linked title with authored metadata", () => {
    const result = enrichMediaItem({
      ...base,
      resolvedTitle: "  Linked Video Title  ",
      imageUrl: null,
      imageOverrideUrl: null,
    })
    expect(result.title).toBe("Linked Video Title")
    expect(result.subtitle).toBe("Subtitle")
    expect(result.label).toBe("Feature Film")
    expect(result.collectionSize).toBe("61 chapters")
  })

  it.each([null, "", "   "])(
    "leaves the title empty when resolvedTitle is %j",
    (resolvedTitle) => {
      const result = enrichMediaItem({
        videoId: "v-2",
        resolvedTitle,
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
    },
  )

  it("does not reconstruct title precedence from titleOverride", () => {
    const result = enrichMediaItem({
      videoId: "v-2",
      resolvedTitle: null,
      titleOverride: "Client-side fallback",
      subtitleOverride: null,
      labelOverride: null,
      collectionSize: null,
      imageUrl: null,
    })
    expect(result.title).toBe("")
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
