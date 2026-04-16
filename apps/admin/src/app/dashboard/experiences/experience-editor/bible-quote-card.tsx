import { GripVertical, ImageIcon, Palette, Trash2 } from "lucide-react"
import type { DragEvent, PointerEvent } from "react"
import { cx } from "@/components/admin-ui"

type BlockRecord = Record<string, unknown>
type ToastTone = "success" | "error"

export type BibleQuoteDragState = {
  blockIndex: number
  itemIndex: number
}

export type BibleQuoteDragHandleState = {
  blockIndex: number
  itemIndex: number
  pointerOffsetX: number
  pointerOffsetY: number
}

type BibleQuoteFieldValue = string | boolean

export type BibleQuoteCardProps = {
  blockIndex: number
  item: unknown
  itemIndex: number
  dragState: BibleQuoteDragState | null
  dragHandleState: BibleQuoteDragHandleState | null
  onActivateBlock: (index: number) => void
  onUpdateField: (
    blockIndex: number,
    itemIndex: number,
    field: string,
    value: BibleQuoteFieldValue,
  ) => void
  onRemove: (blockIndex: number, itemIndex: number) => void
  onDragStart: (
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) => void
  onDragEnter: (
    blockIndex: number,
    itemIndex: number,
    event: DragEvent<HTMLDivElement>,
  ) => void
  onClearDragState: () => void
  onSetDragHandleState: (state: BibleQuoteDragHandleState | null) => void
  onPushToast: (message: string, tone: ToastTone) => void
}

function asRecord(value: unknown): BlockRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as BlockRecord)
    : null
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function normalizeHexColor(value: unknown, fallback = "#151515") {
  const color = asString(value).trim()
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback
}

function isSwitchEnabled(block: BlockRecord | null, field: string) {
  if (!block) return false
  const value = block[field]
  if (value === undefined && field === "ctaEnabled") return true
  return value === true
}

function fieldClassName() {
  return "h-10 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] focus:bg-[var(--color-bg)]"
}

function switchTrackClass(checked: boolean) {
  return checked
    ? "justify-end border-[var(--color-brand)] bg-[color-mix(in_oklab,var(--color-brand)_28%,black)]"
    : "justify-start border-[var(--color-hairline-strong)] bg-[var(--color-surface-inset)]"
}

