"use client"

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DraggableAttributes,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ArrowLeft, ChevronDown, ImageIcon, Plus, Trash2 } from "lucide-react"
import { cx } from "@/components/admin-ui"
import {
  BackgroundColorPicker,
  isHexColor,
  normalizeHexColor,
} from "./background-color-picker"
import {
  CONTAINER_SLOT_LAYOUT_PRESETS,
  asArray,
  asRecord,
  asString,
  containerSlotMarkerIndexes,
  findVideoLibraryItemInList,
  GRID_BREAKPOINTS,
  isContainerSlotBlock,
  readContainerContent,
  readContainerSlotSpans,
  summarizeBlock,
  type BlockRecord,
  type BlockSummary,
  type GridBreakpoint,
  type VideoLibraryItem,
} from "./block-helpers"
import { type CanvasBlockRenderOptions } from "./canvas-block-list"

const contentBlockKeys = new WeakMap<object, string>()
let contentBlockKeyCounter = 0
const selectedMediaButtonClassName =
  "border-[rgba(110,231,183,0.48)] bg-[rgba(110,231,183,0.22)] text-[var(--color-text-primary)] hover:border-[rgba(110,231,183,0.68)] hover:bg-[rgba(110,231,183,0.3)]"
const idleMediaButtonClassName =
  "border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)]"

function stableContentBlockKey(item: unknown, childIndex: number) {
  if (!item || typeof item !== "object") {
    return `container-content-primitive-${childIndex}`
  }

  const existing = contentBlockKeys.get(item)
  if (existing) return existing

  const nextKey = `container-content-${contentBlockKeyCounter}`
  contentBlockKeyCounter += 1
  contentBlockKeys.set(item, nextKey)
  return nextKey
}

function SortableContentBlock({
  active,
  children,
  id,
}: {
  active: boolean
  children: (input: {
    attributes: DraggableAttributes
    listeners: DraggableSyntheticListeners | undefined
    setActivatorNodeRef?: (node: HTMLElement | null) => void
    isDragging: boolean
  }) => ReactNode
  id: string
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      className={cx("relative", isDragging && "z-20")}
      style={{
        transform: CSS.Transform.toString(
          transform
            ? {
                ...transform,
                x: 0,
                scaleX: 1,
                scaleY: 1,
              }
            : null,
        ),
        transition,
      }}
    >
      {active ? (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-sm border border-white/70 bg-[rgba(8,8,10,0.28)] backdrop-blur-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
      ) : null}
      <div className={cx(isDragging && "select-none")}>
        {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
      </div>
    </div>
  )
}

function SlotDropTarget({
  children,
  id,
  empty,
  onClick,
  selected,
  style,
}: {
  children: ReactNode
  id: string
  empty?: boolean
  onClick?: () => void
  selected: boolean
  style?: CSSProperties
}) {
  const { isOver, setNodeRef } = useDroppable({ id })

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!onClick) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onClick()
  }

  return (
    <div
      ref={setNodeRef}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      style={style}
      className={cx(
        "relative rounded-sm border transition-colors duration-[120ms] ease-out",
        empty ? "px-4 py-5" : "px-4 py-3",
        onClick && "cursor-pointer",
        selected
          ? "border-[var(--color-text-primary)] bg-[var(--color-surface-raised)]"
          : "border-[var(--color-hairline-strong)] bg-[var(--color-surface)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] hover:border-[var(--color-text-muted)]",
        isOver && "border-[var(--color-brand)] bg-[var(--color-surface)]",
      )}
    >
      {children}
    </div>
  )
}

function EmptySlotDropZone({
  id,
  slotIndex,
}: {
  id: string
  slotIndex: number
}) {
  return (
    <SlotDropTarget id={id} empty selected={false}>
      <div className="flex min-h-16 items-center justify-center text-center">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Empty slot {slotIndex + 1}
          </div>
          <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            Add or drop a block here.
          </div>
        </div>
      </div>
    </SlotDropTarget>
  )
}

type ContentEntry = BlockSummary & {
  childIndex: number
  key: string
  slotIndex: number
}

function asSlotRecord(value: unknown): BlockRecord {
  return isContainerSlotBlock(value) ? value : {}
}

