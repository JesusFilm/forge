// Round 48px chrome button used by HeroPlayerControls for play, mute,
// language, fullscreen. Transparent background, white icon, full-size tap
// target. Hover/focus feedback lives here so every player icon behaves
// consistently without reintroducing the removed dark button fill.

import { formatDuration } from "@/lib/format-duration"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react"

type TooltipAlign = "start" | "end"

export function ChromeButton({
  children,
  onClick,
  ariaLabel,
  testId,
  className = "",
  disabled = false,
  tooltipAlign = "end",
}: {
  children: React.ReactNode
  onClick: () => void
  ariaLabel: string
  testId: string
  className?: string
  disabled?: boolean
  tooltipAlign?: TooltipAlign
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const tooltipRef = useRef<HTMLSpanElement | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [isTooltipOpen, setIsTooltipOpen] = useState(false)

  const clampTooltipToViewport = useCallback(() => {
    const buttonElement = buttonRef.current
    const tooltipElement = tooltipRef.current
    if (!buttonElement || !tooltipElement) return

    const buttonRect = buttonElement.getBoundingClientRect()
    const tooltipWidth = tooltipElement.getBoundingClientRect().width
    const naturalLeft =
      tooltipAlign === "start"
        ? buttonRect.left
        : buttonRect.right - tooltipWidth
    const naturalRight = naturalLeft + tooltipWidth
    const viewportPadding = 8
    const shiftX =
      naturalLeft < viewportPadding
        ? viewportPadding - naturalLeft
        : naturalRight > window.innerWidth - viewportPadding
          ? window.innerWidth - viewportPadding - naturalRight
          : 0
    tooltipElement.style.setProperty("--chrome-tooltip-shift-x", `${shiftX}px`)
  }, [tooltipAlign])

  const clampOpenTooltip = useCallback(() => {
    const buttonElement = buttonRef.current
    if (buttonElement?.matches(":hover, :focus-visible")) {
      clampTooltipToViewport()
    }
  }, [clampTooltipToViewport])

  useLayoutEffect(clampOpenTooltip, [ariaLabel, clampOpenTooltip])

  const stopObservingViewport = useCallback(() => {
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
  }, [])

  const observeOpenTooltip = useCallback(() => {
    stopObservingViewport()
    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(clampOpenTooltip)
    const tooltipElement = tooltipRef.current
    if (tooltipElement) observer.observe(tooltipElement)
    observer.observe(document.documentElement)
    resizeObserverRef.current = observer
  }, [clampOpenTooltip, stopObservingViewport])

  useEffect(() => stopObservingViewport, [stopObservingViewport])

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => {
        if (!disabled) onClick()
      }}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      onMouseEnter={() => {
        if (
          typeof window.matchMedia === "function" &&
          !window.matchMedia("(hover: hover) and (pointer: fine)").matches
        ) {
          return
        }
        setIsTooltipOpen(true)
        clampTooltipToViewport()
        observeOpenTooltip()
      }}
      onMouseLeave={(event) => {
        if (event.currentTarget.matches(":focus-visible")) return
        setIsTooltipOpen(false)
        stopObservingViewport()
      }}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) {
          setIsTooltipOpen(true)
          clampTooltipToViewport()
          observeOpenTooltip()
        }
      }}
      onBlur={(event) => {
        if (event.currentTarget.matches(":hover")) return
        setIsTooltipOpen(false)
        stopObservingViewport()
      }}
      className={`group relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-white/90 transition-[color,filter,transform] duration-150 hover:scale-110 hover:text-white focus-visible:scale-110 focus-visible:text-brand-red focus-visible:ring-2 focus-visible:ring-brand-red/70 focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:text-white/40 aria-disabled:hover:scale-100 aria-disabled:hover:text-white/50 aria-disabled:focus-visible:scale-100 md:h-12 md:w-12 ${className}`}
    >
      {children}
      <span
        ref={tooltipRef}
        aria-hidden="true"
        role="tooltip"
        style={
          {
            "--chrome-tooltip-shift-x": "0px",
          } as CSSProperties
        }
        className={`pointer-events-none absolute bottom-full z-30 mb-2 w-max translate-x-[var(--chrome-tooltip-shift-x)] rounded-md bg-white px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-neutral-900 shadow-lg transition-[opacity,visibility] duration-150 ${
          isTooltipOpen
            ? "visible translate-y-0 opacity-100"
            : "invisible translate-y-1 opacity-0"
        } ${tooltipAlign === "start" ? "left-0" : "right-0"}`}
      >
        {ariaLabel}
      </span>
    </button>
  )
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  return formatDuration(seconds)
}
