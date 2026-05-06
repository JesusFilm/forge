import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "./errors"
import {
  CreateMediaFolderInput,
  DeleteMediaFolderInput,
  ListMediaFoldersInput,
  UpdateMediaFolderInput,
} from "./media-folder.schemas"

export class MediaFolderValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MediaFolderValidationError"
  }
}

export class MediaFolderService {
  constructor(private prisma: PrismaClient) {}

  async list({
    input: raw,
    user,
    query,
  }: {
    input: unknown
    user: Principal | null
    query: object
  }) {
    if (!hasPermission(user, "read:media-assets")) {
      throw new ForbiddenError()
    }

    ListMediaFoldersInput.parse(raw)

    return this.prisma.mediaFolder.findMany({
      ...query,
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
    })
  }

  async create({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    if (!hasPermission(user, "write:media-assets")) {
      throw new ForbiddenError()
    }

    const input = CreateMediaFolderInput.parse(raw)
    await assertParentExists(this.prisma, input.parentId ?? null)
    await assertUniqueFolderName(this.prisma, {
      name: input.name,
      parentId: input.parentId ?? null,
    })
    await assertNoAncestorFolderNameConflict(this.prisma, {
      name: input.name,
      parentId: input.parentId ?? null,
    })

    try {
      return await this.prisma.mediaFolder.create({
        data: {
          name: input.name,
          parentId: input.parentId ?? null,
          createdById: user?.id ?? null,
        },
      })
    } catch (error) {
      throw remapMediaFolderWriteError(error)
    }
  }

  async update({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    if (!hasPermission(user, "write:media-assets")) {
      throw new ForbiddenError()
    }

    const input = UpdateMediaFolderInput.parse(raw)
    const currentFolder = await this.prisma.mediaFolder.findFirst({
      where: { id: input.id },
      select: { name: true, parentId: true },
    })

    if (input.parentId !== undefined) {
      await assertParentExists(this.prisma, input.parentId ?? null)
      await assertNoFolderCycle(this.prisma, {
        folderId: input.id,
        parentId: input.parentId ?? null,
      })
    }

    if (currentFolder) {
      const effectiveName = input.name ?? currentFolder.name
      const effectiveParentId =
        input.parentId !== undefined
          ? (input.parentId ?? null)
          : currentFolder.parentId

      await assertUniqueFolderName(this.prisma, {
        name: effectiveName,
        parentId: effectiveParentId,
        excludeId: input.id,
      })
      await assertNoAncestorFolderNameConflict(this.prisma, {
        name: effectiveName,
        parentId: effectiveParentId,
        excludeId: input.id,
      })
    }

    try {
      return await this.prisma.mediaFolder.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        },
      })
    } catch (error) {
      throw remapMediaFolderWriteError(error)
    }
  }

  async delete({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    if (!hasPermission(user, "delete:media-assets")) {
      throw new ForbiddenError()
    }

    const input = DeleteMediaFolderInput.parse(raw)
    const [childCount, assetCount] = await Promise.all([
      this.prisma.mediaFolder.count({ where: { parentId: input.id } }),
      this.prisma.mediaAsset.count({ where: { folderId: input.id } }),
    ])

    if (childCount > 0) {
      throw new MediaFolderValidationError(
        "Cannot delete a media folder while it still contains child folders",
      )
    }

    if (assetCount > 0) {
      throw new MediaFolderValidationError(
        "Cannot delete a media folder while it still contains assets",
      )
    }

    await this.prisma.mediaFolder.delete({ where: { id: input.id } })
    return { deleted: true as const, childCount, assetCount }
  }
}

function remapMediaFolderWriteError(error: unknown) {
  if (isPrismaKnownRequestError(error) && error.code === "P2002") {
    return new MediaFolderValidationError(
      "A folder with this name already exists in this location",
    )
  }

  return error
}

function isPrismaKnownRequestError(
  error: unknown,
): error is { code: string; name: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "name" in error &&
    error.name === "PrismaClientKnownRequestError"
  )
}

async function assertParentExists(
  prisma: PrismaClient,
  parentId: string | null,
) {
  if (!parentId) {
    return
  }

  const folder = await prisma.mediaFolder.findFirst({
    where: { id: parentId },
    select: { id: true },
  })

  if (!folder) {
    throw new MediaFolderValidationError("Parent media folder not found")
  }
}

async function assertUniqueFolderName(
  prisma: PrismaClient,
  {
    name,
    parentId,
    excludeId,
  }: {
    name: string
    parentId: string | null
    excludeId?: string
  },
) {
  const existing = await prisma.mediaFolder.findFirst({
    where: {
      name,
      parentId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  })

  if (existing) {
    throw new MediaFolderValidationError(
      "A folder with this name already exists in this location",
    )
  }
}

async function assertNoAncestorFolderNameConflict(
  prisma: PrismaClient,
  {
    name,
    parentId,
    excludeId,
  }: {
    name: string
    parentId: string | null
    excludeId?: string
  },
) {
  let currentParentId = parentId

  while (currentParentId) {
    const current = await prisma.mediaFolder.findFirst({
      where: { id: currentParentId },
      select: { id: true, name: true, parentId: true },
    })

    if (!current) {
      return
    }

    if (current.name === name && current.id !== excludeId) {
      throw new MediaFolderValidationError(
        "A folder cannot use the same name as one of its parent folders",
      )
    }

    currentParentId = current.parentId
  }
}

async function assertNoFolderCycle(
  prisma: PrismaClient,
  {
    folderId,
    parentId,
  }: {
    folderId: string
    parentId: string | null
  },
) {
  if (!parentId) {
    return
  }

  if (folderId === parentId) {
    throw new MediaFolderValidationError(
      "A media folder cannot become its own parent",
    )
  }

  let currentParentId: string | null = parentId
  while (currentParentId) {
    if (currentParentId === folderId) {
      throw new MediaFolderValidationError(
        "A media folder cannot be moved into one of its descendants",
      )
    }

    const current: { parentId: string | null } | null =
      await prisma.mediaFolder.findFirst({
        where: { id: currentParentId },
        select: { parentId: true },
      })

    currentParentId = current?.parentId ?? null
  }
}

export type MediaFolderDeleteResult = Awaited<
  ReturnType<MediaFolderService["delete"]>
>
