"use client"

import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react"
import type { Route } from "next"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useDraggable } from "@dnd-kit/core"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  File as FileIcon,
  FileText,
  Video,
} from "lucide-react"
import { cx } from "@/components/admin-ui"
import type { MediaLibraryAssetDragData } from "@/app/dashboard/media/media-library-dnd"

type MediaSortField = "name" | "size" | "updated"
type SortDirection = "asc" | "desc"
type ResizableColumn = "name" | "size" | "updated"

type MediaAssetTableRow = {
  key: string
  title: string
  detail: string
  detailHref?: Route
  kind: "IMAGE" | "VIDEO" | "PDF" | "FILE"
  folderId: string | null
  previewUrl: string | null
  byteSize: string
  updatedLabel: string
  href: Route
  selected: boolean
}

type MediaAssetTableProps = {
  rows: MediaAssetTableRow[]
  selectedSort: MediaSortField
  selectedDirection: SortDirection
  sortHrefs: Record<MediaSortField, Route>
  onRenameAsset: (formData: FormData) => Promise<{
    ok: boolean
    error?: "forbidden" | "validation" | "unknown"
    message?: string
  }>
  emptyState?: ReactNode
}

const DEFAULT_NAME_WIDTH = 320
const DEFAULT_SIZE_WIDTH = 120
const DEFAULT_UPDATED_WIDTH = 132
const MIN_NAME_WIDTH = 220
const MAX_NAME_WIDTH = 460
const MIN_SIZE_WIDTH = 92
const MAX_SIZE_WIDTH = 240
const MIN_UPDATED_WIDTH = 108
const MAX_UPDATED_WIDTH = 260

function isEditableKeyTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest("input,textarea,select,[contenteditable=true]")
  )
}

function clampColumnWidth(column: ResizableColumn, value: number) {
  if (column === "name") {
    return Math.min(MAX_NAME_WIDTH, Math.max(MIN_NAME_WIDTH, value))
  }

  if (column === "size") {
    return Math.min(MAX_SIZE_WIDTH, Math.max(MIN_SIZE_WIDTH, value))
  }

  return Math.min(MAX_UPDATED_WIDTH, Math.max(MIN_UPDATED_WIDTH, value))
}

function SortIndicator({
  active,
  direction,
}: {
  active: boolean
  direction: SortDirection
}) {
  if (!active) {
    return <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.5} />
  }

  return direction === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
  ) : (
    <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} />
  )
}

type MediaAssetTableRowItemProps = {
  row: MediaAssetTableRow
  tableStyle: CSSProperties
  selected: boolean
  editing: boolean
  editingContentRef: RefObject<HTMLSpanElement | null>
  editingError: string | null
  isPending: boolean
  onSelect: () => void
  onStartEditing: () => void
  onEditingNameChange: (value: string) => void
  onSubmitEditing: () => void
  onCancelEditing: () => void
}

