type DropCollision = {
  id: string | number
}

type FlatFolderNode = {
  id: string
  depth: number
}

type DropRect = {
  top: number
  right: number
  bottom: number
  left: number
}

export function isDescendantFolderTarget({
  folders,
  folderId,
  parentId,
}: {
  folders: FlatFolderNode[]
  folderId: string
  parentId: string | null
}) {
  if (!parentId) {
    return false
  }

  if (parentId === folderId) {
    return true
  }

  const sourceIndex = folders.findIndex((folder) => folder.id === folderId)
  if (sourceIndex === -1) {
    return false
  }

  const sourceDepth = folders[sourceIndex]!.depth

  for (let index = sourceIndex + 1; index < folders.length; index += 1) {
    const folder = folders[index]!
    if (folder.depth <= sourceDepth) {
      break
    }

    if (folder.id === parentId) {
      return true
    }
  }

  return false
}

export function resolveFolderDropTarget({
  overId,
  collisions,
  persistedRootTarget,
  activeRect,
  rootRect,
}: {
  overId: string | null
  collisions: DropCollision[] | null
  persistedRootTarget?: string | null
  activeRect?: DropRect | null
  rootRect?: DropRect | null
}) {
  if (
    intersectsRootDropZone({
      activeRect: activeRect ?? null,
      rootRect: rootRect ?? null,
    })
  ) {
    return "root"
  }

  if (overId) {
    return overId
  }

  const collisionId = collisions?.[0]?.id
  if (collisionId !== undefined && collisionId !== null) {
    return String(collisionId)
  }

  return persistedRootTarget === "root" ? "root" : null
}

export function intersectsRootDropZone({
  activeRect,
  rootRect,
}: {
  activeRect: DropRect | null
  rootRect: DropRect | null
}) {
  if (!activeRect || !rootRect) {
    return false
  }

  return (
    activeRect.left < rootRect.right &&
    activeRect.right > rootRect.left &&
    activeRect.top < rootRect.bottom &&
    activeRect.bottom > rootRect.top
  )
}

export function persistRootDropTarget({
  overId,
  collisions,
}: {
  overId: string | null
  collisions: DropCollision[] | null
}) {
  const collisionId = collisions?.[0]?.id
  const resolvedId =
    overId ??
    (collisionId !== undefined && collisionId !== null
      ? String(collisionId)
      : null)

  return resolvedId === "root" ? "root" : null
}
