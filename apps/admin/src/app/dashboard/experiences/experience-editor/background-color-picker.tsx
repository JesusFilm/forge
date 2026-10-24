import { Palette, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cx } from "@/components/admin-ui"

type BackgroundColorOption = {
  label: string
  value: string
}

type PopoverPosition = {
  top: number
  left: number
}

const BACKGROUND_COLOR_OPTIONS: BackgroundColorOption[] = [
  { label: "Ink", value: "#151515" },
  { label: "Slate", value: "#26313f" },
  { label: "Pine", value: "#18372d" },
  { label: "Ocean", value: "#173a4a" },
  { label: "Indigo", value: "#26315e" },
  { label: "Plum", value: "#39233f" },
  { label: "Wine", value: "#4a2028" },
  { label: "Clay", value: "#4a3024" },
  { label: "Gold", value: "#5a431f" },
  { label: "Moss", value: "#3a4428" },
  { label: "Teal", value: "#174247" },
]

export function isHexColor(value: unknown) {
  return /^#[0-9a-fA-F]{6}$/.test(typeof value === "string" ? value.trim() : "")
}

export function normalizeHexColor(value: unknown, fallback = "#151515") {
  const color = typeof value === "string" ? value.trim() : ""
  return isHexColor(color) ? color : fallback
}

function normalizeCustomHex(value: string) {
  const trimmed = value.trim()
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`
}

export function BackgroundColorPicker({
  value,
  label,
  description,
  customLabel,
  onChange,
  onOpenChange,
  onTrigger,
  triggerClassName,
  popoverClassName,
  align = "right",
}: {
  value: unknown
  label: string
  description: string
  customLabel: string
  onChange: (value: string) => void
  onOpenChange?: (open: boolean) => void
  onTrigger?: () => void
  triggerClassName?: string
  popoverClassName?: string
  align?: "left" | "right"
}) {
  const [open, setOpen] = useState(false)
  const [customHexColor, setCustomHexColor] = useState("")
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [popoverPosition, setPopoverPosition] =
    useState<PopoverPosition | null>(null)
  const hasCustomColor = isHexColor(value)
  const normalizedColor = normalizeHexColor(value)
  const normalizedCustomColor = normalizeCustomHex(customHexColor)
  const canApplyCustomColor = isHexColor(normalizedCustomColor)

  const setPickerOpen = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [onOpenChange],
  )

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === "undefined") return

    const rect = trigger.getBoundingClientRect()
    const width = 264
    const gutter = 12
    const preferredLeft = align === "left" ? rect.left : rect.right - width
    const left = Math.min(
      Math.max(gutter, preferredLeft),
      window.innerWidth - width - gutter,
    )
    const top = Math.min(
      rect.bottom + 8,
      Math.max(gutter, window.innerHeight - 260 - gutter),
    )

    setPopoverPosition({ top, left })
  }, [align])

  function applyCustomHexColor() {
    if (!canApplyCustomColor) return
    onChange(normalizedCustomColor)
    setCustomHexColor("")
  }

  const popover = open ? (
    <div
      ref={popoverRef}
      className={cx(
        "fixed z-[90] w-[264px] rounded-sm border border-[var(--color-hairline-strong)] bg-[color-mix(in_oklab,var(--color-surface)_96%,black)] p-3 text-left shadow-[0_18px_48px_rgba(0,0,0,0.42)]",
        popoverClassName,
      )}
      style={{
        top: popoverPosition?.top ?? -9999,
        left: popoverPosition?.left ?? -9999,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Background
          </div>
          <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            {description}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setPickerOpen(false)
          }}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
          aria-label="Close background color picker"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onChange("")
          }}
          className={cx(
            "flex h-12 cursor-pointer items-center justify-center rounded-sm border bg-[var(--color-surface-inset)] text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-45",
            hasCustomColor
              ? "border-[var(--color-hairline)]"
              : "border-[var(--color-text-primary)]",
          )}
          disabled={!hasCustomColor}
          aria-label="Clear background color"
          aria-pressed={!hasCustomColor}
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
        {BACKGROUND_COLOR_OPTIONS.map((option) => {
          const isActive =
            hasCustomColor &&
            option.value.toLowerCase() === normalizedColor.toLowerCase()

          return (
            <button
              key={option.value}
              type="button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onChange(option.value)
              }}
              className={cx(
                "group flex h-12 cursor-pointer flex-col justify-end overflow-hidden rounded-sm border p-1.5 text-left transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)]",
                isActive
                  ? "border-[var(--color-text-primary)]"
                  : "border-[var(--color-hairline)]",
              )}
              style={{ backgroundColor: option.value }}
              aria-label={`Use ${option.label} background`}
              aria-pressed={isActive}
            >
              <span className="text-[9px] font-medium leading-3 text-white/78 drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]">
                {option.label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex h-8 items-center overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)]">
        <input
          value={customHexColor}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setCustomHexColor(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            event.stopPropagation()
            applyCustomHexColor()
          }}
          className="min-w-0 flex-1 border-0 bg-transparent px-2 font-mono text-[11px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
          placeholder="#224466"
          aria-label={customLabel}
        />
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            applyCustomHexColor()
          }}
          className="h-full cursor-pointer border-l border-[var(--color-hairline)] px-2 text-[11px] font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!canApplyCustomColor}
        >
          Custom
        </button>
      </div>
    </div>
  ) : null

  useEffect(() => {
    if (!open) return

    updatePopoverPosition()
    let frameId: number | null = null
    const startedAt = performance.now()

    function trackLayoutAnimation(now: number) {
      updatePopoverPosition()
      if (now - startedAt >= 360) {
        frameId = null
        return
      }
      frameId = window.requestAnimationFrame(trackLayoutAnimation)
    }

    frameId = window.requestAnimationFrame(trackLayoutAnimation)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPickerOpen(false)
      }
    }

    function handlePointerDown(event: MouseEvent) {
      if (!pickerRef.current) return
      if (popoverRef.current?.contains(event.target as Node)) return
      if (pickerRef.current.contains(event.target as Node)) return
      setPickerOpen(false)
    }

    function handleReposition() {
      updatePopoverPosition()
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("mousedown", handlePointerDown)
    window.addEventListener("resize", handleReposition)
    window.addEventListener("scroll", handleReposition, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("mousedown", handlePointerDown)
      window.removeEventListener("resize", handleReposition)
      window.removeEventListener("scroll", handleReposition, true)
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [open, setPickerOpen, updatePopoverPosition])

  return (
    <div ref={pickerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        draggable={false}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onTrigger?.()
          setPickerOpen(!open)
        }}
        className={cx(
          "flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm border bg-[var(--color-surface-inset)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:text-[var(--color-text-primary)]",
          open
            ? "border-[var(--color-text-primary)] text-[var(--color-text-primary)]"
            : "border-[var(--color-hairline)] hover:border-[var(--color-hairline-strong)]",
          triggerClassName,
        )}
        data-open={open}
        aria-label={label}
        aria-expanded={open}
      >
        <Palette className="h-4 w-4" strokeWidth={1.5} />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : null}
    </div>
  )
}
