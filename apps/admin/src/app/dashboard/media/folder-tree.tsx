"use client"

import type { Route } from "next"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react"
import { useRouter } from "next/navigation"
import {
  DragOverlay,
  type Modifier,
  useDraggable,
  useDndMonitor,
  useDroppable,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { ChevronDown, Folder, FolderPlus } from "lucide-react"
import { cx } from "@/components/admin-ui"
import type { MediaFolderRow } from "@/app/dashboard/ops-data"
import {
  getAssetDragData,
  getFolderDragData,
} from "@/app/dashboard/media/media-library-dnd"
import {
  isDescendantFolderTarget,
  persistRootDropTarget,
  resolveFolderDropTarget,
} from "@/app/dashboard/media/folder-tree-dnd"
const HOVER_EXPAND_DELAY_MS = 450

type MoveFolderActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation"
      message: string
    }

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

type MoveAssetActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type FolderTreeProps = {
  folders: MediaFolderRow[]
  selectedFolderId: string | null
  queryText: string
  selectedType: "all" | "IMAGE" | "VIDEO" | "PDF" | "FILE"
  selectedSort: "name" | "size" | "updated"
  selectedDirection: "asc" | "desc"
  onCreateFolder: (formData: FormData) => Promise<CreateFolderActionResult>
  onRenameFolder: (formData: FormData) => Promise<RenameFolderActionResult>
  onMoveFolder: (formData: FormData) => Promise<MoveFolderActionResult>
  onMoveAsset: (formData: FormData) => Promise<MoveAssetActionResult>
}

type DraftFolder = {
  parentId: string | null
  depth: number
}

type OptimisticFolder = MediaFolderRow

type FolderTreeEntry =
  | {
      kind: "folder"
      folder: MediaFolderRow
    }
  | {
      kind: "draft"
      parentId: string | null
      depth: number
    }

type FolderTreeRowProps = {
  folder: MediaFolderRow
  selected: boolean
  expanded: boolean
  editing: boolean
  editingError: string | null
  activeDragId: string | null
  interactionLocked: boolean
  invalidDropTarget: boolean
  activeDropTargetId: string | null
  onSelect: () => void
  onToggleCollapse: () => void
  onStartEditing: () => void
  onEditingNameChange: (value: string) => void
  onSubmitEditing: () => void
  onCancelEditing: () => void
  editingContentRef: RefObject<HTMLSpanElement | null>
}

const rowNameChipClass =
  "flex min-w-0 max-w-full items-start rounded-[2px] px-1.5"
const rowNameTextClass =
  "px-0.5 text-[13px] font-medium leading-5 text-[var(--color-text-primary)]"

function isEditableKeyTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest("input,textarea,select,[contenteditable=true]")
  )
}

