"use client"

import { useState } from "react"
import { type CSSProperties } from "react"
import { ChevronDown, Plus, Trash2 } from "lucide-react"
import { cx } from "@/components/admin-ui"
import {
  BackgroundColorPicker,
  isHexColor,
  normalizeHexColor,
} from "./background-color-picker"
import {
  CONTAINER_SLOT_LAYOUT_PRESETS,
  asString,
  containerSlotMarkerIndexes,
  GRID_BREAKPOINTS,
  isContainerSlotBlock,
  readContainerContent,
  summarizeBlock,
  type BlockRecord,
  type GridBreakpoint,
  type VideoLibraryItem,
} from "./block-helpers"

function slotAccentStyle(slot: BlockRecord): CSSProperties | null {
  const backgroundColor = asString(slot.backgroundColor)
  if (!isHexColor(backgroundColor)) return null

  const style: CSSProperties = {}

  if (isHexColor(backgroundColor)) {
    style.background = `linear-gradient(90deg, transparent 0%, ${normalizeHexColor(
      backgroundColor,
    )} 100%)`
  }

  return style
}

type ContainerGridEditorProps = {
  blockIndex: number
  blockRecord: BlockRecord
  activeViewport: GridBreakpoint
  videoLibrary: VideoLibraryItem[]
  onActivate: () => void
  onViewportChange: (viewport: GridBreakpoint) => void
  onSlotSpanChange: (
    slotIndex: number,
    viewport: GridBreakpoint,
    span: number,
  ) => void
  onAddSlot: () => void
  onApplySlotPreset: (spans: readonly number[]) => void
  onRemoveSlot: (slotIndex: number) => void
  onSlotVisualChange: (
    slotIndex: number,
    field: "backgroundColor",
    value: string,
  ) => void
  onOpenSlotContent: (childIndex: number) => void
}

const VIEWPORT_LABELS: Record<GridBreakpoint, string> = {
  xs: "XS",
  sm: "SM",
  md: "MD",
  lg: "LG",
  xl: "XL",
}
export function ContainerGridEditor({
  blockIndex,
  blockRecord,
  activeViewport,
  videoLibrary,
  onActivate,
  onViewportChange,
  onAddSlot,
  onApplySlotPreset,
  onRemoveSlot,
  onSlotVisualChange,
  onOpenSlotContent,
}: ContainerGridEditorProps) {
  const content = readContainerContent(blockRecord)
  const slotMarkerIndexes = containerSlotMarkerIndexes(content)
  const [viewportMenuOpen, setViewportMenuOpen] = useState(false)

  return (
    <div className="mt-4 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Slot list
          </div>
          <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            Slot divider blocks define layout boundaries in one ordered content
            list.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onActivate()
                setViewportMenuOpen((open) => !open)
              }}
              className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 font-mono text-[10px] text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
              aria-expanded={viewportMenuOpen}
              aria-haspopup="menu"
            >
              Screen {VIEWPORT_LABELS[activeViewport]}
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            {viewportMenuOpen ? (
              <div
                className="absolute right-0 z-30 mt-2 grid min-w-32 gap-1 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
                role="menu"
              >
                {GRID_BREAKPOINTS.map((viewport) => (
                  <button
                    key={viewport}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onActivate()
                      onViewportChange(viewport)
                      setViewportMenuOpen(false)
                    }}
                    className={cx(
                      "h-8 cursor-pointer rounded-[2px] px-3 text-left font-mono text-[10px] transition-colors duration-[120ms] ease-out",
                      activeViewport === viewport
                        ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
                    )}
                    role="menuitem"
                  >
                    {VIEWPORT_LABELS[viewport]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onActivate()
              onAddSlot()
            }}
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Add slot divider
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {content.length > 0 ? (
          content.map((item, childIndex) => {
            if (isContainerSlotBlock(item)) {
              const slotIndex = slotMarkerIndexes.indexOf(childIndex)
              const accentStyle = slotAccentStyle(item)
              return (
                <div
                  key={`${blockIndex}-container-slot-${childIndex}`}
                  className="relative flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                >
                  {accentStyle ? (
                    <div
                      className="pointer-events-none absolute inset-y-0 right-0 z-0 w-1/2 rounded-r-sm opacity-80"
                      style={accentStyle}
                    />
                  ) : null}
                  <div className="relative z-10">
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      Slot {slotIndex + 1}
                    </div>
                    <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                      Divider block
                    </div>
                  </div>
                  <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-1">
                    <BackgroundColorPicker
                      value={item.backgroundColor}
                      label={`Choose slot ${slotIndex + 1} background color`}
                      description="Used as the visual backdrop for this slot."
                      customLabel={`Custom slot ${slotIndex + 1} background hex`}
                      onChange={(value) =>
                        onSlotVisualChange(slotIndex, "backgroundColor", value)
                      }
                      onTrigger={onActivate}
                      triggerClassName="h-8 w-8"
                      align="right"
                    />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onActivate()
                        onRemoveSlot(slotIndex)
                      }}
                      className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
                      aria-label="Remove slot"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              )
            }

            const summary = summarizeBlock(item, childIndex, videoLibrary)
            return (
              <button
                key={`${blockIndex}-container-content-${childIndex}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onActivate()
                  onOpenSlotContent(childIndex)
                }}
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 text-left transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)]"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">
                    {summary.title}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                    {summary.typeLabel}
                  </div>
                </div>
              </button>
            )
          })
        ) : (
          <div className="rounded-sm border border-dashed border-[var(--color-hairline)] px-4 py-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              Choose a slot layout
            </div>
            <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
              Create dividers with responsive spans already set.
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {CONTAINER_SLOT_LAYOUT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onActivate()
                    onApplySlotPreset(preset.spans)
                  }}
                  className="grid cursor-pointer gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-2 text-left transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)]"
                >
                  <div className="flex h-6 gap-1">
                    {preset.spans.map((span, index) => (
                      <span
                        key={`${preset.label}-${index}`}
                        className="rounded-[2px] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-raised)]"
                        style={{ flexGrow: span }}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[10px] text-[var(--color-text-primary)]">
                    {preset.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
