import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import {
  MediaFolderService,
  MediaFolderValidationError,
} from "./media-folder.service"

class FakePrismaUniqueError extends Error {
  readonly code = "P2002"

  constructor() {
    super("Unique constraint failed on the fields: (`parent_id`,`name`)")
    this.name = "PrismaClientKnownRequestError"
  }
}

function mockPrisma() {
  return {
    mediaFolder: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    mediaAsset: {
      count: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const EDITOR: Principal = { id: "editor-1", role: "EDITOR" }
const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }

describe("MediaFolderService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: MediaFolderService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new MediaFolderService(prisma)
  })

  it("lists folders for editors", async () => {
    prisma.mediaFolder.findMany.mockResolvedValueOnce([])

    await service.list({ input: {}, user: EDITOR, query: {} })

    expect(prisma.mediaFolder.findMany).toHaveBeenCalledWith({
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
    })
  })

  it("creates a nested folder", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({ id: "parent-1" })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce(null)
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({
      id: "parent-1",
      name: "Library",
      parentId: null,
    })
    prisma.mediaFolder.create.mockResolvedValueOnce({ id: "folder-1" })

    await service.create({
      input: { name: "Campaign", parentId: "parent-1" },
      user: EDITOR,
    })

    expect(prisma.mediaFolder.create).toHaveBeenCalledWith({
      data: {
        name: "Campaign",
        parentId: "parent-1",
        createdById: "editor-1",
      },
    })
  })

  it("rejects missing parent folders", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce(null)

    await expect(
      service.create({
        input: { name: "Campaign", parentId: "missing-parent" },
        user: ADMIN,
      }),
    ).rejects.toThrow("Parent media folder not found")
  })

  it("rejects duplicate root folder names before create", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({ id: "existing-root" })

    await expect(
      service.create({
        input: { name: "Campaign" },
        user: ADMIN,
      }),
    ).rejects.toThrow("already exists")

    expect(prisma.mediaFolder.create).not.toHaveBeenCalled()
  })

  it("rejects creating a folder with the same name as its parent", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({ id: "parent-1" })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce(null)
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({
      id: "parent-1",
      name: "Campaign",
      parentId: null,
    })

    await expect(
      service.create({
        input: { name: "Campaign", parentId: "parent-1" },
        user: ADMIN,
      }),
    ).rejects.toThrow("parent folders")

    expect(prisma.mediaFolder.create).not.toHaveBeenCalled()
  })

  it("remaps duplicate sibling names during create", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce(null)
    prisma.mediaFolder.create.mockRejectedValueOnce(new FakePrismaUniqueError())

    const thrown = await service
      .create({
        input: { name: "Campaign" },
        user: ADMIN,
      })
      .catch((error) => error)

    expect(thrown).toBeInstanceOf(MediaFolderValidationError)
    expect((thrown as Error).message).toContain("already exists")
  })

  it("updates folder names", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({
      name: "Original",
      parentId: null,
    })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce(null)
    prisma.mediaFolder.update.mockResolvedValueOnce({ id: "folder-1" })

    await service.update({
      input: { id: "folder-1", name: "Updated" },
      user: ADMIN,
    })

    expect(prisma.mediaFolder.update).toHaveBeenCalledWith({
      where: { id: "folder-1" },
      data: { name: "Updated" },
    })
  })

  it("remaps duplicate sibling names during update", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({
      name: "Original",
      parentId: null,
    })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce(null)
    prisma.mediaFolder.update.mockRejectedValueOnce(new FakePrismaUniqueError())

    const thrown = await service
      .update({
        input: { id: "folder-1", name: "Updated" },
        user: ADMIN,
      })
      .catch((error) => error)

    expect(thrown).toBeInstanceOf(MediaFolderValidationError)
    expect((thrown as Error).message).toContain("already exists")
  })

  it("moves folders to a new parent", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({
      name: "Folder",
      parentId: null,
    })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({ id: "parent-2" })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({ parentId: null })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce(null)
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({
      id: "parent-2",
      name: "Destination",
      parentId: null,
    })
    prisma.mediaFolder.update.mockResolvedValueOnce({ id: "folder-1" })

    await service.update({
      input: { id: "folder-1", parentId: "parent-2" },
      user: ADMIN,
    })

    expect(prisma.mediaFolder.update).toHaveBeenCalledWith({
      where: { id: "folder-1" },
      data: { parentId: "parent-2" },
    })
  })

  it("rejects moving a folder into itself", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({
      name: "Folder",
      parentId: null,
    })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({ id: "folder-1" })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce(null)

    await expect(
      service.update({
        input: { id: "folder-1", parentId: "folder-1" },
        user: ADMIN,
      }),
    ).rejects.toThrow("own parent")
  })

  it("rejects moving a folder into its descendants", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({
      name: "Folder",
      parentId: null,
    })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({ id: "child-1" })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({ parentId: "folder-1" })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce(null)

    await expect(
      service.update({
        input: { id: "folder-1", parentId: "child-1" },
        user: ADMIN,
      }),
    ).rejects.toThrow("descendants")
  })

  it("rejects duplicate root folder names during update", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({
      name: "Original",
      parentId: null,
    })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({ id: "existing-root" })

    await expect(
      service.update({
        input: { id: "folder-1", name: "Campaign" },
        user: ADMIN,
      }),
    ).rejects.toThrow("already exists")

    expect(prisma.mediaFolder.update).not.toHaveBeenCalled()
  })

  it("rejects renaming a folder to match an ancestor folder", async () => {
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({
      name: "Child",
      parentId: "parent-1",
    })
    prisma.mediaFolder.findFirst.mockResolvedValueOnce(null)
    prisma.mediaFolder.findFirst.mockResolvedValueOnce({
      id: "parent-1",
      name: "Campaign",
      parentId: null,
    })

    await expect(
      service.update({
        input: { id: "folder-1", name: "Campaign" },
        user: ADMIN,
      }),
    ).rejects.toThrow("parent folders")

    expect(prisma.mediaFolder.update).not.toHaveBeenCalled()
  })

  it("refuses to delete folders with children", async () => {
    prisma.mediaFolder.count.mockResolvedValueOnce(1)
    prisma.mediaAsset.count.mockResolvedValueOnce(0)

    await expect(
      service.delete({ input: { id: "folder-1" }, user: ADMIN }),
    ).rejects.toThrow("child folders")
  })

  it("refuses to delete folders with assets", async () => {
    prisma.mediaFolder.count.mockResolvedValueOnce(0)
    prisma.mediaAsset.count.mockResolvedValueOnce(2)

    await expect(
      service.delete({ input: { id: "folder-1" }, user: ADMIN }),
    ).rejects.toThrow("contains assets")
  })

  it("deletes empty folders", async () => {
    prisma.mediaFolder.count.mockResolvedValueOnce(0)
    prisma.mediaAsset.count.mockResolvedValueOnce(0)
    prisma.mediaFolder.delete.mockResolvedValueOnce({ id: "folder-1" })

    const result = await service.delete({
      input: { id: "folder-1" },
      user: ADMIN,
    })

    expect(result).toEqual({ deleted: true, childCount: 0, assetCount: 0 })
    expect(prisma.mediaFolder.delete).toHaveBeenCalledWith({
      where: { id: "folder-1" },
    })
  })

  it("blocks viewers from creating folders", async () => {
    await expect(
      service.create({
        input: { name: "Campaign" },
        user: VIEWER,
      }),
    ).rejects.toThrow("Forbidden")
  })
})