function MediaAssetTableRowItem({
  row,
  tableStyle,
  selected,
  editing,
  editingContentRef,
  editingError,
  isPending,
  onSelect,
  onStartEditing,
  onEditingNameChange,
  onSubmitEditing,
  onCancelEditing,
}: MediaAssetTableRowItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `asset:${row.key}`,
    disabled: editing,
    data: {
      type: "asset",
      assetId: row.key,
      title: row.title,
      folderId: row.folderId,
    } satisfies MediaLibraryAssetDragData,
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (editing) {
          return
        }

        if (!selected) {
          onSelect()
        }
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || editing) {
          return
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          if (!selected) {
            onSelect()
          }
        }
      }}
      className={cx(
        "grid items-center gap-4 px-4 py-3 text-left transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand)] focus-visible:ring-inset",
        !editing && "cursor-grab active:cursor-grabbing",
        selected && "bg-[var(--color-brand-soft)]",
        isDragging && "opacity-60",
      )}
      style={tableStyle}
    >
      <div className="overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)]">
        <div className="flex aspect-video items-center justify-center">
          {row.kind === "IMAGE" && row.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.previewUrl}
              alt={row.title}
              className="h-full w-full object-cover"
            />
          ) : row.kind === "PDF" ? (
            <FileText
              className="h-6 w-6 text-[var(--color-text-muted)]"
              strokeWidth={1.5}
            />
          ) : row.kind === "VIDEO" ? (
            <Video
              className="h-6 w-6 text-[var(--color-text-muted)]"
              strokeWidth={1.5}
            />
          ) : (
            <FileIcon
              className="h-6 w-6 text-[var(--color-text-muted)]"
              strokeWidth={1.5}
            />
          )}
        </div>
      </div>
      <div className="min-w-0">
        {editing ? (
          <span
            className="inline-flex min-w-0 max-w-full rounded-[2px] bg-[var(--color-bg)] px-1.5 shadow-[inset_0_0_0_1px_var(--color-brand)]"
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
                "block min-w-0 max-w-full whitespace-pre-wrap break-words bg-transparent px-0.5 text-[13px] font-medium leading-5 text-[var(--color-text-primary)] [overflow-wrap:anywhere] caret-[var(--color-brand)] outline-none",
                isPending && "opacity-70",
              )}
            />
          </span>
        ) : (
          <span
            className="inline-flex min-w-0 max-w-full cursor-text rounded-[2px] px-1.5"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()

              if (selected) {
                onStartEditing()
                return
              }

              onSelect()
            }}
          >
            <span className="block min-w-0 truncate px-0.5 text-[13px] font-medium text-[var(--color-text-primary)]">
              {row.title}
            </span>
          </span>
        )}
        {row.detail ? (
          row.detailHref ? (
            <Link
              href={row.detailHref}
              onClick={(event) => {
                event.stopPropagation()
              }}
              className="mono-meta mt-1 block truncate px-2 text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand)] focus-visible:ring-inset"
            >
              {row.detail}
            </Link>
          ) : (
            <div className="mono-meta mt-1 truncate px-2 text-[var(--color-text-muted)]">
              {row.detail}
            </div>
          )
        ) : null}
        {editing && editingError ? (
          <div
            role="alert"
            className="mt-1 px-2 text-[11px] text-[var(--color-danger)]"
          >
            {editingError}
          </div>
        ) : null}
      </div>
      <div className="mono-meta justify-self-end text-[var(--color-text-secondary)]">
        {row.byteSize}
      </div>
      <div className="mono-meta justify-self-end text-[var(--color-text-muted)]">
        {row.updatedLabel}
      </div>
    </div>
  )
}

