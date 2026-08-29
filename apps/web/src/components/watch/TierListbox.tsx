"use client"

import { Check, ChevronDown } from "lucide-react"
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { createPortal } from "react-dom"

import type { DownloadTier } from "@/components/watch/download-options"
import { cn } from "@/lib/utils"

/**
 * Dark, portaled quality-tier picker.
 *
 * The popup mechanics (body portal, fixed positioning under the trigger,
 * capture-phase Escape and outside-pointerdown close, resize/scroll
 * repositioning, mount/unmount animation window) are lifted from the inline
 * tier dropdown in `DownloadModal.tsx`; the keyboard model (arrow keys with
 * `aria-activedescendant`, focus staying on the trigger) follows
 * `LanguageCombobox`. Migrating `DownloadModal` onto this component is
 * tracked separately.
 */
export const TIER_LISTBOX_ANIMATION_MS = 160
const POPUP_GAP_PX = 8
const BASE_TRIGGER_CLASSES =
  "flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left text-lg font-semibold text-stone-100 transition hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"

export type TierListboxProps = {
  tiers: DownloadTier[]
  value: DownloadTier | null
  onChange: (tier: DownloadTier) => void
  /** Localized label for a tier; only called with a tier from `tiers`. */
  getLabel: (tier: DownloadTier) => string
  /** Trigger copy when `value` is null (nothing selectable yet). */
  placeholder: string
  disabled?: boolean
  /** Id of the visible label element; names both the trigger and the list. */
  labelledBy: string
  /** `${prefix}` on the trigger, `${prefix}-list`, `${prefix}-option`. */
  testIdPrefix: string
  /** Merged over the base trigger classes with twMerge, so overrides win. */
  triggerClassName?: string
}

type PopupRect = { left: number; top: number; width: number }

export function TierListbox({
  tiers,
  value,
  onChange,
  getLabel,
  placeholder,
  disabled = false,
  labelledBy,
  testIdPrefix,
  triggerClassName,
}: TierListboxProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [rect, setRect] = useState<PopupRect | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (tier: DownloadTier) => `${baseId}-option-${tier}`

  const selectedIndex = value == null ? -1 : tiers.indexOf(value)
  const selected = selectedIndex >= 0 ? tiers[selectedIndex] : null
  const activeTier = open ? tiers[activeIndex] : undefined

  const updateRect = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const bounds = trigger.getBoundingClientRect()
    setRect({
      left: bounds.left,
      top: bounds.bottom + POPUP_GAP_PX,
      width: bounds.width,
    })
  }, [])

  const openList = useCallback(() => {
    if (disabled || tiers.length === 0) return
    updateRect()
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setMounted(false)
    setOpen(true)
  }, [disabled, selectedIndex, tiers.length, updateRect])

  const closeList = useCallback((options: { refocus?: boolean } = {}) => {
    setOpen((wasOpen) => {
      if (wasOpen) setMounted(true)
      return false
    })
    if (options.refocus !== false) triggerRef.current?.focus()
  }, [])

  const select = useCallback(
    (tier: DownloadTier) => {
      onChange(tier)
      closeList()
    },
    [closeList, onChange],
  )

  // Keep the popup mounted for the close animation, then drop it.
  useEffect(() => {
    if (open || !mounted) return
    const timeout = window.setTimeout(() => {
      setMounted(false)
      setRect(null)
    }, TIER_LISTBOX_ANIMATION_MS)
    return () => window.clearTimeout(timeout)
  }, [mounted, open])

  // Outside-press and Escape-first close while open. Both listen in the
  // capture phase so Escape can stop before base-ui's Dialog (a bubble-phase
  // document listener) also sees it and closes the whole modal.
  useEffect(() => {
    if (!open) return
    updateRect()
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (
        triggerRef.current?.contains(target) ||
        listRef.current?.contains(target)
      ) {
        return
      }
      closeList()
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      event.stopPropagation()
      closeList()
    }
    function handleViewportChange() {
      updateRect()
    }
    document.addEventListener("pointerdown", handlePointerDown, true)
    document.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("scroll", handleViewportChange, true)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
      document.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
    }
  }, [closeList, open, updateRect])

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    const last = tiers.length - 1
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        openList()
      }
      return
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        setActiveIndex((index) => Math.min(index + 1, last))
        break
      case "ArrowUp":
        event.preventDefault()
        setActiveIndex((index) => Math.max(index - 1, 0))
        break
      case "Home":
        event.preventDefault()
        setActiveIndex(0)
        break
      case "End":
        event.preventDefault()
        setActiveIndex(last)
        break
      case "Enter":
      case " ": {
        event.preventDefault()
        const tier = tiers[activeIndex]
        if (tier) select(tier)
        break
      }
      case "Tab":
        closeList({ refocus: false })
        break
      default:
        break
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        data-testid={testIdPrefix}
        data-open={open ? "true" : "false"}
        // APG select-only combobox: the trigger owns focus and exposes the
        // highlighted option through aria-activedescendant.
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelledBy}
        aria-activedescendant={activeTier ? optionId(activeTier) : undefined}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={handleTriggerKeyDown}
        className={cn(BASE_TRIGGER_CLASSES, triggerClassName)}
      >
        <span className={selected ? undefined : "text-stone-400"}>
          {selected ? getLabel(selected) : placeholder}
        </span>
        <ChevronDown
          size={20}
          aria-hidden
          className={cn(
            "shrink-0 transition-transform",
            open ? "rotate-180" : "",
          )}
        />
      </button>
      {(open || mounted) && rect != null && typeof document !== "undefined"
        ? createPortal(
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-labelledby={labelledBy}
              data-testid={`${testIdPrefix}-list`}
              data-open={open ? "true" : "false"}
              className={cn(
                "fixed z-[1000] max-h-72 origin-top overflow-y-auto rounded-2xl border border-white/10 bg-stone-950/95 shadow-2xl backdrop-blur-md transition-[opacity,transform] duration-150 ease-out",
                open
                  ? "translate-y-0 scale-100 opacity-100"
                  : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0",
              )}
              style={{ left: rect.left, top: rect.top, width: rect.width }}
            >
              {tiers.map((tier, index) => {
                const isSelected = tier === selected
                const isActive = open && index === activeIndex
                return (
                  <li key={tier}>
                    <button
                      type="button"
                      role="option"
                      id={optionId(tier)}
                      aria-selected={isSelected}
                      data-testid={`${testIdPrefix}-option`}
                      data-tier={tier}
                      data-active={isActive ? "true" : undefined}
                      tabIndex={-1}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(tier)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left text-base sm:text-sm transition",
                        isSelected
                          ? "bg-brand-red text-white"
                          : "text-stone-100 hover:bg-white/10",
                        isActive && !isSelected ? "bg-white/10" : "",
                        isActive && isSelected
                          ? "ring-2 ring-inset ring-white/60"
                          : "",
                      )}
                    >
                      <Check
                        size={16}
                        aria-hidden
                        className={isSelected ? "opacity-100" : "opacity-0"}
                      />
                      <span className="font-semibold">{getLabel(tier)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  )
}
