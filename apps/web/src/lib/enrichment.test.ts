import { describe, expect, it } from "vitest"
import { enrichMediaItem, enrichRouteRelatedVideo } from "./enrichment"

const ADMIN_FALLBACK =
  "https://imagedelivery.net/account/abc/mobileCinematicHigh"
const ADMIN_FALLBACK_BLUR = "data:image/jpeg;base64,FALLBACK"
const ADMIN_VIDEO_BLUR = "data:image/jpeg;base64,VIDEO"
const ADMIN_FALLBACK_COLOR = "#112233"
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
  it("uses the image asset preview URL when set", () => {
    const result = enrichMediaItem({
      ...base,
      imageAsset: {
        previewUrl:
          "https://admin.example.test/api/public/media-assets/asset-1/preview",
      },
    })
    expect(result.imageUrl).toBe(
      "https://admin.example.test/api/public/media-assets/asset-1/preview",
    )
  })

  it("returns null when no image asset, local thumbnail, or mux fallback exists", () => {
    expect(enrichMediaItem(base).imageUrl).toBeNull()
  })

  it("falls back to known local watch-home thumbnails by coreId", () => {
    const result = enrichMediaItem({
      ...base,
      coreId: "GOMattCollection",
    })
    expect(result.imageUrl).toBe(
      "/watch/images/thumbnails/GOMattCollection-vertical.png",
    )
  })

  it("adds local watch-home blur data by coreId for demo rendering", () => {
    const result = enrichMediaItem({
      ...base,
      coreId: "GOMattCollection",
    })
    expect(result.blurDataUrl).toMatch(/^data:image\/jpeg;base64,/)
  })

  it("prefers asset image blur data over linked video blur data", () => {
    const result = enrichMediaItem({
      ...base,
      imageAsset: {
        previewUrl: ADMIN_FALLBACK,
        blurDataUrl: ADMIN_FALLBACK_BLUR,
      },
      videoImageBlurDataUrl: ADMIN_VIDEO_BLUR,
    })
    expect(result.blurDataUrl).toBe(ADMIN_FALLBACK_BLUR)
  })

  it("does not pair linked video blur data with an asset image", () => {
    const result = enrichMediaItem({
      ...base,
      imageAsset: {
        previewUrl: ADMIN_FALLBACK,
        blurDataUrl: null,
      },
      videoImageBlurDataUrl: ADMIN_VIDEO_BLUR,
    })
    expect(result.blurDataUrl).toBeNull()
  })

  it("prefers asset image dominant color over linked video dominant color", () => {
    const result = enrichMediaItem({
      ...base,
      imageAsset: {
        previewUrl: ADMIN_FALLBACK,
        dominantColor: ADMIN_FALLBACK_COLOR,
      },
      videoImageDominantColor: ADMIN_VIDEO_COLOR,
    })
    expect(result.dominantColor).toBe(ADMIN_FALLBACK_COLOR)
  })

  it("does not pair linked video dominant color with an asset image", () => {
    const result = enrichMediaItem({
      ...base,
      imageAsset: {
        previewUrl: ADMIN_FALLBACK,
        dominantColor: null,
      },
      videoImageDominantColor: ADMIN_VIDEO_COLOR,
    })
    expect(result.dominantColor).toBeNull()
  })

  it("ignores the generic fallback dominant color", () => {
    const result = enrichMediaItem({
      ...base,
      imageAsset: {
        previewUrl: ADMIN_FALLBACK,
      },
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

  it("ignores generic asset blur data for authored images", () => {
    const result = enrichMediaItem({
      ...base,
      coreId: "GOMattCollection",
      imageAsset: {
        previewUrl: ADMIN_FALLBACK,
        blurDataUrl: GENERIC_ASSET_BLUR,
      },
    })
    expect(result.blurDataUrl).toBeNull()
  })

  it("falls back to a mux thumbnail when no authored or local thumbnail exists", () => {
    const result = enrichMediaItem({
      ...base,
      coreId: "unknown-core-id",
      videoDub: {
        muxVideo: { playbackId: "mux-authored-item" },
      },
    })
    expect(result.imageUrl).toBe(
      "https://image.mux.com/mux-authored-item/thumbnail.jpg",
    )
  })

  it("uses the authored videoDub mux playback id for previews", () => {
    const result = enrichMediaItem({
      ...base,
      videoDub: {
        language: { slug: "spanish-latin-american" },
        muxVideo: { playbackId: "mux-authored-dub" },
      },
    })

    expect(result.muxPlaybackId).toBe("mux-authored-dub")
  })

  it("uses the authored item language slug when no direct dub exists", () => {
    const result = enrichMediaItem({
      ...base,
      videoSlug: "lumo-the-gospel-of-mark",
      languageSlug: "spanish-latin-american",
      videoDub: null,
    })

    expect(result.languageSlug).toBe("spanish-latin-american")
  })

  it("does not use a standalone muxPlaybackId fallback for authored media items", () => {
    const result = enrichMediaItem({
      ...base,
      muxPlaybackId: "mux-page-language-fallback",
    })

    expect(result.muxPlaybackId).toBeNull()
  })
})

describe("enrichMediaItem other fields", () => {
  it("uses the Admin-resolved linked title with authored metadata", () => {
    const result = enrichMediaItem({
      ...base,
      resolvedTitle: "  Linked Video Title  ",
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
    })
    expect(result.title).toBe("")
  })

  it("uses videoId as the id and never populates videoSlug", () => {
    expect(enrichMediaItem({ ...base, videoId: "v-7" }).id).toBe("v-7")
    expect(enrichMediaItem({ ...base, videoId: "v-7" }).videoSlug).toBe("")
  })
})
