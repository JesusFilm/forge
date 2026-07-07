import { revalidatePath } from "next/cache"
import type { Route } from "next"
import Link from "next/link"
import { Fragment } from "react"
import { start } from "workflow/api"
import { Upload } from "lucide-react"
import { cx } from "@/components/admin-ui"
import { MediaAssetDropTarget } from "@/app/dashboard/media/media-asset-drop-target"
import { MediaAssetInspector } from "@/app/dashboard/media/media-asset-inspector"
import { MediaActions } from "@/app/dashboard/media/media-actions"
import { MediaAssetTable } from "@/app/dashboard/media/media-asset-table"
import { MediaFolderInspector } from "@/app/dashboard/media/media-folder-inspector"
import { MediaLibraryDndProvider } from "@/app/dashboard/media/media-library-dnd-provider"
import { MediaFolderTree } from "@/app/dashboard/media/folder-tree"
import { MediaLibraryToolbar } from "@/app/dashboard/media/media-library-toolbar"
import { uploadMediaAssetFromFormData } from "@/app/dashboard/media/upload-media-asset-action"
import { hasPermission } from "@/auth/permissions"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import { requireSession } from "@/auth/session"
import { prisma } from "@/db/client"
import { loadMediaData } from "@/app/dashboard/ops-data"
import { createServices } from "@/services"
import { ForbiddenError } from "@/services/errors"
import {
  mediaAssetDownloadUrl,
  mediaAssetPreviewUrl,
  MediaAssetValidationError,
} from "@/services/media-asset.service"
import { MediaFolderValidationError } from "@/services/media-folder.service"
import { runMediaImageEnrichment } from "@/workflows/mediaImageEnrichment"

type CreateFolderActionResult =
  | { ok: true; id: string }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type RenameFolderActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type RenameAssetActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type MoveAssetActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type DeleteAssetActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type UpdateAssetLocaleActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type RetryImageEnrichmentActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type DeleteFolderActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type MediaPageProps = {
  searchParams?: Promise<{
    folder?: string
    asset?: string
    q?: string
    type?: string
    sort?: string
    dir?: string
  }>
}

type SupportedMediaKind = "IMAGE" | "VIDEO" | "PDF" | "FILE"
type MediaSortField = "name" | "size" | "updated"
type SortDirection = "asc" | "desc"
const mediaNameCollator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
})

function defaultDirectionForSort(sort: MediaSortField): SortDirection {
  return sort === "name" ? "asc" : "desc"
}

function mediaSupplementalLabel(
  displayName: string,
  originalFilename: string | null,
  mimeType: string,
) {
  if (!originalFilename) {
    return mimeType
  }

  const normalizedDisplayName = displayName.trim().toLowerCase()
  const normalizedFilename = originalFilename.trim().toLowerCase()
  const normalizedFilenameStem = normalizedFilename.replace(/\.[^.]+$/, "")

  if (
    normalizedDisplayName === normalizedFilename ||
    normalizedDisplayName === normalizedFilenameStem
  ) {
    return ""
  }

  return originalFilename
}

function mediaLibraryQueryString(values: {
  folder?: string | null
  asset?: string | null
  q?: string
  type?: "all" | SupportedMediaKind
  sort?: MediaSortField
  direction?: SortDirection
}) {
  const query = new URLSearchParams()
  if (values.folder) {
    query.set("folder", values.folder)
  }
  if (values.asset) {
    query.set("asset", values.asset)
  }
  if (values.q?.trim()) {
    query.set("q", values.q.trim())
  }
  if (values.type && values.type !== "all") {
    query.set("type", values.type)
  }
  if (
    values.sort &&
    (values.sort !== "name" || (values.direction ?? "asc") !== "asc")
  ) {
    query.set("sort", values.sort)
    query.set("dir", values.direction ?? defaultDirectionForSort(values.sort))
  }
  return query.toString()
}

