import { mediaAssetPreviewUrl } from "@/services/media-asset.service"

const DEFAULT_ROOT_LABEL = "Library"

export type MediaLibraryBrowserFolder = {
  id: string
  label: string
  count: number
  directAssetCount: number
  childFolderCount: number
  parentId: string | null
  depth: number
  pathLabel: string
}

export type MediaLibraryBrowserImage = {
  id: string
  displayName: string
  altText: string | null
  mimeType: string
  byteSize: string
  previewUrl: string | null
  updated: string
  folderId: string | null
  pathLabel: string
}

export type MediaLibraryBrowserData = {
  rootLabel: string
  folders: MediaLibraryBrowserFolder[]
  images: MediaLibraryBrowserImage[]
}

type MediaLibraryFolderInput = {
  id: string
  name: string
  parentId: string | null
}

type MediaLibraryImageInput = {
  id: string
  backend: string
  originalFilename: string | null
  mimeType: string
  byteSize: bigint | null
  objectKey: string | null
  previewObjectKey: string | null
  muxPlaybackId: string | null
  updatedAt: Date
  folderId: string | null
  locales: Array<{
    displayName: string | null
    altText: string | null
  }>
}

export function formatMediaLibraryBytes(value: bigint | null) {
  if (value == null) return "N/A"
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return value.toString()
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatMediaLibraryDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(value)
}

export function buildMediaLibraryBrowserData({
  folders,
  images,
  rootLabel = DEFAULT_ROOT_LABEL,
}: {
  folders: MediaLibraryFolderInput[]
  images: MediaLibraryImageInput[]
  rootLabel?: string
}): MediaLibraryBrowserData {
  const directFolderCount = new Map<string | null, number>()
  for (const image of images) {
    directFolderCount.set(
      image.folderId,
      (directFolderCount.get(image.folderId) ?? 0) + 1,
    )
  }

  const foldersByParent = new Map<string | null, MediaLibraryFolderInput[]>()
  for (const folder of folders) {
    const siblings = foldersByParent.get(folder.parentId) ?? []
    siblings.push(folder)
    foldersByParent.set(folder.parentId, siblings)
  }

  const folderPathById = new Map<string, string>()
  const browserFolders: MediaLibraryBrowserFolder[] = []

  function visit(parentId: string | null, depth: number, parentPath: string) {
    const siblings = foldersByParent.get(parentId) ?? []
    for (const folder of siblings) {
      const ownCount = directFolderCount.get(folder.id) ?? 0
      const childFolders = foldersByParent.get(folder.id) ?? []
      const pathLabel = `${parentPath} / ${folder.name}`
      folderPathById.set(folder.id, pathLabel)
      browserFolders.push({
        id: folder.id,
        label: folder.name,
        count: ownCount,
        directAssetCount: ownCount,
        childFolderCount: childFolders.length,
        parentId: folder.parentId,
        depth,
        pathLabel,
      })
      visit(folder.id, depth + 1, pathLabel)
    }
  }

  visit(null, 0, rootLabel)

  return {
    rootLabel,
    folders: browserFolders,
    images: images.map((image) => ({
      id: image.id,
      displayName:
        image.locales[0]?.displayName?.trim() ||
        image.originalFilename ||
        image.id,
      altText: image.locales[0]?.altText ?? null,
      mimeType: image.mimeType,
      byteSize: formatMediaLibraryBytes(image.byteSize),
      previewUrl: mediaAssetPreviewUrl(image),
      updated: formatMediaLibraryDateTime(image.updatedAt),
      folderId: image.folderId,
      pathLabel: image.folderId
        ? (folderPathById.get(image.folderId) ?? rootLabel)
        : rootLabel,
    })),
  }
}