function slotAccentStyle(slot: BlockRecord): CSSProperties | null {
  const backgroundColor = asString(slot.backgroundColor)
  const backgroundImageUrl = asString(slot.backgroundImageUrl)
  if (!isHexColor(backgroundColor) && !backgroundImageUrl) return null

  const style: CSSProperties = {}

  if (isHexColor(backgroundColor)) {
    style.background = `linear-gradient(90deg, transparent 0%, ${normalizeHexColor(
      backgroundColor,
    )} 100%)`
  }

  if (backgroundImageUrl) {
    style.backgroundImage = `linear-gradient(90deg, transparent 0%, rgba(5,6,10,0.2) 38%, rgba(5,6,10,0.74) 100%), url("${backgroundImageUrl}")`
    style.backgroundPosition = "center"
    style.backgroundSize = "cover"
  }

  return style
}

function videoPreviewImageUrl(
  value: unknown,
  videoLibrary: VideoLibraryItem[],
) {
  const record = asRecord(value)
  if (!record) return ""

  const directImage =
    asString(record.imageOverrideUrl) || asString(record.imageUrl)
  if (directImage) return directImage

  return (
    findVideoLibraryItemInList(videoLibrary, record.videoId)?.previewImageUrl ??
    ""
  )
}

function blockPreviewImageUrls(
  value: unknown,
  videoLibrary: VideoLibraryItem[],
) {
  const record = asRecord(value)
  if (!record) return []

  const blockType = asString(record.t)
  if (blockType === "video" || blockType === "videoHero") {
    return [videoPreviewImageUrl(record, videoLibrary)].filter(Boolean)
  }

  if (blockType === "videoCarousel" || blockType === "mediaCollection") {
    return asArray(record.items)
      .map((item) => videoPreviewImageUrl(item, videoLibrary))
      .filter(Boolean)
  }

  return []
}

const VIEWPORT_LABELS: Record<GridBreakpoint, string> = {
  xs: "XS",
  sm: "SM",
  md: "MD",
  lg: "LG",
  xl: "XL",
}