function compareNullableBigInt(left: bigint | null, right: bigint | null) {
  if (left == null && right == null) {
    return 0
  }
  if (left == null) {
    return 1
  }
  if (right == null) {
    return -1
  }
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

function compareMediaRowsByName(
  left: { title: string; detail: string },
  right: { title: string; detail: string },
) {
  const byTitle = mediaNameCollator.compare(left.title, right.title)
  if (byTitle !== 0) {
    return byTitle
  }

  return mediaNameCollator.compare(left.detail, right.detail)
}

function compareMediaRows(
  left: {
    title: string
    detail: string
    byteSizeValue: bigint | null
    updatedAtValue: Date
  },
  right: {
    title: string
    detail: string
    byteSizeValue: bigint | null
    updatedAtValue: Date
  },
  sort: MediaSortField,
  direction: SortDirection,
) {
  const directionMultiplier = direction === "asc" ? 1 : -1

  const comparison =
    sort === "size"
      ? compareNullableBigInt(left.byteSizeValue, right.byteSizeValue)
      : sort === "updated"
        ? left.updatedAtValue.getTime() - right.updatedAtValue.getTime()
        : compareMediaRowsByName(left, right)

  if (comparison !== 0) {
    return comparison * directionMultiplier
  }

  return compareMediaRowsByName(left, right)
}

async function performRenameMediaFolder(
  formData: FormData,
): Promise<RenameFolderActionResult> {
  const user = await requireSession()
  const services = createServices(prisma)
  const id = String(formData.get("id") ?? "").trim()
  const name = String(formData.get("name") ?? "").trim()

  if (!id || !name) {
    return {
      ok: false as const,
      error: "validation" as const,
      message: "Name the folder before renaming it.",
    }
  }

  try {
    await services.mediaFolder.update({
      input: { id, name },
      user,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return {
        ok: false as const,
        error: "forbidden" as const,
        message: "Your account cannot rename media folders.",
      }
    }

    if (error instanceof MediaFolderValidationError) {
      return {
        ok: false as const,
        error: "validation" as const,
        message: error.message,
      }
    }

    return {
      ok: false as const,
      error: "unknown" as const,
      message: "We couldn't rename that folder just now.",
    }
  }

  revalidatePath("/dashboard/media")
  return { ok: true as const }
}

async function performRenameMediaAsset(
  formData: FormData,
): Promise<RenameAssetActionResult> {
  const user = await requireSession()
  const services = createServices(prisma)
  const id = String(formData.get("id") ?? "").trim()
  const displayName = String(formData.get("displayName") ?? "").trim()

  if (!id || !displayName) {
    return {
      ok: false as const,
      error: "validation" as const,
      message: "Name the file before renaming it.",
    }
  }

  try {
    await services.mediaAsset.updateImageLocale({
      input: { mediaAssetId: id, locale: "en", displayName },
      user,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return {
        ok: false as const,
        error: "forbidden" as const,
        message: "Your account cannot rename media assets.",
      }
    }

    if (error instanceof MediaAssetValidationError) {
      return {
        ok: false as const,
        error: "validation" as const,
        message: error.message,
      }
    }

    return {
      ok: false as const,
      error: "unknown" as const,
      message: "We couldn't rename that file just now.",
    }
  }

  revalidatePath("/dashboard/media")
  return { ok: true as const }
}

async function performDeleteMediaAsset(
  formData: FormData,
): Promise<DeleteAssetActionResult> {
  const user = await requireSession()
  const services = createServices(prisma)
  const id = String(formData.get("id") ?? "").trim()

  if (!id) {
    return {
      ok: false as const,
      error: "validation" as const,
      message: "Choose a file before deleting it.",
    }
  }

  try {
    await services.mediaAsset.delete({ id, user })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return {
        ok: false as const,
        error: "forbidden" as const,
        message: "Your account cannot delete media assets.",
      }
    }

    if (error instanceof MediaAssetValidationError) {
      return {
        ok: false as const,
        error: "validation" as const,
        message: error.message,
      }
    }

    return {
      ok: false as const,
      error: "unknown" as const,
      message: "We couldn't delete that asset just now.",
    }
  }

  revalidatePath("/dashboard/media")
  return { ok: true as const }
}

async function performDeleteMediaFolder(
  formData: FormData,
): Promise<DeleteFolderActionResult> {
  const user = await requireSession()
  const services = createServices(prisma)
  const id = String(formData.get("id") ?? "").trim()

  if (!id) {
    return {
      ok: false as const,
      error: "validation" as const,
      message: "Choose a folder before deleting it.",
    }
  }

  try {
    await services.mediaFolder.delete({
      input: { id },
      user,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return {
        ok: false as const,
        error: "forbidden" as const,
        message: "Your account cannot delete media folders.",
      }
    }

    if (error instanceof MediaFolderValidationError) {
      return {
        ok: false as const,
        error: "validation" as const,
        message: error.message,
      }
    }

    return {
      ok: false as const,
      error: "unknown" as const,
      message: "We couldn't delete that folder just now.",
    }
  }

  revalidatePath("/dashboard/media")
  return { ok: true as const }
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(value)
}

export default async function MediaPage({ searchParams }: MediaPageProps) {
  const principal = await requireSession()
  const params = (await searchParams) ?? {}
  const services = createServices(prisma)
  const canUpload = hasPermission(principal, "write:media-assets")
  const data = await loadMediaData(principal)
  const folderById = new Map(data.folders.map((folder) => [folder.id, folder]))
  const selectedFolderValue =
    params.folder && folderById.has(params.folder) ? params.folder : null
  const selectedFolder = selectedFolderValue
    ? (folderById.get(selectedFolderValue) ?? null)
    : null
  const queryText = params.q?.trim() ?? ""
  const normalizedQuery = queryText.toLowerCase()
  const selectedType: "all" | SupportedMediaKind =
    params.type === "IMAGE" ||
    params.type === "VIDEO" ||
    params.type === "PDF" ||
    params.type === "FILE"
      ? params.type
      : "all"
  const selectedSort: MediaSortField =
    params.sort === "size" || params.sort === "updated" ? params.sort : "name"
  const selectedDirection: SortDirection =
    params.dir === "asc" || params.dir === "desc"
      ? params.dir
      : defaultDirectionForSort(selectedSort)
  const isSearching = normalizedQuery.length > 0
  const rootFolderLabel = "Library"
  function folderPathLabel(folderId: string | null) {
    if (!folderId) {
      return rootFolderLabel
    }

    const segments: string[] = []
    let currentFolderId: string | null = folderId

    while (currentFolderId) {
      const folder = folderById.get(currentFolderId)
      if (!folder) {
        break
      }

      segments.unshift(folder.label)
      currentFolderId = folder.parentId
    }

    return [rootFolderLabel, ...segments].join(" / ")
  }

  function folderHref(folderId: string | null) {
    const query = mediaLibraryQueryString({
      folder: folderId,
      q: queryText,
      type: selectedType,
      sort: selectedSort,
      direction: selectedDirection,
    })

    return `/dashboard/media${query ? `?${query}` : ""}` as Route
  }
  const currentPathSegments = (() => {
    if (!selectedFolder) {
      return [{ label: rootFolderLabel, href: folderHref(null) }]
    }

    const segments = [
      { label: selectedFolder.label, href: folderHref(selectedFolder.id) },
    ]
    let currentParentId = selectedFolder.parentId

    while (currentParentId) {
      const parent = folderById.get(currentParentId)
      if (!parent) {
        break
      }

      segments.unshift({
        label: parent.label,
        href: folderHref(parent.id),
      })
      currentParentId = parent.parentId
    }

    return [{ label: rootFolderLabel, href: folderHref(null) }, ...segments]
  })()
  const searchableFolderIds = (() => {
    if (!selectedFolderValue) {
      return null
    }

    const next = new Set<string>([selectedFolderValue])
    const queue = [selectedFolderValue]

    while (queue.length > 0) {
      const folderId = queue.shift()
      if (!folderId) {
        continue
      }

      for (const folder of data.folders) {
        if (folder.parentId === folderId && !next.has(folder.id)) {
          next.add(folder.id)
          queue.push(folder.id)
        }
      }
    }

    return next
  })()

  const visibleRows = data.rows
    .filter((row) => {
      if (isSearching) {
        if (!searchableFolderIds) {
          return true
        }

        return row.folderId != null && searchableFolderIds.has(row.folderId)
      }

      if (!selectedFolderValue) {
        return row.folderId == null
      }
      return row.folderId === selectedFolderValue
    })
    .filter((row) => {
      const matchesType = selectedType === "all" || row.kind === selectedType
      const matchesQuery =
        normalizedQuery.length === 0 ||
        row.title.toLowerCase().includes(normalizedQuery) ||
        row.detail.toLowerCase().includes(normalizedQuery) ||
        row.meta.toLowerCase().includes(normalizedQuery)
      return matchesType && matchesQuery
    })
    .sort((left, right) =>
      compareMediaRows(left, right, selectedSort, selectedDirection),
    )

  const selectedAssetKey = params.asset?.trim() || null
  const selectedRow =
    selectedAssetKey == null
      ? null
      : (visibleRows.find((row) => row.key === selectedAssetKey) ?? null)
  const selectedAsset = selectedRow
    ? await services.mediaAsset.getById({
        id: selectedRow.key,
        user: principal,
        query: {},
      })
    : null
  const selectedAssetLabel =
    selectedRow?.title ?? selectedAsset?.originalFilename ?? selectedAsset?.id
  const selectedUsage = selectedAsset
    ? await services.mediaAsset.usage({ id: selectedAsset.id, user: principal })
    : []
  const selectedLocales =
    selectedAsset && selectedAsset.kind === "IMAGE"
      ? await services.mediaAsset.listImageLocales({
          mediaAssetId: selectedAsset.id,
          user: principal,
        })
      : []
  const selectedAssetSupplementalLabel = selectedAsset
    ? mediaSupplementalLabel(
        selectedAssetLabel ?? selectedAsset.id,
        selectedAsset.originalFilename,
        selectedAsset.mimeType,
      )
    : ""
  const selectedAssetFolderLabel = selectedAsset
    ? folderPathLabel(selectedAsset.folderId)
    : rootFolderLabel
  const dropTargetLabel = selectedFolder?.label ?? rootFolderLabel
  const canEditMetadata = hasPermission(principal, "write:media-assets")
  const canDeleteAsset = hasPermission(principal, "delete:media-assets")
  const canDeleteFolder = hasPermission(principal, "delete:media-assets")
  const mediaLibraryBaseQuery = mediaLibraryQueryString({
    folder: selectedFolderValue,
    q: queryText,
    type: selectedType,
    sort: selectedSort,
    direction: selectedDirection,
  })
  const closeInspectorHref = `/dashboard/media${
    mediaLibraryBaseQuery ? `?${mediaLibraryBaseQuery}` : ""
  }` as Route
  const closeFolderInspectorQuery = mediaLibraryQueryString({
    q: queryText,
    type: selectedType,
    sort: selectedSort,
    direction: selectedDirection,
  })
  const closeFolderInspectorHref = `/dashboard/media${
    closeFolderInspectorQuery ? `?${closeFolderInspectorQuery}` : ""
  }` as Route

  function sortHref(field: MediaSortField) {
    const next =
      field === selectedSort
        ? {
            sort: field,
            direction:
              selectedDirection === "asc"
                ? ("desc" as const)
                : ("asc" as const),
          }
        : {
            sort: field,
            direction: defaultDirectionForSort(field),
          }
    const query = mediaLibraryQueryString({
      folder: selectedFolderValue,
      asset: selectedAsset?.id ?? null,
      q: queryText,
      type: selectedType,
      sort: next.sort,
      direction: next.direction,
    })

    return `/dashboard/media${query ? `?${query}` : ""}` as Route
  }

  const sortHrefs = {
    name: sortHref("name"),
    size: sortHref("size"),
    updated: sortHref("updated"),
  } as const

  const tableRows = visibleRows.map((row) => {
    const isOutsideCurrentDirectory = row.folderId !== selectedFolderValue

    return {
      key: row.key,
      title: row.title,
      detail:
        isSearching && isOutsideCurrentDirectory
          ? folderPathLabel(row.folderId)
          : row.detail,
      detailHref:
        isSearching && isOutsideCurrentDirectory
          ? folderHref(row.folderId)
          : undefined,
      kind: row.kind,
      folderId: row.folderId,
      previewUrl: row.previewUrl,
      byteSize: row.byteSize,
      updatedLabel: row.meta,
      href: `/dashboard/media?${mediaLibraryQueryString({
        folder: selectedFolderValue,
        asset: row.key,
        q: queryText,
        type: selectedType,
        sort: selectedSort,
        direction: selectedDirection,
      })}` as Route,
      selected: selectedAsset?.id === row.key,
    }
  })

  async function uploadMediaAssetAction(formData: FormData) {
    "use server"

    const user = await requireSession()
    const result = await uploadMediaAssetFromFormData({ formData, user })

    if (result.ok) {
      revalidatePath("/dashboard/media")
    }
    return result
  }

  async function createMediaFolderAction(
    formData: FormData,
  ): Promise<CreateFolderActionResult> {
    "use server"

    const user = await requireSession()
    const services = createServices(prisma)
    const name = String(formData.get("name") ?? "").trim()
    const parentId = String(formData.get("parentId") ?? "").trim()

    if (!name) {
      return {
        ok: false as const,
        error: "validation" as const,
        message: "Name the folder before creating it.",
      }
    }

    try {
      const folder = await services.mediaFolder.create({
        input: {
          name,
          ...(parentId ? { parentId } : {}),
        },
        user,
      })
      revalidatePath("/dashboard/media")
      return { ok: true as const, id: folder.id }
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return {
          ok: false as const,
          error: "forbidden" as const,
          message: "Your account cannot create media folders.",
        }
      }

      if (error instanceof MediaFolderValidationError) {
        return {
          ok: false as const,
          error: "validation" as const,
          message: error.message,
        }
      }

      return {
        ok: false as const,
        error: "unknown" as const,
        message: "We couldn't create that folder just now.",
      }
    }
  }

  async function updateMediaAssetLocaleAction(
    formData: FormData,
  ): Promise<UpdateAssetLocaleActionResult> {
    "use server"

    const user = await requireSession()
    const services = createServices(prisma)
    const mediaAssetId = String(formData.get("mediaAssetId") ?? "").trim()
    const locale = String(formData.get("locale") ?? "").trim()
    const displayName = String(formData.get("displayName") ?? "").trim()
    const altText = String(formData.get("altText") ?? "").trim()

    try {
      await services.mediaAsset.updateImageLocale({
        input: {
          mediaAssetId,
          locale,
          displayName: displayName || null,
          altText: altText || null,
        },
        user,
      })
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return {
          ok: false,
          error: "forbidden",
          message: "Your account cannot edit media localizations.",
        }
      }
      if (error instanceof MediaAssetValidationError) {
        return { ok: false, error: "validation", message: error.message }
      }
      return {
        ok: false,
        error: "unknown",
        message: "Unable to save localized metadata.",
      }
    }

    revalidatePath("/dashboard/media")
    return { ok: true }
  }

  async function retryMediaImageEnrichmentAction(
    formData: FormData,
  ): Promise<RetryImageEnrichmentActionResult> {
    "use server"

    const user = await requireSession()
    const services = createServices(prisma)
    const mediaAssetId = String(formData.get("mediaAssetId") ?? "").trim()

    if (!hasPermission(user, "write:media-assets")) {
      return {
        ok: false,
        error: "forbidden",
        message: "Your account cannot retry image enrichment.",
      }
    }

    try {
      await services.mediaAsset.updateImageEnrichmentState({
        mediaAssetId,
        user: SYSTEM_PRINCIPAL,
        data: {
          imageEnrichmentStatus: "WAITING",
          imageEnrichmentErrorCode: null,
          imageEnrichmentErrorMessage: null,
          imageEnrichmentCompletedAt: null,
        },
      })
      await start(runMediaImageEnrichment, [{ mediaAssetId }])
    } catch (error) {
      await services.mediaAsset.updateImageEnrichmentState({
        mediaAssetId,
        user: SYSTEM_PRINCIPAL,
        data: {
          imageEnrichmentStatus: "FAILED",
          imageEnrichmentErrorCode: "workflow_dispatch_failed",
          imageEnrichmentErrorMessage:
            error instanceof Error ? error.message : String(error),
          imageEnrichmentCompletedAt: new Date(),
        },
      })
      return {
        ok: false,
        error: "unknown",
        message: "Unable to retry image enrichment.",
      }
    }

    revalidatePath("/dashboard/media")
    return { ok: true }
  }

  async function renameMediaFolderAction(
    formData: FormData,
  ): Promise<RenameFolderActionResult> {
    "use server"

    return performRenameMediaFolder(formData)
  }

  async function renameMediaAssetAction(
    formData: FormData,
  ): Promise<RenameAssetActionResult> {
    "use server"

    return performRenameMediaAsset(formData)
  }

  async function moveMediaAssetAction(
    formData: FormData,
  ): Promise<MoveAssetActionResult> {
    "use server"

    const user = await requireSession()
    const services = createServices(prisma)
    const id = String(formData.get("id") ?? "").trim()
    const folderId = String(formData.get("folderId") ?? "").trim()

    if (!id) {
      return {
        ok: false as const,
        error: "validation" as const,
        message: "Choose a file before moving it.",
      }
    }

    try {
      await services.mediaAsset.update({
        input: {
          id,
          folderId: folderId || null,
        },
        user,
      })
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return {
          ok: false as const,
          error: "forbidden" as const,
          message: "Your account cannot reorganize media files.",
        }
      }

      if (error instanceof MediaAssetValidationError) {
        return {
          ok: false as const,
          error: "validation" as const,
          message: error.message,
        }
      }

      return {
        ok: false as const,
        error: "unknown" as const,
        message: "We couldn't move that file just now.",
      }
    }

    revalidatePath("/dashboard/media")
    return { ok: true as const }
  }

  async function deleteMediaAssetAction(
    formData: FormData,
  ): Promise<DeleteAssetActionResult> {
    "use server"

    return performDeleteMediaAsset(formData)
  }

  async function deleteMediaFolderAction(
    formData: FormData,
  ): Promise<DeleteFolderActionResult> {
    "use server"

    return performDeleteMediaFolder(formData)
  }

  async function moveMediaFolderAction(formData: FormData) {
    "use server"

    const user = await requireSession()
    const services = createServices(prisma)
    const id = String(formData.get("id") ?? "").trim()
    const parentId = String(formData.get("parentId") ?? "").trim()

    if (!id) {
      return {
        ok: false as const,
        error: "validation" as const,
        message: "Choose a folder before moving it.",
      }
    }

    try {
      await services.mediaFolder.update({
        input: {
          id,
          parentId: parentId || null,
        },
        user,
      })
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return {
          ok: false as const,
          error: "forbidden" as const,
          message: "Your account cannot reorganize media folders.",
        }
      }

      if (error instanceof MediaFolderValidationError) {
        return {
          ok: false as const,
          error: "validation" as const,
          message: error.message,
        }
      }

      throw error
    }

    revalidatePath("/dashboard/media")
    return { ok: true as const }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col overflow-hidden">
      <div className="hairline-strong-b flex h-14 shrink-0 items-center justify-between gap-4 px-4">
        <MediaLibraryToolbar
          queryText={queryText}
          selectedType={selectedType}
        />
        <MediaActions
          canUpload={canUpload}
          uploadAction={uploadMediaAssetAction}
          selectedFolderId={selectedFolder?.id ?? null}
          selectedFolderLabel={dropTargetLabel}
        />
      </div>

      <MediaLibraryDndProvider>
        <div
          className={cx(
            "grid min-h-0 flex-1 overflow-hidden",
            selectedAsset || selectedFolder
              ? "md:grid-cols-[220px_minmax(0,1fr)_minmax(300px,360px)] lg:grid-cols-[260px_minmax(0,1fr)_minmax(320px,380px)]"
              : "md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]",
          )}
        >
          <aside className="flex min-h-0 flex-col overflow-hidden border-r border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
            <MediaFolderTree
              folders={data.folders}
              selectedFolderId={selectedFolder?.id ?? null}
              queryText={queryText}
              selectedType={selectedType}
              selectedSort={selectedSort}
              selectedDirection={selectedDirection}
              onCreateFolder={createMediaFolderAction}
              onRenameFolder={renameMediaFolderAction}
              onMoveFolder={moveMediaFolderAction}
              onMoveAsset={moveMediaAssetAction}
            />
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-hairline)] px-4">
              {currentPathSegments.map((segment, index) => (
                <Fragment key={`${segment.href}-${index}`}>
                  {index > 0 ? (
                    <span className="mono-meta text-[var(--color-text-muted)]">
                      /
                    </span>
                  ) : null}
                  <Link
                    href={segment.href}
                    aria-current={
                      index === currentPathSegments.length - 1
                        ? "page"
                        : undefined
                    }
                    className={cx(
                      "truncate rounded-[2px] text-[12px] transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand)] focus-visible:ring-inset",
                      index === currentPathSegments.length - 1
                        ? "font-medium text-[var(--color-text-primary)]"
                        : "text-[var(--color-text-muted)]",
                    )}
                  >
                    {segment.label}
                  </Link>
                </Fragment>
              ))}
            </div>

            <MediaAssetDropTarget
              canUpload={canUpload}
              uploadAction={uploadMediaAssetAction}
              selectedFolderId={selectedFolder?.id ?? null}
              selectedFolderLabel={dropTargetLabel}
            >
              <MediaAssetTable
                rows={tableRows}
                selectedSort={selectedSort}
                selectedDirection={selectedDirection}
                sortHrefs={sortHrefs}
                onRenameAsset={renameMediaAssetAction}
                emptyState={
                  <div className="flex min-h-[320px] items-center justify-center px-6 py-10">
                    <div className="grid max-w-md justify-items-center gap-3 text-center">
                      <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]">
                        <Upload className="h-5 w-5" strokeWidth={1.5} />
                      </div>
                      <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                        {canUpload
                          ? `Drop files here to upload to ${dropTargetLabel}`
                          : "No assets match this view yet"}
                      </div>
                      <div className="max-w-sm text-[13px] leading-6 text-[var(--color-text-muted)]">
                        {queryText || selectedType !== "all"
                          ? selectedFolder && isSearching
                            ? "Nothing in this folder or its subfolders matches the current search or type filter."
                            : "Nothing in this library view matches the current search or type filter."
                          : selectedFolder
                            ? "This folder is empty right now."
                            : "This library folder is empty right now."}
                        {canUpload
                          ? " You can drag files into this area or use the Upload button."
                          : ""}
                      </div>
                    </div>
                  </div>
                }
              />
            </MediaAssetDropTarget>
          </section>

          {selectedAsset ? (
            <MediaAssetInspector
              key={`${selectedAsset.id}:${selectedAsset.updatedAt.toISOString()}`}
              asset={{
                id: selectedAsset.id,
                kind: selectedAsset.kind,
                displayName: selectedAssetLabel ?? selectedAsset.id,
                folderLabel: selectedAssetFolderLabel,
                originalFilename: selectedAsset.originalFilename,
                supplementalLabel: selectedAssetSupplementalLabel,
                backend: selectedAsset.backend,
                updatedAtIso: selectedAsset.updatedAt.toISOString(),
                updatedAtLabel: formatDateTime(selectedAsset.updatedAt),
                width: selectedAsset.width,
                height: selectedAsset.height,
                blurDataUrl: selectedAsset.blurDataUrl,
                imageEnrichmentStatus: selectedAsset.imageEnrichmentStatus,
                imageEnrichmentErrorMessage:
                  selectedAsset.imageEnrichmentErrorMessage,
                previewUrl: mediaAssetPreviewUrl(selectedAsset),
                downloadUrl: mediaAssetDownloadUrl(selectedAsset),
              }}
              locales={selectedLocales.map((locale) => ({
                id: locale.id,
                locale: locale.locale,
                displayName: locale.displayName,
                altText: locale.altText,
                displayNameSource: locale.displayNameSource,
                altTextSource: locale.altTextSource,
                displayNameLocked: locale.displayNameLocked,
                altTextLocked: locale.altTextLocked,
                status: locale.status,
                errorMessage: locale.errorMessage,
                updatedAtLabel: formatDateTime(locale.updatedAt),
              }))}
              closeHref={closeInspectorHref}
              usage={selectedUsage}
              canEditMetadata={canEditMetadata}
              canDeleteAsset={canDeleteAsset}
              onUpdateLocale={updateMediaAssetLocaleAction}
              onRetryEnrichment={retryMediaImageEnrichmentAction}
              onDeleteAsset={deleteMediaAssetAction}
            />
          ) : selectedFolder ? (
            <MediaFolderInspector
              key={selectedFolder.id}
              folder={{
                id: selectedFolder.id,
                label: selectedFolder.label,
                pathLabel: folderPathLabel(selectedFolder.id),
                parentLabel: folderPathLabel(selectedFolder.parentId),
                directAssetCount: selectedFolder.directAssetCount,
                childFolderCount: selectedFolder.childFolderCount,
              }}
              closeHref={closeFolderInspectorHref}
              afterDeleteHref={folderHref(selectedFolder.parentId)}
              canDeleteFolder={canDeleteFolder}
              onDeleteFolder={deleteMediaFolderAction}
            />
          ) : null}
        </div>
      </MediaLibraryDndProvider>
    </div>
  )
}
