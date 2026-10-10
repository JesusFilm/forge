"use client"

import type { ReactNode, RefObject } from "react"
import {
  closestCenter,
  DndContext,
  DragOverlay,
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
import { Plus } from "lucide-react"
import { cx } from "@/components/admin-ui"
import type { BlockSummary } from "./block-helpers"

export type CanvasBlockDragHandleProps = {
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners | undefined
  setActivatorNodeRef?: (node: HTMLElement | null) => void
  isDragging: boolean
}

export type CanvasBlockRenderOptions = {
  dragHandleProps?: {
    attributes: DraggableAttributes
    listeners: DraggableSyntheticListeners | undefined
    setActivatorNodeRef?: (node: HTMLElement | null) => void
  }
  isDragging?: boolean
  isOverlay?: boolean
}

type InsertedBlockAnimation = {
  key: string
  visible: boolean
}

type SortableCanvasBlockProps = {
  id: string
  isDraggingOverlay: boolean
  insertedState: InsertedBlockAnimation | null
  onWrapperRef: (node: HTMLDivElement | null) => void
  children: (dragHandleProps: CanvasBlockDragHandleProps) => ReactNode
  addSlot: ReactNode
}

function SortableCanvasBlock({
  id,
  isDraggingOverlay,
  insertedState,
  onWrapperRef,
  children,
  addSlot,
}: SortableCanvasBlockProps) {
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
      ref={(node) => {
        setNodeRef(node)
        onWrapperRef(node)
      }}
      className={cx(
        "relative",
        isDragging && "z-20",
        insertedState?.key === id && !insertedState.visible
          ? "translate-y-3 scale-[0.985] opacity-0"
          : "translate-y-0 scale-100 opacity-100",
      )}
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
        transition: isDraggingOverlay ? undefined : transition,
      }}
    >
      <div className="relative">
        {isDragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-sm border border-white/70 bg-[rgba(8,8,10,0.28)] backdrop-blur-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0.12))]" />
          </div>
        ) : null}
        <div className={cx(isDragging && "select-none")}>
          {children({
            attributes,
            listeners,
            setActivatorNodeRef,
            isDragging,
          })}
        </div>
      </div>
      {addSlot}
    </div>
  )
}

export function CanvasBlockList({
  activeDragKey,
  activeDragSummary,
  blockCardRefs,
  blocks,
  insertedBlockAnimation,
  pendingInsertIndex,
  sensors,
  onBlockDragCancel,
  onBlockDragEnd,
  onBlockDragOver,
  onBlockDragStart,
  onOpenAddBlockPicker,
  renderAddSlot,
  renderBlock,
  renderPendingInsertMarker,
}: {
  activeDragKey: string | null
  activeDragSummary: BlockSummary | null
  blockCardRefs: RefObject<Map<string, HTMLDivElement>>
  blocks: BlockSummary[]
  insertedBlockAnimation: InsertedBlockAnimation | null
  pendingInsertIndex: number | null
  sensors: ReturnType<typeof import("@dnd-kit/core").useSensors>
  onBlockDragCancel: () => void
  onBlockDragEnd: (event: DragEndEvent) => void
  onBlockDragOver: (event: DragOverEvent) => void
  onBlockDragStart: (event: DragStartEvent) => void
  onOpenAddBlockPicker: (index: number) => void
  renderAddSlot?: (index: number) => ReactNode
  renderBlock: (
    block: BlockSummary,
    index: number,
    options?: CanvasBlockRenderOptions,
  ) => ReactNode
  renderPendingInsertMarker: () => ReactNode
}) {
  return (
    <DndContext
      id="experience-editor-canvas"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onBlockDragStart}
      onDragOver={onBlockDragOver}
      onDragEnd={onBlockDragEnd}
      onDragCancel={onBlockDragCancel}
    >
      <SortableContext
        items={blocks.map((block) => block.key)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-0">
          {blocks.map((block, index) => {
            const addSlot =
              renderAddSlot !== undefined ? (
                renderAddSlot(index)
              ) : (
                <div
                  className={cx(
                    "group relative flex items-center justify-center transition-[height] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                    pendingInsertIndex === index + 1 ? "h-[144px]" : "h-10",
                  )}
                >
                  {pendingInsertIndex === index + 1 ? (
                    <div className="absolute inset-x-0 top-8 bottom-8">
                      {renderPendingInsertMarker()}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onOpenAddBlockPicker(index + 1)}
                    className={cx(
                      "absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-2 rounded-pill border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--color-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.4)] transition-all duration-[120ms] ease-out",
                      pendingInsertIndex === index + 1
                        ? "opacity-0"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.5} />
                    Add Block
                  </button>
                </div>
              )

            return (
              <SortableCanvasBlock
                key={block.key}
                id={block.key}
                isDraggingOverlay={activeDragKey === block.key}
                insertedState={insertedBlockAnimation}
                onWrapperRef={(node) => {
                  if (node) {
                    blockCardRefs.current.set(block.key, node)
                    return
                  }

                  blockCardRefs.current.delete(block.key)
                }}
                addSlot={addSlot}
              >
                {({ attributes, listeners, setActivatorNodeRef, isDragging }) =>
                  renderBlock(block, index, {
                    dragHandleProps: {
                      attributes,
                      listeners,
                      setActivatorNodeRef,
                    },
                    isDragging,
                  })
                }
              </SortableCanvasBlock>
            )
          })}
        </div>
      </SortableContext>

      <DragOverlay dropAnimation={null}>
        {activeDragSummary ? (
          <div className="rotate-[0.35deg] scale-[1.015]">
            {renderBlock(
              activeDragSummary,
              blocks.findIndex((block) => block.key === activeDragSummary.key),
              {
                isDragging: true,
                isOverlay: true,
              },
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