function FolderTreeRow({
  folder,
  selected,
  expanded,
  editing,
  editingError,
  activeDragId,
  interactionLocked,
  invalidDropTarget,
  activeDropTargetId,
  onSelect,
  onToggleCollapse,
  onStartEditing,
  onEditingNameChange,
  onSubmitEditing,
  onCancelEditing,
  editingContentRef,
}: FolderTreeRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `folder:${folder.id}`,
    disabled: editing,
    data: {
      type: "folder",
      folderId: folder.id,
    },
  })
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: folder.id,
    disabled: editing || activeDragId === folder.id || invalidDropTarget,
  })
  const isActiveDropTarget =
    activeDropTargetId === folder.id && !invalidDropTarget && !isDragging
  const canCollapse = folder.childFolderCount > 0

  return (
    <div
      ref={(node) => {
        setNodeRef(node)
      }}
      className={cx(
        "group transition-opacity duration-[120ms] ease-out",
        isDragging && "opacity-40",
      )}
    >
      <div
        data-media-folder-row-id={folder.id}
        ref={setDropNodeRef}
        {...attributes}
        {...listeners}
        onClick={() => {
          if (editing || interactionLocked) {
            return
          }

          onSelect()
        }}
        className={cx(
          "grid min-h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-sm border border-transparent px-2 py-1 text-[13px] text-left transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)] focus:outline-none focus-visible:outline-none",
          !editing && "cursor-grab active:cursor-grabbing",
          editing && "cursor-text",
          selected &&
            "bg-[var(--color-brand-soft)] text-[var(--color-text-primary)]",
          isActiveDropTarget &&
            "border-[var(--color-brand)] bg-[var(--color-surface)] shadow-[inset_0_0_0_1px_var(--color-brand)]",
        )}
      >
        <span
          className="flex min-w-0 items-start gap-2"
          style={{ paddingLeft: `${folder.depth * 16}px` }}
        >
          <button
            type="button"
            aria-label={
              canCollapse
                ? expanded
                  ? `Collapse ${folder.label}`
                  : `Expand ${folder.label}`
                : `${folder.label} has no child folders`
            }
            aria-expanded={canCollapse ? expanded : undefined}
            disabled={!canCollapse}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (canCollapse) {
                onToggleCollapse()
              }
            }}
            className={cx(
              "mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] text-[var(--color-text-muted)] transition-transform duration-[120ms] ease-out",
              canCollapse ? "cursor-pointer" : "cursor-default opacity-45",
            )}
          >
            <ChevronDown
              className={cx(
                "h-4 w-4 shrink-0",
                canCollapse && !expanded && "-rotate-90",
              )}
              strokeWidth={1.5}
            />
          </button>
          <Folder className="mt-[2px] h-4 w-4 shrink-0" strokeWidth={1.5} />
          {editing ? (
            <span
              className={cx(rowNameChipClass, "cursor-text")}
              onClick={(event) => event.stopPropagation()}
            >
              <span
                ref={editingContentRef}
                contentEditable="plaintext-only"
                suppressContentEditableWarning
                role="textbox"
                spellCheck={false}
                aria-invalid={editingError ? "true" : "false"}
                onPointerDown={(event) => {
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                }}
                onInput={(event) => {
                  onEditingNameChange(event.currentTarget.textContent ?? "")
                }}
                onBlur={onSubmitEditing}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    onSubmitEditing()
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    onCancelEditing()
                  }
                }}
                className={cx(
                  rowNameTextClass,
                  "block min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-transparent caret-[var(--color-brand)] outline-none",
                )}
              />
            </span>
          ) : (
            <span
              className={cx(rowNameChipClass, "cursor-text")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()

                if (interactionLocked) {
                  return
                }

                if (selected) {
                  onStartEditing()
                  return
                }

                onSelect()
              }}
            >
              <span
                className={cx(
                  rowNameTextClass,
                  "block min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
                )}
              >
                {folder.label}
              </span>
            </span>
          )}
        </span>
        <span className="mono-meta mt-[2px] shrink-0 leading-5 text-[var(--color-text-muted)]">
          {folder.count}
        </span>
      </div>
      {editingError ? (
        <div
          role="alert"
          className="px-2 pt-1 text-[11px] text-[var(--color-danger)]"
          style={{ paddingLeft: `${folder.depth * 16 + 53}px` }}
        >
          {editingError}
        </div>
      ) : null}
    </div>
  )
}

type DraftFolderRowProps = {
  depth: number
  value: string
  error: string | null
  contentRef: RefObject<HTMLSpanElement | null>
  onNameChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}

function DraftFolderRow({
  depth,
  value,
  error,
  contentRef,
  onNameChange,
  onSubmit,
  onCancel,
}: DraftFolderRowProps) {
  return (
    <div className="group transition-opacity duration-[120ms] ease-out">
      <div className="grid min-h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-sm border border-transparent bg-[var(--color-brand-soft)] px-2 py-1 text-[13px] text-left">
        <span
          className="flex min-w-0 items-start gap-2"
          style={{ paddingLeft: `${depth * 16}px` }}
        >
          <span className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] text-[var(--color-text-muted)] opacity-45">
            <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={1.5} />
          </span>
          <Folder className="mt-[2px] h-4 w-4 shrink-0" strokeWidth={1.5} />
          <span
            className={cx(rowNameChipClass, "relative cursor-text")}
            onClick={(event) => event.stopPropagation()}
          >
            {value.trim().length === 0 ? (
              <span className="pointer-events-none absolute inset-x-1.5 px-0.5 text-[13px] font-medium leading-5 whitespace-nowrap text-[var(--color-text-muted)]">
                Untitled folder
              </span>
            ) : null}
            <span
              ref={contentRef}
              contentEditable="plaintext-only"
              suppressContentEditableWarning
              role="textbox"
              spellCheck={false}
              aria-invalid={error ? "true" : "false"}
              onInput={(event) => {
                onNameChange(event.currentTarget.textContent ?? "")
              }}
              onBlur={onSubmit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  onSubmit()
                }
                if (event.key === "Escape") {
                  event.preventDefault()
                  onCancel()
                }
              }}
              className={cx(
                rowNameTextClass,
                "relative block min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-transparent caret-[var(--color-brand)] outline-none",
              )}
            />
          </span>
        </span>
        <span className="mono-meta mt-[2px] shrink-0 leading-5 text-[var(--color-text-muted)]">
          0
        </span>
      </div>
      {error ? (
        <div
          role="alert"
          className="px-2 pt-1 text-[11px] text-[var(--color-danger)]"
          style={{ paddingLeft: `${depth * 16 + 53}px` }}
        >
          {error}
        </div>
      ) : null}
    </div>
  )
}