export function ContainerWorkspace({
  activeViewport,
  blockIndex,
  blockRecord,
  videoLibrary,
  onAddSlot,
  onApplySlotPreset,
  onClose,
  onMoveContent,
  onMoveContentToSlot,
  onOpenAddBlockPicker,
  onRemoveSlot,
  onSelectSlot,
  onSlotSpanChange,
  onSlotVisualChange,
  onViewportChange,
  pendingInsertIndex,
  renderBlock,
  renderPendingInsertMarker,
  selectedSlotIndex,
  virtualBlockIndex,
}: {
  activeViewport: GridBreakpoint
  blockIndex: number
  blockRecord: BlockRecord
  videoLibrary: VideoLibraryItem[]
  onAddSlot: () => void
  onApplySlotPreset: (spans: readonly number[]) => void
  onClose: () => void
  onMoveContent: (fromIndex: number, toIndex: number) => void
  onMoveContentToSlot: (fromIndex: number, slotIndex: number) => void
  onOpenAddBlockPicker: (childIndex: number) => void
  onRemoveSlot: (slotIndex: number) => void
  onSelectSlot: (slotIndex: number) => void
  onSlotSpanChange: (
    slotIndex: number,
    viewport: GridBreakpoint,
    span: number,
  ) => void
  onSlotVisualChange: (
    slotIndex: number,
    field: "backgroundColor" | "backgroundImageUrl",
    value: string,
  ) => void
  onViewportChange: (viewport: GridBreakpoint) => void
  pendingInsertIndex: number | null
  renderBlock: (
    block: BlockSummary,
    virtualIndex: number,
    options?: CanvasBlockRenderOptions,
  ) => ReactNode
  renderPendingInsertMarker: () => ReactNode
  selectedSlotIndex: number | null
  virtualBlockIndex: (childIndex: number) => number
}) {
  const content = readContainerContent(blockRecord)
  const slotGridRef = useRef<HTMLDivElement | null>(null)
  const slotMarkerIndexes = useMemo(
    () => containerSlotMarkerIndexes(content),
    [content],
  )
  const [activeDragKey, setActiveDragKey] = useState<string | null>(null)
  const [viewportGridOpen, setViewportGridOpen] = useState(false)
  const [reorderedDuringDrag, setReorderedDuringDrag] = useState(false)
  const lastMoveRef = useRef<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  )

  const entries = useMemo<ContentEntry[]>(() => {
    return content.flatMap((item, childIndex) => {
      if (isContainerSlotBlock(item)) {
        return []
      }

      const slotIndex = Math.max(
        slotMarkerIndexes.filter((markerIndex) => markerIndex < childIndex)
          .length - 1,
        0,
      )
      return [
        {
          ...summarizeBlock(item, childIndex, videoLibrary),
          key: stableContentBlockKey(item, childIndex),
          childIndex,
          slotIndex,
        },
      ]
    })
  }, [content, slotMarkerIndexes, videoLibrary])

  const activeEntry =
    activeDragKey === null
      ? null
      : (entries.find((entry) => entry.key === activeDragKey) ?? null)
  const slotGroups = slotMarkerIndexes.map((markerIndex, slotIndex) => {
    const slotRecord = asSlotRecord(content[markerIndex])
    return {
      activeSpan: readContainerSlotSpans(slotRecord)[activeViewport],
      entries: entries.filter((entry) => entry.slotIndex === slotIndex),
      markerIndex,
      slotRecord,
      slotIndex,
    }
  })

  function handleDragStart(event: DragStartEvent) {
    setReorderedDuringDrag(false)
    lastMoveRef.current = null
    setActiveDragKey(String(event.active.id))
  }

  function moveOverTarget(event: DragOverEvent | DragEndEvent) {
    const overKey = event.over ? String(event.over.id) : null
    const activeKey = String(event.active.id)
    if (!overKey || activeKey === overKey) return false
    const moveKey = `${activeKey}->${overKey}`
    if (lastMoveRef.current === moveKey) return false

    const active = entries.find((entry) => entry.key === activeKey)
    if (!active) return false

    if (overKey.startsWith("slot-drop-")) {
      const slotIndex = Number(overKey.replace("slot-drop-", ""))
      if (Number.isInteger(slotIndex) && slotIndex >= 0) {
        lastMoveRef.current = moveKey
        onMoveContentToSlot(active.childIndex, slotIndex)
        onSelectSlot(slotIndex)
        return true
      }
      return false
    }

    const over = entries.find((entry) => entry.key === overKey)
    if (!over || over.childIndex === active.childIndex) return false

    lastMoveRef.current = moveKey
    onMoveContent(active.childIndex, over.childIndex)
    onSelectSlot(over.slotIndex)
    return true
  }

  function handleDragOver(event: DragOverEvent) {
    if (moveOverTarget(event)) {
      setReorderedDuringDrag(true)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!reorderedDuringDrag) {
      moveOverTarget(event)
    }
    setActiveDragKey(null)
    setReorderedDuringDrag(false)
    lastMoveRef.current = null
  }

  function startSlotResize(
    event: PointerEvent<HTMLButtonElement>,
    slotIndex: number,
    startSpan: number,
  ) {
    event.preventDefault()
    event.stopPropagation()

    const gridWidth = slotGridRef.current?.getBoundingClientRect().width ?? 0
    if (gridWidth <= 0) return

    const startX = event.clientX
    const columnWidth = gridWidth / 12

    function handlePointerMove(pointerEvent: globalThis.PointerEvent) {
      const deltaColumns = Math.round(
        (pointerEvent.clientX - startX) / columnWidth,
      )
      const nextSpan = Math.min(Math.max(startSpan + deltaColumns, 1), 12)
      onSlotSpanChange(slotIndex, activeViewport, nextSpan)
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
  }

  function renderAddAfter(childIndex: number) {
    const insertIndex = virtualBlockIndex(childIndex)
    const active = pendingInsertIndex === insertIndex

    return (
      <div
        className={cx(
          "group relative flex items-center justify-center transition-[height] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          active ? "h-[144px]" : "h-10",
        )}
      >
        {active ? (
          <div className="absolute inset-x-0 top-8 bottom-8">
            {renderPendingInsertMarker()}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => onOpenAddBlockPicker(childIndex)}
          className={cx(
            "absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-2 rounded-pill border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--color-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.4)] transition-all duration-[120ms] ease-out",
            active ? "opacity-0" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Add Block
        </button>
      </div>
    )
  }

  function renderSlotLayoutPresets(className?: string) {
    return (
      <div
        className={cx(
          "rounded-sm border border-dashed border-[var(--color-hairline)] px-4 py-8",
          className,
        )}
      >
        <div className="mx-auto max-w-3xl text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            Choose a slot layout
          </div>
          <div className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
            Start from a common configuration
          </div>
          <p className="mt-2 text-[13px] leading-6 text-[var(--color-text-secondary)]">
            These presets create slot dividers with xs/sm stacked and md/lg/xl
            set to the shown column spans.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CONTAINER_SLOT_LAYOUT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => onApplySlotPreset(preset.spans)}
                className="grid cursor-pointer gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 text-left transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)]"
              >
                <span className="flex h-8 gap-1">
                  {preset.spans.map((span, index) => (
                    <span
                      key={`${preset.label}-${index}`}
                      className="rounded-[2px] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-raised)]"
                      style={{ flexGrow: span }}
                    />
                  ))}
                </span>
                <span className="font-mono text-[11px] text-[var(--color-text-primary)]">
                  {preset.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function chooseSlotBackgroundImage(
    slotIndex: number,
    slotRecord: BlockRecord,
  ) {
    const current = asString(slotRecord.backgroundImageUrl)
    const nextValue = window.prompt("Background image URL", current)
    if (nextValue === null) return
    onSlotVisualChange(slotIndex, "backgroundImageUrl", nextValue.trim())
  }

  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col px-6 py-6 xl:px-10 xl:py-7">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-hairline)] pb-5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
            Back to page
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setViewportGridOpen((open) => !open)}
            className={cx(
              "inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm border px-3 text-[12px] font-medium transition-colors duration-[120ms] ease-out",
              viewportGridOpen
                ? "border-[var(--color-text-primary)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                : "border-[var(--color-hairline)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]",
            )}
            aria-pressed={viewportGridOpen}
          >
            Layout
            <ChevronDown
              className={cx(
                "h-3.5 w-3.5 transition-transform duration-[120ms] ease-out",
                viewportGridOpen && "rotate-180",
              )}
              strokeWidth={1.5}
            />
          </button>
          <button
            type="button"
            onClick={onAddSlot}
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Add slot divider
          </button>
        </div>
      </div>

      <DndContext
        id="experience-editor-container-workspace"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveDragKey(null)
          setReorderedDuringDrag(false)
          lastMoveRef.current = null
        }}
      >
        <SortableContext
          items={entries.map((entry) => entry.key)}
          strategy={verticalListSortingStrategy}
        >
          <>
            {viewportGridOpen ? (
              <div className="mt-6">
                <div
                  className="mb-4 inline-flex overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]"
                  aria-label="Container screen size"
                >
                  {GRID_BREAKPOINTS.map((viewport) => (
                    <button
                      key={viewport}
                      type="button"
                      onClick={() => onViewportChange(viewport)}
                      className={cx(
                        "h-8 cursor-pointer px-2.5 font-mono text-[10px] transition-colors duration-[120ms] ease-out",
                        activeViewport === viewport
                          ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
                      )}
                    >
                      {VIEWPORT_LABELS[viewport]}
                    </button>
                  ))}
                </div>

                <div className="relative rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface-inset)] p-3 pt-11">
                  <div className="pointer-events-none absolute inset-3 grid grid-cols-12 gap-x-3">
                    {Array.from({ length: 12 }).map((_, index) => (
                      <div
                        key={index}
                        className="rounded-[2px] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-raised)] opacity-75 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                      >
                        <div className="px-1.5 py-2 font-mono text-[10px] leading-none text-[var(--color-text-muted)]">
                          {index + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    ref={slotGridRef}
                    className="relative z-10 grid grid-cols-12 gap-x-3 gap-y-3"
                  >
                    {slotGroups.length > 0 ? (
                      slotGroups.map(
                        ({
                          activeSpan,
                          entries: slotEntries,
                          markerIndex,
                          slotIndex,
                          slotRecord,
                        }) => {
                          const selected = selectedSlotIndex === slotIndex
                          const accentStyle = slotAccentStyle(slotRecord)
                          const previewBlocks = slotEntries
                            .flatMap((entry) =>
                              blockPreviewImageUrls(
                                content[entry.childIndex],
                                videoLibrary,
                              ).map((imageUrl, imageIndex) => ({
                                entry,
                                imageIndex,
                                imageUrl,
                              })),
                            )
                            .slice(0, activeSpan)
                          return (
                            <div
                              key={`slot-grid-${blockIndex}-${markerIndex}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => onSelectSlot(slotIndex)}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ")
                                  return
                                event.preventDefault()
                                onSelectSlot(slotIndex)
                              }}
                              className={cx(
                                "relative flex h-36 cursor-pointer flex-col rounded-sm border px-4 py-3 transition-colors duration-[120ms] ease-out",
                                selected
                                  ? "border-[var(--color-text-primary)] bg-[var(--color-surface-raised)]"
                                  : "border-[var(--color-hairline-strong)] bg-[var(--color-surface)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] hover:border-[var(--color-text-muted)]",
                              )}
                              style={{
                                gridColumn: `span ${activeSpan} / span ${activeSpan}`,
                              }}
                            >
                              {accentStyle ? (
                                <div
                                  className="pointer-events-none absolute inset-y-0 right-0 z-0 w-1/2 rounded-r-sm opacity-80"
                                  style={accentStyle}
                                />
                              ) : null}
                              <div className="relative z-10 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                                    Slot {slotIndex + 1}
                                  </div>
                                </div>
                              </div>
                              {previewBlocks.length > 0 ? (
                                <div
                                  className="relative z-10 mt-3 grid flex-1 content-start gap-1.5 overflow-hidden"
                                  style={{
                                    gridTemplateColumns: `repeat(${activeSpan}, minmax(0, 1fr))`,
                                  }}
                                >
                                  {previewBlocks.map(
                                    ({ entry, imageIndex, imageUrl }) => (
                                      <div
                                        key={`slot-preview-${entry.key}-${imageIndex}`}
                                        className="aspect-square max-h-20 overflow-hidden rounded-[2px] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-inset)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                                        aria-label={`${entry.typeLabel}: ${entry.title}`}
                                        title={`${entry.typeLabel}: ${entry.title}`}
                                      >
                                        <div
                                          className="h-full w-full bg-cover bg-center"
                                          style={{
                                            backgroundImage: `url("${imageUrl}")`,
                                          }}
                                        />
                                      </div>
                                    ),
                                  )}
                                </div>
                              ) : null}
                              <button
                                type="button"
                                onPointerDown={(event) =>
                                  startSlotResize(event, slotIndex, activeSpan)
                                }
                                onClick={(event) => event.stopPropagation()}
                                className={cx(
                                  "absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 cursor-ew-resize rounded-pill border transition-all duration-[120ms] ease-out",
                                  selected
                                    ? "h-12 w-3 border-[var(--color-text-primary)] bg-[var(--color-text-primary)] shadow-[0_0_0_3px_rgba(255,255,255,0.12)]"
                                    : "h-9 w-2 border-[var(--color-hairline)] bg-[var(--color-surface-raised)] hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]",
                                )}
                                aria-label={`Resize slot ${slotIndex + 1}`}
                                title={`Resize slot ${slotIndex + 1}`}
                              />
                            </div>
                          )
                        },
                      )
                    ) : (
                      <div className="col-span-12 rounded-sm border border-dashed border-[var(--color-hairline)] px-4 py-8">
                        <div className="mx-auto max-w-3xl text-center">
                          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                            Choose a slot layout
                          </div>
                          <div className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
                            Start from a common configuration
                          </div>
                          <p className="mt-2 text-[13px] leading-6 text-[var(--color-text-secondary)]">
                            These presets create slot dividers with xs/sm
                            stacked and md/lg/xl set to the shown column spans.
                          </p>
                          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {CONTAINER_SLOT_LAYOUT_PRESETS.map((preset) => (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() => onApplySlotPreset(preset.spans)}
                                className="grid cursor-pointer gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 text-left transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)]"
                              >
                                <span className="flex h-8 gap-1">
                                  {preset.spans.map((span, index) => (
                                    <span
                                      key={`${preset.label}-${index}`}
                                      className="rounded-[2px] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-raised)]"
                                      style={{ flexGrow: span }}
                                    />
                                  ))}
                                </span>
                                <span className="font-mono text-[11px] text-[var(--color-text-primary)]">
                                  {preset.label}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {!viewportGridOpen && slotMarkerIndexes.length > 0 ? (
              <div className="mt-6 space-y-0">
                {content.map((item, childIndex) => {
                  if (isContainerSlotBlock(item)) {
                    const slotIndex = slotMarkerIndexes.indexOf(childIndex)
                    const selected = selectedSlotIndex === slotIndex
                    const slotRecord = asSlotRecord(item)
                    const accentStyle = slotAccentStyle(slotRecord)
                    const nextItem = content[childIndex + 1]
                    const isEmptySlot =
                      nextItem === undefined || isContainerSlotBlock(nextItem)
                    const dropId = `slot-drop-${slotIndex}`
                    return (
                      <div key={`slot-divider-${blockIndex}-${childIndex}`}>
                        <SlotDropTarget
                          id={dropId}
                          selected={selected}
                          onClick={() => onSelectSlot(slotIndex)}
                        >
                          {accentStyle ? (
                            <div
                              className="pointer-events-none absolute inset-y-0 right-0 z-0 w-1/2 rounded-r-sm opacity-80"
                              style={accentStyle}
                            />
                          ) : null}
                          <div className="relative z-10 flex w-full flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 text-left">
                              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                                Slot {slotIndex + 1}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <BackgroundColorPicker
                                value={slotRecord.backgroundColor}
                                label={`Choose slot ${slotIndex + 1} background color`}
                                description="Used as the visual backdrop for this slot."
                                customLabel={`Custom slot ${slotIndex + 1} background hex`}
                                onChange={(value) =>
                                  onSlotVisualChange(
                                    slotIndex,
                                    "backgroundColor",
                                    value,
                                  )
                                }
                                onTrigger={() => onSelectSlot(slotIndex)}
                                triggerClassName="h-8 w-8 bg-[var(--color-surface)]"
                                align="right"
                              />
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onSelectSlot(slotIndex)
                                  chooseSlotBackgroundImage(
                                    slotIndex,
                                    slotRecord,
                                  )
                                }}
                                className={cx(
                                  "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border transition-colors duration-[120ms] ease-out",
                                  slotRecord.backgroundImageAssetId
                                    ? selectedMediaButtonClassName
                                    : idleMediaButtonClassName,
                                )}
                                aria-pressed={Boolean(
                                  slotRecord.backgroundImageAssetId,
                                )}
                                aria-label={`Choose slot ${slotIndex + 1} background image`}
                              >
                                <ImageIcon
                                  className="h-4 w-4"
                                  strokeWidth={1.5}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onRemoveSlot(slotIndex)
                                }}
                                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
                                aria-label="Remove slot"
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                              </button>
                            </div>
                          </div>
                        </SlotDropTarget>
                        {isEmptySlot ? (
                          <>
                            {renderAddAfter(childIndex)}
                            <div className="py-2">
                              <EmptySlotDropZone
                                id={dropId}
                                slotIndex={slotIndex}
                              />
                            </div>
                          </>
                        ) : null}
                        {renderAddAfter(childIndex)}
                      </div>
                    )
                  }

                  const entry = entries.find(
                    (candidate) => candidate.childIndex === childIndex,
                  )
                  if (!entry) return null

                  return (
                    <div key={entry.key}>
                      <SortableContentBlock
                        id={entry.key}
                        active={activeDragKey === entry.key}
                      >
                        {({
                          attributes,
                          listeners,
                          setActivatorNodeRef,
                          isDragging,
                        }) =>
                          renderBlock(entry, virtualBlockIndex(childIndex), {
                            dragHandleProps: {
                              attributes,
                              listeners,
                              setActivatorNodeRef,
                            },
                            isDragging,
                          })
                        }
                      </SortableContentBlock>
                      {renderAddAfter(childIndex)}
                    </div>
                  )
                })}
              </div>
            ) : null}
            {!viewportGridOpen && slotMarkerIndexes.length === 0 ? (
              <div className="mt-6">{renderSlotLayoutPresets()}</div>
            ) : null}
          </>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeEntry ? (
            <div className="rotate-[0.35deg] scale-[1.015]">
              {renderBlock(
                activeEntry,
                virtualBlockIndex(activeEntry.childIndex),
                {
                  isOverlay: true,
                },
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