export function BibleQuoteCard({
  blockIndex,
  item,
  itemIndex,
  dragState,
  dragHandleState,
  onActivateBlock,
  onUpdateField,
  onRemove,
  onDragStart,
  onDragEnter,
  onClearDragState,
  onSetDragHandleState,
  onPushToast,
}: BibleQuoteCardProps) {
  const itemRecord = asRecord(item)
  const backgroundImageUrl =
    asString(itemRecord?.backgroundImageUrl) || asString(itemRecord?.imageUrl)
  const backgroundColor = normalizeHexColor(itemRecord?.backgroundColor)
  const ctaEnabled = isSwitchEnabled(itemRecord, "ctaEnabled")
  const dragHandleActive =
    dragHandleState?.blockIndex === blockIndex &&
    dragHandleState.itemIndex === itemIndex
  const isDraggingItem =
    dragState?.blockIndex === blockIndex && dragState.itemIndex === itemIndex

  function activate(event: { stopPropagation: () => void }) {
    event.stopPropagation()
    onActivateBlock(blockIndex)
  }

  function update(field: string, value: BibleQuoteFieldValue) {
    onUpdateField(blockIndex, itemIndex, field, value)
  }

  function handleDragPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation()
    const cardRect = event.currentTarget
      .closest("[data-bible-quote-card]")
      ?.getBoundingClientRect()
    onSetDragHandleState({
      blockIndex,
      itemIndex,
      pointerOffsetX: cardRect ? event.clientX - cardRect.left : 24,
      pointerOffsetY: cardRect ? event.clientY - cardRect.top : 24,
    })
  }

  function clearDragHandleIfIdle(event?: PointerEvent<HTMLButtonElement>) {
    event?.stopPropagation()
    if (!isDraggingItem) {
      onSetDragHandleState(null)
    }
  }

  return (
    <div
      data-bible-quote-card
      draggable={dragHandleActive}
      onDragStart={(event) => onDragStart(blockIndex, itemIndex, event)}
      onDragEnter={(event) => onDragEnter(blockIndex, itemIndex, event)}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onDragEnd={onClearDragState}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClearDragState()
      }}
      className={cx(
        "relative overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] transition-all duration-[180ms] ease-out",
        isDraggingItem && "shadow-[0_18px_48px_rgba(0,0,0,0.24)]",
      )}
    >
      <div className="grid min-h-[156px] grid-cols-[128px_minmax(0,1fr)]">
        <div
          className="relative overflow-hidden bg-[linear-gradient(180deg,#1c2027,#121419)]"
          style={{ backgroundColor }}
        >
          {backgroundImageUrl ? (
            <>
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url("${backgroundImageUrl}")` }}
              />
              <div
                className="absolute inset-0 mix-blend-color opacity-45"
                style={{ backgroundColor }}
              />
            </>
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_52%)]" />
          )}
          <button
            type="button"
            draggable={false}
            onClick={(event) => {
              event.stopPropagation()
              onPushToast(
                "Asset library image picker is coming next.",
                "success",
              )
            }}
            className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-white/16 bg-[rgba(4,6,10,0.58)] text-white shadow-[0_12px_28px_rgba(0,0,0,0.3)] backdrop-blur-[6px] transition-[background-color,transform] duration-[160ms] ease-out hover:-translate-y-0.5 hover:bg-[rgba(4,6,10,0.72)]"
            aria-label="Choose Bible quote image"
          >
            <ImageIcon className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <label className="absolute bottom-3 right-3 z-10 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-white/16 bg-[rgba(4,6,10,0.58)] text-white shadow-[0_12px_28px_rgba(0,0,0,0.3)] backdrop-blur-[6px] transition-[background-color,transform] duration-[160ms] ease-out hover:-translate-y-0.5 hover:bg-[rgba(4,6,10,0.72)]">
            <Palette className="h-4 w-4" strokeWidth={1.5} />
            <input
              type="color"
              value={backgroundColor}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                update("backgroundColor", event.target.value)
              }
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Choose Bible quote background color"
            />
          </label>
        </div>
        <div className="flex min-w-0 flex-col justify-center p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <input
                value={asString(itemRecord?.reference)}
                onClick={activate}
                onFocus={() => onActivateBlock(blockIndex)}
                onChange={(event) => update("reference", event.target.value)}
                className="w-full border-0 bg-transparent px-0 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)] outline-none placeholder:text-[var(--color-text-muted)]"
                placeholder="Reference"
              />
              <textarea
                value={asString(itemRecord?.text)}
                rows={1}
                onClick={activate}
                onFocus={() => onActivateBlock(blockIndex)}
                onChange={(event) => update("text", event.target.value)}
                onInput={(event) => {
                  const node = event.currentTarget
                  node.style.height = "auto"
                  node.style.height = `${node.scrollHeight}px`
                }}
                ref={(node) => {
                  if (!node) return
                  node.style.height = "auto"
                  node.style.height = `${node.scrollHeight}px`
                }}
                className="mt-2 w-full resize-none border-0 bg-transparent px-0 text-[18px] font-semibold leading-7 tracking-[-0.03em] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                style={{ overflow: "hidden" }}
                placeholder="Quote text"
              />
              <input
                value={asString(itemRecord?.attribution)}
                onClick={activate}
                onFocus={() => onActivateBlock(blockIndex)}
                onChange={(event) => update("attribution", event.target.value)}
                className="mt-2 w-full border-0 bg-transparent px-0 text-[12px] leading-5 text-[var(--color-text-muted)] outline-none placeholder:text-[var(--color-text-muted)]"
                placeholder="Attribution"
              />
              {ctaEnabled ? (
                <div className="mt-4 inline-flex min-h-9 min-w-[150px] items-center justify-start rounded-pill border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-4 transition-[background-color,border-color,box-shadow,transform] duration-[160ms] ease-out hover:-translate-y-0.5 hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)] hover:shadow-[0_14px_28px_rgba(0,0,0,0.18)]">
                  <input
                    value={asString(itemRecord?.ctaLabel)}
                    onClick={activate}
                    onFocus={() => onActivateBlock(blockIndex)}
                    onChange={(event) => update("ctaLabel", event.target.value)}
                    className="w-full border-0 bg-transparent px-0 text-[12px] font-medium text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                    placeholder="Call to action label"
                  />
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                draggable={false}
                onPointerDown={handleDragPointerDown}
                onPointerUp={clearDragHandleIfIdle}
                onPointerLeave={() => clearDragHandleIfIdle()}
                className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)] active:cursor-grabbing"
                aria-label="Drag Bible quote"
              >
                <GripVertical className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                draggable={false}
                onClick={(event) => {
                  event.stopPropagation()
                  onRemove(blockIndex, itemIndex)
                }}
                className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[rgba(255,120,120,0.28)] hover:text-[var(--color-danger)]"
                aria-label="Remove Bible quote"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 border-t border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <span className="label-text">Call to Action</span>
          <button
            type="button"
            onClick={() => update("ctaEnabled", !ctaEnabled)}
            className="flex h-10 cursor-pointer items-center justify-between rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-left transition-[background-color,border-color,transform] duration-[160ms] ease-out hover:-translate-y-0.5 hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)]"
          >
            <span className="text-[12px] text-[var(--color-text-primary)]">
              {ctaEnabled ? "Enabled" : "Disabled"}
            </span>
            <span
              className={cx(
                "inline-flex h-6 w-11 shrink-0 rounded-pill border px-0.5 transition-all duration-[160ms] ease-out",
                switchTrackClass(ctaEnabled),
              )}
            >
              <span className="h-5 w-5 rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.24)]" />
            </span>
          </button>
        </div>
        {ctaEnabled ? (
          <label className="grid gap-1.5">
            <span className="label-text">Call to Action Link</span>
            <input
              value={asString(itemRecord?.ctaLink)}
              onChange={(event) => update("ctaLink", event.target.value)}
              className={`${fieldClassName()} transition-[border-color,background-color,box-shadow,transform] duration-[160ms] ease-out hover:-translate-y-0.5 hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:shadow-[0_12px_24px_rgba(0,0,0,0.12)]`}
              placeholder="/"
            />
          </label>
        ) : null}
      </div>
      {isDraggingItem ? (
        <div className="pointer-events-none absolute inset-0 bg-[rgba(255,255,255,0.05)] backdrop-blur-[7px]" />
      ) : null}
    </div>
  )
}
