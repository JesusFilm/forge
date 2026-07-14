import { describe, expect, it } from "vitest"
import { flattenSmartCropPickerVideos } from "./smart-crop-picker"

describe("flattenSmartCropPickerVideos", () => {
  it("keeps source videos while dropping collection and series groups", () => {
    expect(
      flattenSmartCropPickerVideos({
        collections: [
          {
            id: "nua-series",
            coreId: "7_KnowGod",
            title: "Know God",
            slug: "Nua_Know_God",
            imageUrl: null,
            label: "SERIES",
            videos: [
              {
                id: "nua-easter-trailer",
                coreId: "7_0-EasterTrailer",
                title: "NUA Easter Trailer",
                slug: "nua-easter-trailer",
                imageUrl: "https://example.test/trailer.jpg",
                label: "EPISODE",
              },
              {
                id: "nua-fresh-perspective",
                coreId: "Nua",
                title: "NUA Fresh Perspective",
                slug: "nua-fresh-perspective",
                imageUrl: null,
                label: "COLLECTION",
              },
            ],
          },
        ],
        standalone: [
          {
            id: "standalone-short",
            coreId: "short-1",
            title: "Standalone Short",
            slug: "standalone-short",
            imageUrl: null,
            label: "shortFilm",
          },
          {
            id: "standalone-series",
            coreId: "series-1",
            title: "Standalone Series",
            slug: "standalone-series",
            imageUrl: null,
            label: "series",
          },
        ],
      }).map((video) => video.id),
    ).toEqual(["nua-easter-trailer", "standalone-short"])
  })

  it("deduplicates videos already present in a collection", () => {
    expect(
      flattenSmartCropPickerVideos({
        collections: [
          {
            id: "collection-1",
            coreId: "collection-core",
            title: "Collection",
            slug: "collection",
            imageUrl: null,
            label: "collection",
            videos: [
              {
                id: "video-1",
                coreId: "video-core",
                title: "Video",
                slug: "video",
                imageUrl: null,
                label: "episode",
              },
            ],
          },
        ],
        standalone: [
          {
            id: "video-1",
            coreId: "video-core",
            title: "Video",
            slug: "video",
            imageUrl: null,
            label: "episode",
          },
        ],
      }),
    ).toEqual([
      {
        id: "video-1",
        coreId: "video-core",
        title: "Video",
        slug: "video",
        imageUrl: null,
        label: "episode",
      },
    ])
  })
})
