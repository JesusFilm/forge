import { describe, expect, it } from "vitest"
import { findMediaAssetUsages } from "./media-asset.usage"

describe("findMediaAssetUsages", () => {
  it("finds canonical asset-id references in nested block JSON", () => {
    const matches = findMediaAssetUsages({ assetId: "asset-1" }, [
      {
        id: "loc-1",
        experienceId: "exp-1",
        locale: "en",
        title: "Landing",
        ogImageUrl: null,
        blocks: [
          {
            t: "mediaCollection",
            items: [{ imageAssetId: "asset-1" }],
          },
        ],
      },
    ])

    expect(matches).toEqual([
      expect.objectContaining({
        experienceLocaleId: "loc-1",
        location: "blocks",
        fieldPath: "$.blocks[0].items[0].imageAssetId",
        fieldName: "imageAssetId",
        match: "asset-id",
      }),
    ])
  })

  it("finds legacy URL references in metadata and media fields", () => {
    const matches = findMediaAssetUsages(
      {
        assetId: "asset-1",
        urls: ["/api/media-assets/asset-1/preview"],
      },
      [
        {
          id: "loc-1",
          experienceId: "exp-1",
          locale: "en",
          title: "Landing",
          ogImageUrl: "/api/media-assets/asset-1/preview",
          blocks: [
            { t: "card", mediaUrl: "/api/media-assets/asset-1/preview" },
          ],
        },
      ],
    )

    expect(matches.map((item) => item.fieldPath)).toEqual([
      "$.ogImageUrl",
      "$.blocks[0].mediaUrl",
    ])
    expect(matches.every((item) => item.match === "url")).toBe(true)
  })

  it("matches object keys during the storage transition", () => {
    const matches = findMediaAssetUsages(
      {
        assetId: "asset-1",
        objectKeys: ["media-assets/asset-1/original/hero.webp"],
      },
      [
        {
          id: "loc-1",
          experienceId: "exp-1",
          locale: "en",
          title: "Landing",
          ogImageUrl: null,
          blocks: [
            {
              t: "card",
              mediaUrl: "media-assets/asset-1/original/hero.webp",
            },
          ],
        },
      ],
    )

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      fieldName: "mediaUrl",
      match: "object-key",
    })
  })

  it("ignores unrelated URL-looking fields", () => {
    const matches = findMediaAssetUsages(
      {
        assetId: "asset-1",
        urls: ["https://example.com/hero.webp"],
      },
      [
        {
          id: "loc-1",
          experienceId: "exp-1",
          locale: "en",
          title: "Landing",
          ogImageUrl: null,
          blocks: [{ t: "cta", buttonLink: "https://example.com/hero.webp" }],
        },
      ],
    )

    expect(matches).toEqual([])
  })
})