export function MediaAssetTable({
  rows,
  selectedSort,
  selectedDirection,
  sortHrefs,
  onRenameAsset,
  emptyState,
}: MediaAssetTableProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [nameWidth, setNameWidth] = useState(DEFAULT_NAME_WIDTH)
  const [sizeWidth, setSizeWidth] = useState(DEFAULT_SIZE_WIDTH)
  const [updatedWidth, setUpdatedWidth] = useState(DEFAULT_UPDATED_WIDTH)
  const editingContentRef = useRef<HTMLSpanElement | null>(null)
  const tableRootRef = useRef<HTMLDivElement | null>(null)
  const initializedEditingRowIdRef = useRef<string | null>(null)
  const submittingRowIdRef = useRef<string | null>(null)
  const dragStateRef = useRef<{
    column: ResizableColumn
    startX: number
    startWidth: number
  } | null>(null)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [editingError, setEditingError] = useState<string | null>(null)
  const [optimisticTitles, setOptimisticTitles] = useState<
    Record<string, { from: string; to: string }>
  >({})
  const displayRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        title:
          optimisticTitles[row.key] &&
          (row.title === optimisticTitles[row.key].from ||
            row.title === optimisticTitles[row.key].to)
            ? optimisticTitles[row.key].to
            : row.title,
      })),
    [optimisticTitles, rows],
  )
  const rowById = useMemo(
    () => new Map(displayRows.map((row) => [row.key, row])),
    [displayRows],
  )
  const selectedRowId = rows.find((row) => row.selected)?.key ?? null

  useEffect(() => {
    if (!editingRowId || !editingContentRef.current) {
      initializedEditingRowIdRef.current = null
      return
    }

    if (initializedEditingRowIdRef.current === editingRowId) {
      return
    }

    const node = editingContentRef.current
    node.textContent = editingName
    node.focus()

    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(node)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    initializedEditingRowIdRef.current = editingRowId
  }, [editingName, editingRowId])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current
      if (!dragState) {
        return
      }

      const deltaX = event.clientX - dragState.startX
      const nextWidth = clampColumnWidth(
        dragState.column,
        dragState.startWidth + deltaX,
      )

      if (dragState.column === "name") {
        setNameWidth(nextWidth)
      } else if (dragState.column === "size") {
        setSizeWidth(nextWidth)
      } else {
        setUpdatedWidth(nextWidth)
      }
    }

    function handlePointerUp() {
      dragStateRef.current = null
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [])

  const tableStyle = useMemo(
    () => ({
      gridTemplateColumns: `80px minmax(${MIN_NAME_WIDTH}px, ${nameWidth}fr) minmax(${MIN_SIZE_WIDTH}px, ${sizeWidth}fr) minmax(${MIN_UPDATED_WIDTH}px, ${updatedWidth}fr)`,
      minWidth: `${80 + MIN_NAME_WIDTH + MIN_SIZE_WIDTH + MIN_UPDATED_WIDTH}px`,
      width: "100%",
    }),
    [nameWidth, sizeWidth, updatedWidth],
  )

  function startResizing(column: ResizableColumn) {
    return (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()

      dragStateRef.current = {
        column,
        startX: event.clientX,
        startWidth:
          column === "name"
            ? nameWidth
            : column === "size"
              ? sizeWidth
              : updatedWidth,
      }

      document.body.style.cursor = "ew-resize"
      document.body.style.userSelect = "none"
    }
  }

  function cancelEditingRow() {
    submittingRowIdRef.current = null
    setEditingRowId(null)
    setEditingName("")
    setEditingError(null)
    focusAssetTable()
  }

  function focusAssetTable() {
    window.requestAnimationFrame(() => {
      tableRootRef.current?.focus()
    })
  }

  function selectRow(row: MediaAssetTableRow) {
    if (editingRowId && editingRowId !== row.key) {
      cancelEditingRow()
    }

    router.push(row.href, { scroll: false })
  }

  function navigateRows(direction: -1 | 1) {
    if (displayRows.length === 0 || editingRowId) {
      return
    }

    const selectedIndex = selectedRowId
      ? displayRows.findIndex((row) => row.key === selectedRowId)
      : -1
    const nextIndex =
      selectedIndex === -1
        ? direction > 0
          ? 0
          : displayRows.length - 1
        : Math.min(
            displayRows.length - 1,
            Math.max(0, selectedIndex + direction),
          )
    const nextRow = displayRows[nextIndex]
    if (!nextRow || nextRow.key === selectedRowId) {
      return
    }

    selectRow(nextRow)
  }

  function handleAssetTableKeyDown(
    event: globalThis.React.KeyboardEvent<HTMLDivElement>,
  ) {
    if (isEditableKeyTarget(event.target)) {
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      navigateRows(-1)
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      navigateRows(1)
    }
  }

  function startEditingRow(row: MediaAssetTableRow) {
    setEditingRowId(row.key)
    setEditingName(row.title)
    setEditingError(null)
  }

  function submitEditingRow() {
    if (!editingRowId || submittingRowIdRef.current === editingRowId) {
      return
    }

    const row = rowById.get(editingRowId)
    if (!row) {
      cancelEditingRow()
      return
    }

    const nextName = (
      editingContentRef.current?.textContent ?? editingName
    ).trim()

    if (!nextName) {
      setEditingError("Name the file before renaming it.")
      editingContentRef.current?.focus()
      return
    }

    if (nextName === row.title) {
      cancelEditingRow()
      return
    }

    const targetRowId = editingRowId
    const previousTitle = row.title
    const formData = new FormData()
    formData.set("id", targetRowId)
    formData.set("displayName", nextName)
    submittingRowIdRef.current = targetRowId

    startTransition(async () => {
      const result = await onRenameAsset(formData)
      submittingRowIdRef.current = null

      if (!result.ok) {
        setEditingError(
          result.message ?? "We couldn't rename that file just now.",
        )
        editingContentRef.current?.focus()
        return
      }

      setOptimisticTitles((current) => {
        return {
          ...current,
          [targetRowId]: {
            from: previousTitle,
            to: nextName,
          },
        }
      })
      cancelEditingRow()
      router.refresh()
      focusAssetTable()
    })
  }

  return (
    <div
      ref={tableRootRef}
      tabIndex={-1}
      onKeyDown={handleAssetTableKeyDown}
      className="min-h-0 flex-1 overflow-auto focus:outline-none"
    >
      <div className="min-h-full">
        <div
          className="sticky top-0 z-10 grid items-center gap-4 border-b border-[var(--color-hairline)] bg-[var(--color-bg)] px-4 py-2"
          style={tableStyle}
        >
          <div />
          <div className="relative">
            <Link
              href={sortHrefs.name}
              className={cx(
                "inline-flex h-7 items-center gap-1 rounded-[2px] px-1.5 text-left label-text transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)]",
                selectedSort === "name"
                  ? "text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-muted)]",
              )}
            >
              <span>File name</span>
              <SortIndicator
                active={selectedSort === "name"}
                direction={selectedDirection}
              />
            </Link>
            <button
              type="button"
              aria-label="Resize file name column"
              onPointerDown={startResizing("name")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              className="absolute -right-3 top-1/2 z-10 inline-flex h-7 w-6 -translate-y-1/2 cursor-ew-resize items-center justify-center text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)]"
            >
              <span className="h-4 w-px bg-current" />
            </button>
          </div>
          <div className="relative">
            <button
              type="button"
              aria-label="Resize file size column"
              onPointerDown={startResizing("size")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              className="absolute -right-3 top-1/2 z-10 inline-flex h-7 w-6 -translate-y-1/2 cursor-ew-resize items-center justify-center text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)]"
            >
              <span className="h-4 w-px bg-current" />
            </button>
            <Link
              href={sortHrefs.size}
              className={cx(
                "inline-flex h-7 w-full items-center justify-end gap-1 rounded-[2px] px-1.5 text-left label-text transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)]",
                selectedSort === "size"
                  ? "text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-muted)]",
              )}
            >
              <span>File size</span>
              <SortIndicator
                active={selectedSort === "size"}
                direction={selectedDirection}
              />
            </Link>
          </div>
          <div className="relative">
            <button
              type="button"
              aria-label="Resize updated column"
              onPointerDown={startResizing("updated")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              className="absolute -right-3 top-1/2 z-10 inline-flex h-7 w-6 -translate-y-1/2 cursor-ew-resize items-center justify-center text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)]"
            >
              <span className="h-4 w-px bg-current" />
            </button>
            <Link
              href={sortHrefs.updated}
              className={cx(
                "inline-flex h-7 w-full items-center justify-end gap-1 rounded-[2px] px-1.5 text-left label-text transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)]",
                selectedSort === "updated"
                  ? "text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-muted)]",
              )}
            >
              <span>Updated</span>
              <SortIndicator
                active={selectedSort === "updated"}
                direction={selectedDirection}
              />
            </Link>
          </div>
        </div>

        <div className="divide-y divide-[var(--color-hairline)]">
          {displayRows.map((row) => {
            const isSelected = selectedRowId === row.key
            const isEditing = editingRowId === row.key

            return (
              <MediaAssetTableRowItem
                key={row.key}
                row={row}
                tableStyle={tableStyle}
                selected={isSelected}
                editing={isEditing}
                editingContentRef={editingContentRef}
                editingError={isEditing ? editingError : null}
                isPending={isPending}
                onSelect={() => selectRow(row)}
                onStartEditing={() => startEditingRow(row)}
                onEditingNameChange={setEditingName}
                onSubmitEditing={submitEditingRow}
                onCancelEditing={cancelEditingRow}
              />
            )
          })}

          {rows.length === 0 ? emptyState : null}
        </div>
      </div>
    </div>
  )
}
