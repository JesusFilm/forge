import {
  GripVertical,
  ImageIcon,
  Link2,
  MousePointer2,
  Trash2,
  X,
} from "lucide-react"
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
} from "react"
import { createPortal } from "react-dom"
import { cx } from "@/components/admin-ui"
import {
  BackgroundColorPicker,
  normalizeHexColor,
} from "./background-color-picker"

type BlockRecord = Record<string, unknown>
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

const selectedOverlayMediaButtonClassName =
  "border-[rgba(110,231,183,0.54)] bg-[rgba(20,83,61,0.82)] text-white hover:border-[rgba(110,231,183,0.78)] hover:bg-[rgba(24,96,70,0.9)]"
const idleOverlayMediaButtonClassName =
  "border-white/18 bg-[#08090d] text-white hover:border-white/36 hover:bg-[#11131a]"

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
  onChooseImage: (blockIndex: number, itemIndex: number) => void
  onClearDragState: () => void
  onSetDragHandleState: (state: BibleQuoteDragHandleState | null) => void
}

function asRecord(value: unknown): BlockRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as BlockRecord)
    : null
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function isSwitchEnabled(block: BlockRecord | null, field: string) {
  if (!block) return false
  const value = block[field]
  if (value === undefined && field === "ctaEnabled") return true
  return value === true
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
  onChooseImage,
  onClearDragState,
  onSetDragHandleState,
}: BibleQuoteCardProps) {
  const itemRecord = asRecord(item)
  const backgroundImageUrl = asString(itemRecord?.backgroundImagePreviewUrl)
  const hasBackgroundImage = backgroundImageUrl.length > 0
  const hasMediaLibraryImage = Boolean(
    asString(itemRecord?.backgroundImageAssetId) ||
    asString(itemRecord?.imageAssetId),
  )
  const backgroundColor = normalizeHexColor(itemRecord?.backgroundColor)
  const ctaEnabled = isSwitchEnabled(itemRecord, "ctaEnabled")
  const [ctaLinkModalRendered, setCtaLinkModalRendered] = useState(false)
  const [ctaLinkModalVisible, setCtaLinkModalVisible] = useState(false)
  const ctaLinkModalOpenFrame = useRef<number | null>(null)
  const ctaLinkModalCloseTimeout = useRef<number | null>(null)
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

  function openCtaLinkModal() {
    if (ctaLinkModalCloseTimeout.current !== null) {
      window.clearTimeout(ctaLinkModalCloseTimeout.current)
      ctaLinkModalCloseTimeout.current = null
    }
    if (ctaLinkModalOpenFrame.current !== null) {
      window.cancelAnimationFrame(ctaLinkModalOpenFrame.current)
    }
    setCtaLinkModalRendered(true)
    ctaLinkModalOpenFrame.current = window.requestAnimationFrame(() => {
      setCtaLinkModalVisible(true)
      ctaLinkModalOpenFrame.current = null
    })
  }

  function closeCtaLinkModal() {
    if (ctaLinkModalOpenFrame.current !== null) {
      window.cancelAnimationFrame(ctaLinkModalOpenFrame.current)
      ctaLinkModalOpenFrame.current = null
    }
    setCtaLinkModalVisible(false)
    if (ctaLinkModalCloseTimeout.current !== null) {
      window.clearTimeout(ctaLinkModalCloseTimeout.current)
    }
    ctaLinkModalCloseTimeout.current = window.setTimeout(() => {
      setCtaLinkModalRendered(false)
      ctaLinkModalCloseTimeout.current = null
    }, 180)
  }

  useEffect(() => {
    return () => {
      if (ctaLinkModalOpenFrame.current !== null) {
        window.cancelAnimationFrame(ctaLinkModalOpenFrame.current)
      }
      if (ctaLinkModalCloseTimeout.current !== null) {
        window.clearTimeout(ctaLinkModalCloseTimeout.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!ctaLinkModalVisible) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        closeCtaLinkModal()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [ctaLinkModalVisible])

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
          className="relative"
          style={{
            background: hasBackgroundImage
              ? backgroundColor
              : `radial-gradient(circle at top left, rgba(255,255,255,0.18), transparent 54%), linear-gradient(0deg, rgba(0,0,0,0.24) 0%, rgba(0,0,0,0.02) 62%, rgba(0,0,0,0) 100%), ${backgroundColor}`,
          }}
        >
          <div className="absolute inset-0 overflow-hidden">
            {hasBackgroundImage ? (
              <>
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: `url("${backgroundImageUrl}")` }}
                />
              </>
            ) : (
              <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.14)_0%,rgba(0,0,0,0)_56%)]" />
            )}
          </div>
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
            <BackgroundColorPicker
              value={itemRecord?.backgroundColor}
              label="Choose quote background color"
              description="Used behind quote artwork."
              customLabel="Custom quote background hex"
              onChange={(value) => update("backgroundColor", value)}
              triggerClassName="h-8 w-8 border-white/18 bg-[#08090d] text-white shadow-[0_12px_28px_rgba(0,0,0,0.34)] hover:-translate-y-0.5 hover:border-white/36 hover:bg-[#11131a] hover:text-white data-[open=true]:border-white/72"
              popoverClassName="top-10"
              align="left"
            />
            <div className="inline-flex shadow-[0_12px_28px_rgba(0,0,0,0.34)]">
              <button
                type="button"
                draggable={false}
                onClick={(event) => {
                  event.stopPropagation()
                  onChooseImage(blockIndex, itemIndex)
                }}
                className={cx(
                  "inline-flex h-8 w-8 cursor-pointer items-center justify-center border transition-[background-color,transform,border-color] duration-[160ms] ease-out hover:-translate-y-0.5",
                  hasMediaLibraryImage
                    ? selectedOverlayMediaButtonClassName
                    : idleOverlayMediaButtonClassName,
                  "rounded-sm",
                )}
                aria-pressed={hasMediaLibraryImage}
                aria-label="Choose quote image"
              >
                <ImageIcon className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col justify-start p-4">
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
              <div
                className={cx(
                  "grid overflow-hidden transition-[grid-template-rows,opacity,margin-top] duration-[220ms] ease-out",
                  ctaEnabled
                    ? "mt-4 grid-rows-[1fr] opacity-100"
                    : "mt-0 grid-rows-[0fr] opacity-0",
                )}
                aria-hidden={!ctaEnabled}
              >
                <div className="min-h-0">
                  <div
                    className={cx(
                      "flex flex-wrap items-center gap-2 transition-[opacity,transform] duration-[220ms] ease-out",
                      ctaEnabled
                        ? "translate-y-0 opacity-100"
                        : "-translate-y-2 opacity-0",
                    )}
                  >
                    <div className="inline-flex min-h-9 min-w-[150px] max-w-full items-center justify-start rounded-pill border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-4 transition-[background-color,border-color,box-shadow] duration-[160ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface)] hover:shadow-[0_14px_28px_rgba(0,0,0,0.18)]">
                      <input
                        value={asString(itemRecord?.ctaLabel)}
                        onClick={activate}
                        onFocus={() => onActivateBlock(blockIndex)}
                        onChange={(event) =>
                          update("ctaLabel", event.target.value)
                        }
                        className="w-full border-0 bg-transparent px-0 text-[12px] font-medium text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                        placeholder="Button label"
                        tabIndex={ctaEnabled ? 0 : -1}
                      />
                    </div>
                    <button
                      type="button"
                      draggable={false}
                      onClick={(event) => {
                        event.stopPropagation()
                        onActivateBlock(blockIndex)
                        openCtaLinkModal()
                      }}
                      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)]"
                      aria-label="Edit quote call to action link"
                      tabIndex={ctaEnabled ? 0 : -1}
                    >
                      <Link2 className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <button
                type="button"
                draggable={false}
                onClick={(event) => {
                  event.stopPropagation()
                  onActivateBlock(blockIndex)
                  update("ctaEnabled", !ctaEnabled)
                  if (ctaEnabled) closeCtaLinkModal()
                }}
                className={cx(
                  "inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-[background-color,border-color,color] duration-[120ms] ease-out",
                  ctaEnabled
                    ? "border-[rgba(110,231,183,0.48)] bg-[rgba(110,231,183,0.22)] text-[var(--color-text-primary)] hover:border-[rgba(110,231,183,0.68)] hover:bg-[rgba(110,231,183,0.3)]"
                    : "border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
                )}
                aria-pressed={ctaEnabled}
                aria-label="Toggle quote call to action"
              >
                <MousePointer2 className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                draggable={false}
                onPointerDown={handleDragPointerDown}
                onPointerUp={clearDragHandleIfIdle}
                onPointerLeave={() => clearDragHandleIfIdle()}
                className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)] active:cursor-grabbing"
                aria-label="Drag quote"
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
                aria-label="Remove quote"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
      {isDraggingItem ? (
        <div className="pointer-events-none absolute inset-0 bg-[rgba(255,255,255,0.05)] backdrop-blur-[7px]" />
      ) : null}
      {ctaLinkModalRendered && typeof document !== "undefined"
        ? createPortal(
            <div
              className={cx(
                "fixed inset-0 z-[120] flex items-center justify-center px-4 transition-all duration-180 ease-out sm:px-6",
                ctaLinkModalVisible
                  ? "pointer-events-auto bg-[rgba(4,6,10,0.78)] backdrop-blur-[8px]"
                  : "pointer-events-none bg-[rgba(4,6,10,0)] backdrop-blur-0",
              )}
              onClick={(event) => {
                event.stopPropagation()
                closeCtaLinkModal()
              }}
              role="presentation"
              aria-hidden={!ctaLinkModalVisible}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={`quote-cta-link-${blockIndex}-${itemIndex}`}
                className={cx(
                  "w-full max-w-[440px] rounded-sm border border-[var(--color-hairline-strong)] bg-[color-mix(in_oklab,var(--color-surface)_96%,black)] p-5 shadow-[0_32px_120px_rgba(0,0,0,0.58)] transition-all duration-180 ease-out",
                  ctaLinkModalVisible
                    ? "translate-y-0 scale-100 opacity-100"
                    : "translate-y-2 scale-[0.98] opacity-0",
                )}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="label-text">Quote Carousel</p>
                    <h3
                      id={`quote-cta-link-${blockIndex}-${itemIndex}`}
                      className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]"
                    >
                      Call to action link
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={closeCtaLinkModal}
                    className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:text-[var(--color-text-primary)]"
                    aria-label="Close call to action link editor"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
                <label className="mt-5 grid gap-2">
                  <span className="label-text">Destination link</span>
                  <input
                    value={asString(itemRecord?.ctaLink)}
                    onChange={(event) => update("ctaLink", event.target.value)}
                    className="h-11 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-hairline-strong)] focus:bg-[var(--color-bg)]"
                    placeholder="/next-step"
                    autoFocus
                  />
                </label>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={closeCtaLinkModal}
                    className="inline-flex h-9 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface-raised)] px-4 text-[12px] font-medium text-[var(--color-text-primary)] transition-[background-color,border-color,transform] duration-[160ms] ease-out hover:-translate-y-0.5 hover:border-[var(--color-text-primary)] hover:bg-[var(--color-surface)]"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
