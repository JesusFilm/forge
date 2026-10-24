import { describe, expect, it } from "vitest"
import { buildMediaLibraryBrowserData } from "./media-library-browser-data"

const baseImage = {
  backend: "LOCAL",
  mimeType: "image/webp",
  byteSize: 12_288n,
  objectKey: "media-assets/asset/original/hero.webp",
  previewObjectKey: null,
  muxPlaybackId: null,
  updatedAt: new Date("2026-07-07T12:34:00.000Z"),
}

describe("buildMediaLibraryBrowserData", () => {
  it("builds folder paths and ready image rows for nested folders", () => {
    const data = buildMediaLibraryBrowserData({
      folders: [
        { id: "folder-parent", name: "Campaigns", parentId: null },
        { id: "folder-child", name: "Easter", parentId: "folder-parent" },
      ],
      images: [
        {
          ...baseImage,
          id: "asset-1",
          originalFilename: "hero.webp",
          objectKey: "media-assets/asset-1/original/hero.webp",
          folderId: "folder-child",
          locales: [{ displayName: "Managed hero", altText: "Hero alt" }],
        },
      ],
    })

    expect(data.rootLabel).toBe("Library")
    expect(data.folders).toEqual([
      {
        id: "folder-parent",
        label: "Campaigns",
        count: 0,
        directAssetCount: 0,
        childFolderCount: 1,
        parentId: null,
        depth: 0,
        pathLabel: "Library / Campaigns",
      },
      {
        id: "folder-child",
        label: "Easter",
        count: 1,
        directAssetCount: 1,
        childFolderCount: 0,
        parentId: "folder-parent",
        depth: 1,
        pathLabel: "Library / Campaigns / Easter",
      },
    ])
    expect(data.images).toMatchObject([
      {
        id: "asset-1",
        displayName: "Managed hero",
        altText: "Hero alt",
        mimeType: "image/webp",
        byteSize: "12.0 KB",
        previewUrl: "/api/media-assets/asset-1/preview",
        folderId: "folder-child",
        pathLabel: "Library / Campaigns / Easter",
      },
    ])
  })

  it("uses the root label for unfiled images", () => {
    const data = buildMediaLibraryBrowserData({
      folders: [],
      images: [
        {
          ...baseImage,
          id: "asset-root",
          originalFilename: "root.webp",
          objectKey: "media-assets/asset-root/original/root.webp",
          folderId: null,
          locales: [{ displayName: null, altText: null }],
        },
      ],
    })

    expect(data.images[0]).toMatchObject({
      id: "asset-root",
      displayName: "root.webp",
      pathLabel: "Library",
    })
  })

  it("falls back to the asset ID when no localized name or filename exists", () => {
    const data = buildMediaLibraryBrowserData({
      folders: [],
      images: [
        {
          ...baseImage,
          id: "asset-id-only",
          originalFilename: null,
          objectKey: "media-assets/asset-id-only/original/image.webp",
          folderId: null,
          locales: [],
        },
      ],
    })

    expect(data.images[0]?.displayName).toBe("asset-id-only")
  })

  it("keeps all provided ready images instead of truncating search scope", () => {
    const images = Array.from({ length: 90 }, (_, index) => ({
      ...baseImage,
      id: `asset-${index + 1}`,
      originalFilename: `image-${index + 1}.webp`,
      objectKey: `media-assets/asset-${index + 1}/original/image.webp`,
      folderId: null,
      locales: [],
    }))

    const data = buildMediaLibraryBrowserData({ folders: [], images })

    expect(data.images).toHaveLength(90)
    expect(data.images.at(-1)?.id).toBe("asset-90")
  })
})