function getEventCoordinates(event: Event) {
  if (isPointerLikeEvent(event)) {
    return { x: event.clientX, y: event.clientY }
  }

  if (isTouchEvent(event) && event.touches[0]) {
    return {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    }
  }

  if (isTouchEvent(event) && event.changedTouches[0]) {
    return {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
    }
  }

  return null
}

function isTouchEvent(event: Event): event is TouchEvent {
  return typeof TouchEvent !== "undefined" && event instanceof TouchEvent
}

function isPointerLikeEvent(event: Event): event is MouseEvent | PointerEvent {
  return (
    (typeof PointerEvent !== "undefined" && event instanceof PointerEvent) ||
    (typeof MouseEvent !== "undefined" && event instanceof MouseEvent)
  )
}

export function MediaFolderTree({
  folders,
  selectedFolderId,
  queryText,
  selectedType,
  selectedSort,
  selectedDirection,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onMoveAsset,
}: FolderTreeProps) {
  const router = useRouter()
  const folderTreeRootRef = useRef<HTMLDivElement | null>(null)
  const draftContentRef = useRef<HTMLSpanElement | null>(null)
  const editingContentRef = useRef<HTMLSpanElement | null>(null)
  const initializedDraftRef = useRef(false)
  const initializedEditingFolderIdRef = useRef<string | null>(null)
  const lastRootDropTargetRef = useRef<string | null>(null)
  const rootDropZoneRef = useRef<HTMLDivElement | null>(null)
  const dragOverlayRef = useRef<HTMLDivElement | null>(null)
  const hoverExpandTimerRef = useRef<number | null>(null)
  const hoverExpandTargetIdRef = useRef<string | null>(null)
  const dragOverlayPointerOffsetRef = useRef<{ x: number; y: number } | null>(
    null,
  )
  const [draftFolder, setDraftFolder] = useState<DraftFolder | null>(null)
  const [draftName, setDraftName] = useState("")
  const [draftError, setDraftError] = useState<string | null>(null)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [editingError, setEditingError] = useState<string | null>(null)
  const [optimisticCreatedFolders, setOptimisticCreatedFolders] = useState<
    OptimisticFolder[]
  >([])
  const [optimisticFolderLabels, setOptimisticFolderLabels] = useState<
    Record<string, string>
  >({})
  const [clientSelectedFolderId, setClientSelectedFolderId] = useState<
    string | null
  >(selectedFolderId)
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [activeDropTargetId, setActiveDropTargetId] = useState<string | null>(
    null,
  )
  const [activeAssetDrag, setActiveAssetDrag] = useState<{
    id: string
    title: string
    folderId: string | null
  } | null>(null)
  const [activeAssetDropTargetId, setActiveAssetDropTargetId] = useState<
    string | null
  >(null)
  const [activeDragPointerOffset, setActiveDragPointerOffset] = useState<{
    x: number
    y: number
  } | null>(null)
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [, startTransition] = useTransition()
  const { setNodeRef: setRootDropRef } = useDroppable({
    id: "root",
  })

  const resolvedFolders = useMemo(() => {
    const serverFolderIds = new Set(folders.map((folder) => folder.id))
    const pendingFolders = optimisticCreatedFolders.filter(
      (folder) => !serverFolderIds.has(folder.id),
    )
    const optimisticChildCounts = new Map<string, number>()

    for (const folder of pendingFolders) {
      if (!folder.parentId) {
        continue
      }
      optimisticChildCounts.set(
        folder.parentId,
        (optimisticChildCounts.get(folder.parentId) ?? 0) + 1,
      )
    }

    const combinedFolders = [...folders, ...pendingFolders]

    return combinedFolders.map((folder) => {
      const optimisticLabel = optimisticFolderLabels[folder.id]
      return {
        ...folder,
        label:
          optimisticLabel && optimisticLabel !== folder.label
            ? optimisticLabel
            : folder.label,
        childFolderCount:
          folder.childFolderCount + (optimisticChildCounts.get(folder.id) ?? 0),
      }
    })
  }, [folders, optimisticCreatedFolders, optimisticFolderLabels])
  const folderById = useMemo(
    () => new Map(resolvedFolders.map((folder) => [folder.id, folder])),
    [resolvedFolders],
  )
  const foldersByParent = useMemo(() => {
    const grouped = new Map<string | null, MediaFolderRow[]>()
    for (const folder of resolvedFolders) {
      const siblings = grouped.get(folder.parentId) ?? []
      siblings.push(folder)
      grouped.set(folder.parentId, siblings)
    }
    return grouped
  }, [resolvedFolders])

  useEffect(() => {
    if (!draftFolder) {
      initializedDraftRef.current = false
      return
    }

    const node = draftContentRef.current

    if (!node) {
      return
    }

    if (node.textContent !== draftName) {
      node.textContent = draftName
    }

    if (initializedDraftRef.current) {
      return
    }

    node.focus()

    const selection = window.getSelection()

    if (!selection) {
      return
    }

    const range = document.createRange()
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
    initializedDraftRef.current = true
  }, [draftFolder, draftName])

  useEffect(() => {
    if (!editingFolderId) {
      initializedEditingFolderIdRef.current = null
      return
    }

    const node = editingContentRef.current

    if (!node) {
      return
    }

    if (node.textContent !== editingName) {
      node.textContent = editingName
    }

    if (initializedEditingFolderIdRef.current === editingFolderId) {
      return
    }

    node.focus()

    const selection = window.getSelection()

    if (!selection) {
      return
    }

    const range = document.createRange()
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
    initializedEditingFolderIdRef.current = editingFolderId
  }, [editingFolderId, editingName])

  useEffect(() => {
    return () => {
      if (hoverExpandTimerRef.current !== null) {
        window.clearTimeout(hoverExpandTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    setClientSelectedFolderId(selectedFolderId)
  }, [selectedFolderId])

  useEffect(() => {
    setOptimisticFolderLabels((current) => {
      let changed = false
      const next = { ...current }

      for (const [folderId, optimisticLabel] of Object.entries(current)) {
        const serverFolder = folders.find((folder) => folder.id === folderId)
        if (!serverFolder || serverFolder.label === optimisticLabel) {
          delete next[folderId]
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [folders])

  useEffect(() => {
    setOptimisticCreatedFolders((current) => {
      const serverFolderIds = new Set(folders.map((folder) => folder.id))
      const next = current.filter((folder) => !serverFolderIds.has(folder.id))
      return next.length === current.length ? current : next
    })
  }, [folders])

  function buildHref(folderId: string | null) {
    const query = new URLSearchParams()
    if (folderId) {
      query.set("folder", folderId)
    }
    if (queryText.trim().length > 0) {
      query.set("q", queryText.trim())
    }
    if (selectedType !== "all") {
      query.set("type", selectedType)
    }
    if (selectedSort !== "name" || selectedDirection !== "asc") {
      query.set("sort", selectedSort)
      query.set("dir", selectedDirection)
    }
    const suffix = query.toString()
    return `/dashboard/media${suffix ? `?${suffix}` : ""}` as Route
  }

  function startCreatingFolder() {
    const selectedFolder = clientSelectedFolderId
      ? folderById.get(clientSelectedFolderId)
      : null
    setEditingFolderId(null)
    setEditingName("")
    setEditingError(null)
    setDraftFolder({
      parentId: clientSelectedFolderId,
      depth: selectedFolder ? selectedFolder.depth + 1 : 0,
    })
    setDraftName("")
    setDraftError(null)
  }

  function submitDraftFolder() {
    if (!draftFolder || !draftName.trim()) {
      setDraftFolder(null)
      setDraftName("")
      setDraftError(null)
      return
    }

    const nextName = draftName.trim()
    const nextDraftFolder = draftFolder
    const formData = new FormData()
    formData.set("name", nextName)
    if (nextDraftFolder.parentId) {
      formData.set("parentId", nextDraftFolder.parentId)
    }

    startTransition(async () => {
      const result = await onCreateFolder(formData)
      if (!result.ok) {
        setDraftError(result.message)
        draftContentRef.current?.focus()
        return
      }

      setOptimisticCreatedFolders((current) => [
        ...current,
        {
          id: result.id,
          label: nextName,
          count: 0,
          directAssetCount: 0,
          childFolderCount: 0,
          parentId: nextDraftFolder.parentId,
          depth: nextDraftFolder.depth,
        },
      ])
      setClientSelectedFolderId(result.id)
      setDraftFolder(null)
      setDraftName("")
      setDraftError(null)
      router.push(buildHref(result.id))
    })
  }

  function moveFolder(folderId: string, parentId: string | null) {
    if (
      isDescendantFolderTarget({
        folders,
        folderId,
        parentId,
      })
    ) {
      setActiveFolderId(null)
      return
    }

    const formData = new FormData()
    formData.set("id", folderId)
    if (parentId) {
      formData.set("parentId", parentId)
    }

    startTransition(async () => {
      const result = await onMoveFolder(formData)
      setActiveFolderId(null)
      setActiveDropTargetId(null)
      dragOverlayRef.current = null
      if (!result.ok) {
        return
      }

      router.refresh()
    })
  }

  function clearHoverExpandTimer() {
    if (hoverExpandTimerRef.current !== null) {
      window.clearTimeout(hoverExpandTimerRef.current)
      hoverExpandTimerRef.current = null
    }
    hoverExpandTargetIdRef.current = null
  }

  function expandFolder(folderId: string) {
    setCollapsedFolderIds((current) => {
      if (!current.has(folderId)) {
        return current
      }

      const next = new Set(current)
      next.delete(folderId)
      return next
    })
  }

  function scheduleHoverExpand(
    targetId: string | null,
    options?: {
      folderDragId?: string | null
      assetSourceFolderId?: string | null
    },
  ) {
    if (!targetId || targetId === "root") {
      clearHoverExpandTimer()
      return
    }

    const folderDragId =
      options?.folderDragId !== undefined
        ? options.folderDragId
        : activeFolderId
    const assetSourceFolderId = options?.assetSourceFolderId

    if (!folderDragId && assetSourceFolderId === undefined) {
      clearHoverExpandTimer()
      return
    }

    if (folderDragId) {
      if (
        isDescendantFolderTarget({
          folders: resolvedFolders,
          folderId: folderDragId,
          parentId: targetId,
        })
      ) {
        clearHoverExpandTimer()
        return
      }
    }

    if (assetSourceFolderId !== undefined && assetSourceFolderId === targetId) {
      clearHoverExpandTimer()
      return
    }

    const folder = folderById.get(targetId)
    if (!folder || folder.childFolderCount === 0 || isFolderExpanded(folder)) {
      clearHoverExpandTimer()
      return
    }

    if (hoverExpandTargetIdRef.current === targetId) {
      return
    }

    clearHoverExpandTimer()
    hoverExpandTargetIdRef.current = targetId
    hoverExpandTimerRef.current = window.setTimeout(() => {
      expandFolder(targetId)
      hoverExpandTimerRef.current = null
    }, HOVER_EXPAND_DELAY_MS)
  }

  function handleDragStart(event: DragStartEvent) {
    clearHoverExpandTimer()
    lastRootDropTargetRef.current = null
    setActiveFolderId(null)
    setActiveDropTargetId(null)
    setActiveAssetDrag(null)
    setActiveAssetDropTargetId(null)
    const pointerCoordinates = getEventCoordinates(event.activatorEvent)
    const initialRect = event.active.rect.current.initial
    dragOverlayPointerOffsetRef.current =
      pointerCoordinates && initialRect
        ? {
            x: pointerCoordinates.x - initialRect.left,
            y: pointerCoordinates.y - initialRect.top,
          }
        : null
    setActiveDragPointerOffset(dragOverlayPointerOffsetRef.current)

    const folderDragData = getFolderDragData(event.active.data)
    if (folderDragData) {
      setActiveFolderId(folderDragData.folderId)
      return
    }

    const assetDragData = getAssetDragData(event.active.data)
    if (assetDragData) {
      setActiveAssetDrag({
        id: assetDragData.assetId,
        title: assetDragData.title,
        folderId: assetDragData.folderId,
      })
    }
  }

  function updateActiveDropTarget(event: DragMoveEvent | DragEndEvent) {
    const overlayRect = dragOverlayRef.current?.getBoundingClientRect() ?? null
    const resolvedTargetId = resolveFolderDropTarget({
      overId: event.over ? String(event.over.id) : null,
      collisions: event.collisions,
      activeRect:
        overlayRect ??
        event.active.rect.current.translated ??
        event.active.rect.current.initial,
      rootRect: rootDropZoneRef.current?.getBoundingClientRect() ?? null,
    })

    lastRootDropTargetRef.current = persistRootDropTarget({
      overId: resolvedTargetId,
      collisions: null,
    })
    const folderDragData = getFolderDragData(event.active.data)
    if (folderDragData) {
      setActiveDropTargetId(resolvedTargetId)
      scheduleHoverExpand(resolvedTargetId, {
        folderDragId: folderDragData.folderId,
      })
      return resolvedTargetId
    }

    const assetDragData = getAssetDragData(event.active.data)
    if (assetDragData) {
      const nextTargetId =
        assetDragData.folderId === resolvedTargetId ? null : resolvedTargetId
      setActiveAssetDropTargetId(nextTargetId)
      scheduleHoverExpand(nextTargetId, {
        assetSourceFolderId: assetDragData.folderId,
      })
      return nextTargetId
    }

    return resolvedTargetId
  }

  function handleDragMove(event: DragMoveEvent) {
    updateActiveDropTarget(event)
  }

  function handleDragEnd(event: DragEndEvent) {
    const overId = updateActiveDropTarget(event)
    const folderDragData = getFolderDragData(event.active.data)
    const assetDragData = getAssetDragData(event.active.data)
    clearHoverExpandTimer()
    lastRootDropTargetRef.current = null
    dragOverlayPointerOffsetRef.current = null
    setActiveFolderId(null)
    setActiveDropTargetId(null)
    setActiveAssetDrag(null)
    setActiveAssetDropTargetId(null)
    setActiveDragPointerOffset(null)
    dragOverlayRef.current = null

    if (!overId) {
      return
    }

    if (folderDragData) {
      if (folderDragData.folderId === overId) {
        return
      }

      moveFolder(folderDragData.folderId, overId === "root" ? null : overId)
      return
    }

    if (assetDragData) {
      moveAsset(
        assetDragData.assetId,
        assetDragData.folderId,
        overId === "root" ? null : overId,
      )
    }
  }

  function clearActiveAssetDropState() {
    clearHoverExpandTimer()
    setActiveAssetDrag(null)
    setActiveAssetDropTargetId(null)
  }

  function moveAsset(
    assetId: string,
    sourceFolderId: string | null,
    targetFolderId: string | null,
  ) {
    if (sourceFolderId === targetFolderId) {
      clearActiveAssetDropState()
      return
    }

    const formData = new FormData()
    formData.set("id", assetId)
    if (targetFolderId) {
      formData.set("folderId", targetFolderId)
    }

    clearActiveAssetDropState()
    startTransition(async () => {
      const result = await onMoveAsset(formData)
      if (!result.ok) {
        return
      }

      router.refresh()
    })
  }

  function selectRoot() {
    cancelEditingFolder()
    setClientSelectedFolderId(null)
    router.push(buildHref(null))
  }

  function selectFolder(folderId: string) {
    if (editingFolderId && editingFolderId !== folderId) {
      cancelEditingFolder()
    }

    setClientSelectedFolderId(folderId)
    router.push(buildHref(folderId))
  }

  function focusFolderTree() {
    window.requestAnimationFrame(() => {
      folderTreeRootRef.current?.focus()
    })
  }

  function startEditingFolder(folder: MediaFolderRow) {
    setDraftFolder(null)
    setDraftName("")
    setDraftError(null)
    setEditingFolderId(folder.id)
    setEditingName(folder.label)
    setEditingError(null)
  }

  function cancelEditingFolder() {
    setEditingFolderId(null)
    setEditingName("")
    setEditingError(null)
    focusFolderTree()
  }

  function submitEditingFolder() {
    if (!editingFolderId) {
      return
    }

    const folder = folderById.get(editingFolderId)
    if (!folder) {
      cancelEditingFolder()
      return
    }

    const nextName = (
      editingContentRef.current?.textContent ?? editingName
    ).trim()
    if (!nextName) {
      setEditingError("Name the folder before renaming it.")
      editingContentRef.current?.focus()
      return
    }

    if (nextName === folder.label) {
      cancelEditingFolder()
      return
    }

    const formData = new FormData()
    formData.set("id", editingFolderId)
    formData.set("name", nextName)

    startTransition(async () => {
      const result = await onRenameFolder(formData)
      if (!result.ok) {
        setEditingError(result.message)
        editingContentRef.current?.focus()
        return
      }

      setOptimisticFolderLabels((current) => ({
        ...current,
        [editingFolderId]: nextName,
      }))
      cancelEditingFolder()
      router.refresh()
      focusFolderTree()
    })
  }

  useDndMonitor({
    onDragStart: handleDragStart,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onDragCancel: () => {
      clearHoverExpandTimer()
      lastRootDropTargetRef.current = null
      dragOverlayPointerOffsetRef.current = null
      setActiveFolderId(null)
      setActiveDropTargetId(null)
      setActiveAssetDrag(null)
      setActiveAssetDropTargetId(null)
      setActiveDragPointerOffset(null)
      dragOverlayRef.current = null
    },
  })

  const forcedExpandedFolderIds = (() => {
    const next = new Set<string>()

    if (draftFolder?.parentId) {
      next.add(draftFolder.parentId)
    }

    let currentParentId = clientSelectedFolderId
      ? (folderById.get(clientSelectedFolderId)?.parentId ?? null)
      : null

    while (currentParentId) {
      next.add(currentParentId)
      currentParentId = folderById.get(currentParentId)?.parentId ?? null
    }

    return next
  })()

  function isFolderExpanded(folder: MediaFolderRow) {
    if (forcedExpandedFolderIds.has(folder.id)) {
      return true
    }

    return folder.childFolderCount > 0 && !collapsedFolderIds.has(folder.id)
  }

  function toggleFolderExpansion(folder: MediaFolderRow) {
    if (folder.childFolderCount === 0) {
      return
    }

    setCollapsedFolderIds((current) => {
      const next = new Set(current)
      if (next.has(folder.id)) {
        next.delete(folder.id)
      } else {
        next.add(folder.id)
      }
      return next
    })
  }

  const entries = (() => {
    const nextEntries: FolderTreeEntry[] = []

    function appendEntries(parentId: string | null) {
      const siblings = foldersByParent.get(parentId) ?? []
      for (const folder of siblings) {
        nextEntries.push({
          kind: "folder",
          folder,
        })

        if (isFolderExpanded(folder) || draftFolder?.parentId === folder.id) {
          appendEntries(folder.id)
        }
      }

      if (draftFolder?.parentId === parentId) {
        nextEntries.push({
          kind: "draft",
          parentId,
          depth: draftFolder.depth,
        })
      }
    }

    appendEntries(null)
    return nextEntries
  })()
  const visibleFolderEntries = entries.flatMap((entry) =>
    entry.kind === "folder" ? [entry.folder] : [],
  )

  function navigateFolders(direction: -1 | 1) {
    if (
      visibleFolderEntries.length === 0 ||
      editingFolderId ||
      draftFolder ||
      interactionLocked
    ) {
      return
    }

    const selectedIndex =
      clientSelectedFolderId === null
        ? -1
        : visibleFolderEntries.findIndex(
            (folder) => folder.id === clientSelectedFolderId,
          )
    const nextIndex =
      selectedIndex === -1
        ? direction > 0
          ? 0
          : visibleFolderEntries.length - 1
        : Math.min(
            visibleFolderEntries.length - 1,
            Math.max(0, selectedIndex + direction),
          )
    const nextFolder = visibleFolderEntries[nextIndex]
    if (!nextFolder || nextFolder.id === clientSelectedFolderId) {
      return
    }

    selectFolder(nextFolder.id)
  }

  function handleFolderTreeKeyDown(
    event: globalThis.React.KeyboardEvent<HTMLDivElement>,
  ) {
    if (isEditableKeyTarget(event.target)) {
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      navigateFolders(-1)
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      navigateFolders(1)
    } else if (event.key === "Enter") {
      const selectedFolder = clientSelectedFolderId
        ? folderById.get(clientSelectedFolderId)
        : null
      if (!selectedFolder) {
        return
      }

      event.preventDefault()
      startEditingFolder(selectedFolder)
    } else if (event.key === " ") {
      const selectedFolder = clientSelectedFolderId
        ? folderById.get(clientSelectedFolderId)
        : null
      if (!selectedFolder || selectedFolder.childFolderCount === 0) {
        return
      }

      event.preventDefault()
      toggleFolderExpansion(selectedFolder)
    }
  }

  const effectiveSelectedFolderId = clientSelectedFolderId
  const activeFolder = activeFolderId ? folderById.get(activeFolderId) : null
  const interactionLocked = activeFolderId !== null || activeAssetDrag !== null
  const effectiveDropTargetId =
    activeFolderId !== null ? activeDropTargetId : activeAssetDropTargetId
  const rootDropActive =
    (activeFolderId !== null && activeDropTargetId === "root") ||
    (activeAssetDrag !== null &&
      activeAssetDrag.folderId !== null &&
      activeAssetDropTargetId === "root")
  const centerDragOverlayOnPointer = useMemo<Modifier[]>(
    () => [
      ({
        activeNodeRect,
        overlayNodeRect,
        transform,
      }: Parameters<Modifier>[0]) => {
        const pointerOffset = dragOverlayPointerOffsetRef.current
        if (!pointerOffset || !activeNodeRect || !overlayNodeRect) {
          return transform
        }

        return {
          ...transform,
          x: transform.x + (pointerOffset.x - overlayNodeRect.width / 2),
          y: transform.y + (pointerOffset.y - overlayNodeRect.height / 2),
        }
      },
    ],
    [],
  )

  return (
    <div
      ref={folderTreeRootRef}
      tabIndex={-1}
      onKeyDown={handleFolderTreeKeyDown}
      className="flex min-h-0 flex-1 flex-col focus:outline-none"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-hairline)] px-2 text-[12px] font-medium text-[var(--color-text-primary)]">
        <span className="flex items-center gap-2">
          <Folder className="h-4 w-4" strokeWidth={1.5} />
          Folders
        </span>
        <button
          type="button"
          onClick={startCreatingFolder}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
          aria-label="Create folder"
        >
          <FolderPlus className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <div
        className={cx(
          "relative flex min-h-0 flex-1 flex-col border border-[color-mix(in_srgb,var(--color-brand)_18%,transparent)]",
          rootDropActive && "border-[var(--color-brand)]",
        )}
      >
        <div
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute inset-0 rounded-sm transition-[background-color,box-shadow,opacity] duration-[120ms] ease-out",
            rootDropActive &&
              "bg-transparent opacity-100 shadow-[inset_0_0_0_1px_var(--color-brand)]",
            !rootDropActive && "bg-transparent opacity-100",
          )}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col py-1">
            <nav className="shrink-0">
              {entries.map((entry, index) => {
                if (entry.kind === "draft") {
                  return (
                    <DraftFolderRow
                      key={`draft-${entry.parentId ?? "root"}-${index}`}
                      depth={entry.depth}
                      value={draftName}
                      error={draftError}
                      contentRef={draftContentRef}
                      onNameChange={(value) => {
                        setDraftName(value)
                        if (draftError) {
                          setDraftError(null)
                        }
                      }}
                      onSubmit={submitDraftFolder}
                      onCancel={() => {
                        setDraftFolder(null)
                        setDraftName("")
                        setDraftError(null)
                      }}
                    />
                  )
                }

                return (
                  <FolderTreeRow
                    key={entry.folder.id}
                    folder={entry.folder}
                    selected={effectiveSelectedFolderId === entry.folder.id}
                    expanded={isFolderExpanded(entry.folder)}
                    editing={editingFolderId === entry.folder.id}
                    editingError={
                      editingFolderId === entry.folder.id ? editingError : null
                    }
                    activeDragId={activeFolderId}
                    interactionLocked={interactionLocked}
                    activeDropTargetId={effectiveDropTargetId}
                    invalidDropTarget={
                      (activeFolderId !== null &&
                        isDescendantFolderTarget({
                          folders: resolvedFolders,
                          folderId: activeFolderId,
                          parentId: entry.folder.id,
                        })) ||
                      activeAssetDrag?.folderId === entry.folder.id
                    }
                    onToggleCollapse={() => toggleFolderExpansion(entry.folder)}
                    onStartEditing={() => startEditingFolder(entry.folder)}
                    onEditingNameChange={setEditingName}
                    onSubmitEditing={submitEditingFolder}
                    onCancelEditing={cancelEditingFolder}
                    editingContentRef={editingContentRef}
                    onSelect={() => selectFolder(entry.folder.id)}
                  />
                )
              })}
            </nav>
            <div
              data-media-root-drop-zone="true"
              ref={(node) => {
                rootDropZoneRef.current = node
                setRootDropRef(node)
              }}
              role="button"
              tabIndex={0}
              onClick={selectRoot}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  selectRoot()
                }
              }}
              className="mb-1 mt-2 min-h-20 flex-1 rounded-sm transition-[background-color] duration-[120ms] ease-out focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand)]"
            />
          </div>
        </div>
      </div>

      <DragOverlay modifiers={centerDragOverlayOnPointer}>
        {activeFolder ? (
          <div
            ref={dragOverlayRef}
            data-media-folder-drag-overlay="true"
            className="inline-flex w-fit max-w-max items-center gap-2 whitespace-nowrap rounded-sm border border-[var(--color-brand)] bg-[var(--color-surface)] px-3 py-2 text-[13px] shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
          >
            <Folder className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span>{activeFolder.label}</span>
          </div>
        ) : activeAssetDrag ? (
          <div
            ref={dragOverlayRef}
            data-media-asset-drag-overlay="true"
            className="pointer-events-none absolute inline-flex max-w-[240px] items-center rounded-sm border border-[var(--color-brand)] bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
            style={{
              left: (activeDragPointerOffset?.x ?? 0) + 10,
              top: (activeDragPointerOffset?.y ?? 0) + 10,
            }}
          >
            <span className="truncate">{activeAssetDrag.title}</span>
          </div>
        ) : null}
      </DragOverlay>
    </div>
  )
}
