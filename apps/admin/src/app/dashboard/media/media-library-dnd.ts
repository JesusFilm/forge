import {
  pointerWithin,
  type CollisionDetection,
  type DataRef,
} from "@dnd-kit/core"

export const MEDIA_LIBRARY_DND_ID = "media-library"

export type MediaLibraryFolderDragData = {
  type: "folder"
  folderId: string
}

export type MediaLibraryAssetDragData = {
  type: "asset"
  assetId: string
  title: string
  folderId: string | null
}

type DragDataRecord = Record<string, unknown>

function isDragDataRecord(value: unknown): value is DragDataRecord {
  return typeof value === "object" && value !== null
}

export function getFolderDragData(dataRef: DataRef<unknown> | undefined) {
  const value = dataRef?.current
  if (!isDragDataRecord(value)) {
    return null
  }

  if (value.type !== "folder" || typeof value.folderId !== "string") {
    return null
  }

  return value as MediaLibraryFolderDragData
}

export function getAssetDragData(dataRef: DataRef<unknown> | undefined) {
  const value = dataRef?.current
  if (!isDragDataRecord(value)) {
    return null
  }

  if (
    value.type !== "asset" ||
    typeof value.assetId !== "string" ||
    typeof value.title !== "string" ||
    (value.folderId !== null && typeof value.folderId !== "string")
  ) {
    return null
  }

  return value as MediaLibraryAssetDragData
}

export const mediaLibraryCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id)
  const pointerCollisions = pointerWithin(args).filter(
    (collision) => String(collision.id) !== activeId,
  )
  const nonRootPointerCollisions = pointerCollisions.filter(
    (collision) => collision.id !== "root",
  )

  if (nonRootPointerCollisions.length > 0) {
    return nonRootPointerCollisions
  }

  const rootPointerCollision = pointerCollisions.find(
    (collision) => collision.id === "root",
  )

  if (rootPointerCollision) {
    return [rootPointerCollision]
  }

  return []
}
