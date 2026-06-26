import { describe, expect, it } from "vitest"
import { flattenPickerVideos } from "./shorts-picker"

describe("flattenPickerVideos", () => {
  it("keeps source videos while dropping collection groups", () => {
    expect(
      flattenPickerVideos({
        collections: [
          {
            id: "nua-series",
            title: "NUA",
            imageUrl: null,
            label: "SERIES",
            videos: [
              {
                id: "nua-easter-trailer",
                title: "NUA Easter Trailer",
                slug: "nua-easter-trailer",
                imageUrl: "https://example.test/trailer.jpg",
                label: "EPISODE",
              },
              {
                id: "nua-collection",
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
            id: "standalone-video",
            title: "Standalone Video",
            slug: "standalone-video",
            imageUrl: null,
            label: "shortFilm",
          },
          {
            id: "standalone-collection",
            title: "Standalone Collection",
            slug: "standalone-collection",
            imageUrl: null,
            label: "collection",
          },
        ],
      }).map((video) => video.id),
    ).toEqual(["nua-easter-trailer", "standalone-video"])
  })

  it("deduplicates videos already present in a collection", () => {
    expect(
      flattenPickerVideos({
        collections: [
          {
            id: "collection-1",
            title: "Collection",
            imageUrl: null,
            label: "collection",
            videos: [
              {
                id: "video-1",
                title: "Video",
                slug: "video-slug",
                imageUrl: null,
                label: "episode",
              },
            ],
          },
        ],
        standalone: [
          {
            id: "video-1",
            title: "Video",
            slug: "video-slug",
            imageUrl: null,
            label: "episode",
          },
        ],
      }),
    ).toEqual([
      {
        id: "video-1",
        title: "Video",
        slug: "video-slug",
        imageUrl: null,
        label: "episode",
      },
    ])
  })
})
