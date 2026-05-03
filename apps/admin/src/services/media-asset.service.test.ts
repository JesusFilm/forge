import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Principal } from "@/auth/principal"
import {
  MediaAssetService,
  mediaAssetDownloadUrl,
  mediaAssetPreviewUrl,
} from "./media-asset.service"

function mockPrisma() {
  return {
    mediaAsset: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    mediaFolder: {
      findFirst: vi.fn(),
    },
    experienceLocale: {
      findMany: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const EDITOR: Principal = { id: "editor-1", role: "EDITOR" }
const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const PUBLIC_USER: Principal | null = null

describe("MediaAssetService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: MediaAssetService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new MediaAssetService(prisma)
  })

  describe("list", () => {
    it("EDITOR can list media assets with filters", async () => {
      prisma.mediaAsset.findMany.mockResolvedValueOnce([])

      await service.list({
        input: {
          kind: "IMAGE",
          status: "READY",
          search: "hero",
          folderId: "folder-1",
        },
        user: EDITOR,
        query: {},
      })

      const call = prisma.mediaAsset.findMany.mock.calls[0][0]
      expect(call.where).toMatchObject({
        kind: "IMAGE",
        status: "READY",
        folderId: "folder-1",
      })
      expect(call.where.OR).toHaveLength(3)
    })

    it("VIEWER cannot list media assets", async () => {
      await expect(
        service.list({ input: {}, user: VIEWER, query: {} }),
      ).rejects.toThrow("Forbidden")
    })

    it("clamps limit to 200", async () => {
      prisma.mediaAsset.findMany.mockResolvedValueOnce([])

      await service.list({
        input: { limit: 500 },
        user: ADMIN,
        query: {},
      })

      expect(prisma.mediaAsset.findMany.mock.calls[0][0].take).toBe(200)
    })
  })

  describe("getById", () => {
    it("EDITOR can get an asset by id", async () => {
      prisma.mediaAsset.findFirst.mockResolvedValueOnce({ id: "asset-1" })

      const result = await service.getById({
        id: "asset-1",
        user: EDITOR,
        query: {},
      })

      expect(result).toEqual({ id: "asset-1" })
      expect(prisma.mediaAsset.findFirst.mock.calls[0][0].where).toEqual({
        id: "asset-1",
      })
    })

    it("PUBLIC cannot read an asset", async () => {
      await expect(
        service.getById({ id: "asset-1", user: PUBLIC_USER, query: {} }),
      ).rejects.toThrow("Forbidden")
    })
  })

  describe("create", () => {
    it("EDITOR can register an image asset", async () => {
      prisma.mediaFolder.findFirst.mockResolvedValueOnce({ id: "folder-1" })
      prisma.mediaAsset.create.mockResolvedValueOnce({ id: "asset-1" })

      await service.create({
        input: {
          kind: "IMAGE",
          displayName: "Hero image",
          mimeType: "image/webp",
          byteSize: "12345",
          folderId: "folder-1",
          objectKey: "media-assets/asset-1/original/hero.webp",
        },
        user: EDITOR,
      })

      expect(prisma.mediaAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: "IMAGE",
            backend: "LOCAL",
            status: "READY",
            visibility: "PRIVATE",
            createdById: "editor-1",
            folderId: "folder-1",
            byteSize: 12345n,
          }),
        }),
      )
    })

    it("rejects an unknown folder id on create", async () => {
      prisma.mediaFolder.findFirst.mockResolvedValueOnce(null)

      await expect(
        service.create({
          input: {
            kind: "IMAGE",
            displayName: "Hero image",
            mimeType: "image/webp",
            folderId: "missing-folder",
          },
          user: EDITOR,
        }),
      ).rejects.toThrow("Media folder not found")
    })

    it("rejects a mismatched MIME type", async () => {
      await expect(
        service.create({
          input: {
            kind: "IMAGE",
            displayName: "Not an image",
            mimeType: "application/pdf",
          },
          user: EDITOR,
        }),
      ).rejects.toThrow("does not match media kind")
    })

    it("rejects unsafe storage object keys on create", async () => {
      await expect(
        service.create({
          input: {
            kind: "IMAGE",
            displayName: "Hero image",
            mimeType: "image/webp",
            objectKey: "../secret",
          },
          user: EDITOR,
        }),
      ).rejects.toThrow("Invalid media object key")
    })

    it("requires Mux assets to be videos with Mux metadata", async () => {
      await expect(
        service.create({
          input: {
            kind: "PDF",
            backend: "MUX",
            displayName: "PDF",
            mimeType: "application/pdf",
          },
          user: EDITOR,
        }),
      ).rejects.toThrow("Mux media assets must be videos")
    })

    it("VIEWER cannot create media assets", async () => {
      await expect(
        service.create({
          input: {
            kind: "PDF",
            displayName: "Doc",
            mimeType: "application/pdf",
          },
          user: VIEWER,
        }),
      ).rejects.toThrow("Forbidden")
    })
  })

  describe("update", () => {
    it("ADMIN can update asset metadata", async () => {
      prisma.mediaFolder.findFirst.mockResolvedValueOnce({ id: "folder-2" })
      prisma.mediaAsset.update.mockResolvedValueOnce({ id: "asset-1" })

      await service.update({
        input: {
          id: "asset-1",
          displayName: "Updated",
          altText: "A clear alt text",
          folderId: "folder-2",
        },
        user: ADMIN,
      })

      expect(prisma.mediaAsset.update).toHaveBeenCalledWith({
        where: { id: "asset-1" },
        data: {
          displayName: "Updated",
          altText: "A clear alt text",
          folderId: "folder-2",
        },
      })
    })

    it("rejects unsafe storage object keys on update", async () => {
      await expect(
        service.update({
          input: {
            id: "asset-1",
            previewObjectKey: "media-assets/asset-1/preview/../../secret",
          },
          user: ADMIN,
        }),
      ).rejects.toThrow("Invalid media object key")
      expect(prisma.mediaAsset.update).not.toHaveBeenCalled()
    })
  })

  describe("URL helpers", () => {
    it("returns stable app routes for local/S3 assets", () => {
      const asset = {
        id: "asset-1",
        backend: "LOCAL",
        objectKey: "media-assets/asset-1/original/hero.webp",
        previewObjectKey: null,
        muxPlaybackId: null,
      }

      expect(mediaAssetPreviewUrl(asset)).toBe(
        "/api/media-assets/asset-1/preview",
      )
      expect(mediaAssetDownloadUrl(asset)).toBe(
        "/api/media-assets/asset-1/download",
      )
    })

    it("returns Mux thumbnail URLs for Mux video previews", () => {
      expect(
        mediaAssetPreviewUrl({
          id: "asset-1",
          backend: "MUX",
          objectKey: null,
          previewObjectKey: null,
          muxPlaybackId: "playback-1",
        }),
      ).toBe("https://image.mux.com/playback-1/thumbnail.jpg")
    })
  })

  describe("usage", () => {
    it("scans experience locale metadata and blocks for asset usage", async () => {
      prisma.mediaAsset.findFirst.mockResolvedValueOnce({
        id: "asset-1",
        backend: "LOCAL",
        objectKey: "media-assets/asset-1/original/hero.webp",
        previewObjectKey: null,
        muxPlaybackId: null,
      })
      prisma.experienceLocale.findMany.mockResolvedValueOnce([
        {
          id: "loc-1",
          experienceId: "exp-1",
          locale: "en",
          title: "Landing",
          ogImageUrl: null,
          blocks: [
            {
              t: "cta",
              imageUrl: "media-assets/asset-1/original/hero.webp",
            },
          ],
        },
      ])

      const result = await service.usage({ id: "asset-1", user: EDITOR })

      expect(result).toEqual([
        expect.objectContaining({
          experienceLocaleId: "loc-1",
          fieldPath: "$.blocks[0].imageUrl",
          match: "object-key",
        }),
      ])
    })

    it("VIEWER cannot inspect media usage", async () => {
      await expect(
        service.usage({ id: "asset-1", user: VIEWER }),
      ).rejects.toThrow("Forbidden")
    })
  })

  describe("delete", () => {
    it("ADMIN can delete an unused media asset", async () => {
      prisma.mediaAsset.findFirst.mockResolvedValueOnce({
        id: "asset-1",
        backend: "LOCAL",
        objectKey: null,
        previewObjectKey: null,
        muxPlaybackId: null,
      })
      prisma.experienceLocale.findMany.mockResolvedValueOnce([])
      prisma.mediaAsset.delete.mockResolvedValueOnce({ id: "asset-1" })

      const result = await service.delete({ id: "asset-1", user: ADMIN })

      expect(result).toEqual({ deleted: true, usageCount: 0 })
      expect(prisma.mediaAsset.delete).toHaveBeenCalledWith({
        where: { id: "asset-1" },
      })
    })

    it("refuses to delete an asset while usage exists", async () => {
      prisma.mediaAsset.findFirst.mockResolvedValueOnce({
        id: "asset-1",
        backend: "LOCAL",
        objectKey: "media-assets/asset-1/original/hero.webp",
        previewObjectKey: null,
        muxPlaybackId: null,
      })
      prisma.experienceLocale.findMany.mockResolvedValueOnce([
        {
          id: "loc-1",
          experienceId: "exp-1",
          locale: "en",
          title: "Landing",
          ogImageUrl: null,
          blocks: [
            {
              t: "cta",
              imageUrl: "media-assets/asset-1/original/hero.webp",
            },
          ],
        },
      ])

      await expect(
        service.delete({ id: "asset-1", user: ADMIN }),
      ).rejects.toThrow("still used")
      expect(prisma.mediaAsset.delete).not.toHaveBeenCalled()
    })

    it("EDITOR cannot delete media assets", async () => {
      await expect(
        service.delete({ id: "asset-1", user: EDITOR }),
      ).rejects.toThrow("Forbidden")
    })
  })
})
