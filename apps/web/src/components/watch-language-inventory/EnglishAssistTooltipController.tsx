"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { englishAssistText } from "./english-assist"

const TARGET_SELECTOR = "[data-english-assist]"
const VIEWPORT_PADDING = 16
const TOOLTIP_GAP = 8
const TOOLTIP_MAX_WIDTH = 288

type ActiveTooltip = {
  target: HTMLElement
  text: string
}

type TooltipPosition = {
  left: number
  placement: "above" | "below"
  top: number
}

function assistTarget(value: EventTarget | null): HTMLElement | null {
  return value instanceof Element
    ? value.closest<HTMLElement>(TARGET_SELECTOR)
    : null
}

export function EnglishAssistTooltipController() {
  const [active, setActive] = useState<ActiveTooltip | null>(null)
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  const activeRef = useRef<ActiveTooltip | null>(null)
  const focusedTargetRef = useRef<HTMLElement | null>(null)
  const pointerTargetRef = useRef<HTMLElement | null>(null)
  const keyboardModeRef = useRef(true)
  const suppressedTitleRef = useRef<{
    target: HTMLElement
    title: string | null
  } | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const positionFrameRef = useRef<number | null>(null)

  const setActiveTooltip = useCallback((next: ActiveTooltip | null) => {
    activeRef.current = next
    setActive(next)
    if (!next) setPosition(null)
  }, [])

  const restoreNativeTitle = useCallback(() => {
    const suppressed = suppressedTitleRef.current
    if (!suppressed) return
    if (suppressed.title == null) {
      suppressed.target.removeAttribute("title")
    } else {
      suppressed.target.setAttribute("title", suppressed.title)
    }
    suppressedTitleRef.current = null
  }, [])

  const suppressNativeTitle = useCallback(
    (target: HTMLElement) => {
      if (suppressedTitleRef.current?.target === target) return
      restoreNativeTitle()
      const title = target.getAttribute("title")
      suppressedTitleRef.current = { target, title }
      // An empty title prevents the browser from inheriting a native tooltip
      // from a titled ancestor while the custom tooltip is active.
      target.setAttribute("title", "")
    },
    [restoreNativeTitle],
  )

  const positionTooltip = useCallback(() => {
    const current = activeRef.current
    if (!current) return
    if (!current.target.isConnected) {
      if (pointerTargetRef.current === current.target) {
        pointerTargetRef.current = null
      }
      if (focusedTargetRef.current === current.target) {
        focusedTargetRef.current = null
      }
      setActiveTooltip(null)
      restoreNativeTitle()
      return
    }

    const targetRect = current.target.getBoundingClientRect()
    const tooltipRect = tooltipRef.current?.getBoundingClientRect()
    const tooltipWidth = Math.min(
      tooltipRect?.width ?? TOOLTIP_MAX_WIDTH,
      window.innerWidth - VIEWPORT_PADDING * 2,
    )
    const tooltipHeight = tooltipRect?.height ?? 40
    const spaceAbove = targetRect.top - VIEWPORT_PADDING - TOOLTIP_GAP
    const spaceBelow =
      window.innerHeight - VIEWPORT_PADDING - targetRect.bottom - TOOLTIP_GAP
    const placement =
      spaceAbove >= tooltipHeight
        ? "above"
        : spaceBelow >= tooltipHeight
          ? "below"
          : spaceAbove >= spaceBelow
            ? "above"
            : "below"
    const centeredLeft = targetRect.left + targetRect.width / 2
    const left = Math.min(
      window.innerWidth - VIEWPORT_PADDING - tooltipWidth / 2,
      Math.max(VIEWPORT_PADDING + tooltipWidth / 2, centeredLeft),
    )
    const desiredTop =
      placement === "above"
        ? targetRect.top - TOOLTIP_GAP - tooltipHeight
        : targetRect.bottom + TOOLTIP_GAP
    const maxTop = Math.max(
      VIEWPORT_PADDING,
      window.innerHeight - VIEWPORT_PADDING - tooltipHeight,
    )
    const top = Math.min(maxTop, Math.max(VIEWPORT_PADDING, desiredTop))

    setPosition((previous) =>
      previous?.left === left &&
      previous.placement === placement &&
      previous.top === top
        ? previous
        : { left, placement, top },
    )
  }, [restoreNativeTitle, setActiveTooltip])

  const schedulePosition = useCallback(() => {
    if (positionFrameRef.current != null) return
    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null
      positionTooltip()
    })
  }, [positionTooltip])

  const show = useCallback(
    (target: HTMLElement, source: "focus" | "pointer") => {
      const text = englishAssistText(target.dataset.englishAssist ?? "")
      if (!text) return
      if (source === "pointer") suppressNativeTitle(target)
      setActiveTooltip({ target, text })
      positionTooltip()
    },
    [positionTooltip, setActiveTooltip, suppressNativeTitle],
  )

  useEffect(() => {
    if (!active) return
    schedulePosition()
    window.addEventListener("resize", schedulePosition)
    window.addEventListener("scroll", schedulePosition, true)

    return () => {
      window.removeEventListener("resize", schedulePosition)
      window.removeEventListener("scroll", schedulePosition, true)
      if (positionFrameRef.current != null) {
        window.cancelAnimationFrame(positionFrameRef.current)
        positionFrameRef.current = null
      }
    }
  }, [active, schedulePosition])

  useEffect(() => {
    function handlePointerOver(event: PointerEvent) {
      if (event.pointerType === "touch") return
      const target = assistTarget(event.target)
      if (!target || assistTarget(event.relatedTarget) === target) return
      pointerTargetRef.current = target
      show(target, "pointer")
    }

    function handlePointerOut(event: PointerEvent) {
      if (event.pointerType === "touch") return
      const target = assistTarget(event.target)
      if (!target || target !== pointerTargetRef.current) return
      if (assistTarget(event.relatedTarget) === target) return
      if (
        event.relatedTarget instanceof Node &&
        tooltipRef.current?.contains(event.relatedTarget)
      ) {
        return
      }

      pointerTargetRef.current = null
      restoreNativeTitle()
      if (keyboardModeRef.current && focusedTargetRef.current) {
        show(focusedTargetRef.current, "focus")
      } else {
        setActiveTooltip(null)
      }
    }

    function handleFocusIn(event: FocusEvent) {
      const target = assistTarget(event.target)
      if (!target) return
      focusedTargetRef.current = target
      if (keyboardModeRef.current) show(target, "focus")
    }

    function handleFocusOut(event: FocusEvent) {
      const target = assistTarget(event.target)
      if (!target || target !== focusedTargetRef.current) return
      if (assistTarget(event.relatedTarget) === target) return
      focusedTargetRef.current = null
      if (pointerTargetRef.current) {
        show(pointerTargetRef.current, "pointer")
      } else {
        restoreNativeTitle()
        setActiveTooltip(null)
      }
    }

    function handlePointerDown() {
      keyboardModeRef.current = false
      pointerTargetRef.current = null
      restoreNativeTitle()
      setActiveTooltip(null)
    }

    function handleKeyDown(event: KeyboardEvent) {
      keyboardModeRef.current = true
      if (event.key !== "Escape") {
        const focusedTarget = assistTarget(document.activeElement)
        if (focusedTarget) {
          focusedTargetRef.current = focusedTarget
          show(focusedTarget, "focus")
        }
        return
      }
      if (!activeRef.current) return
      pointerTargetRef.current = null
      focusedTargetRef.current = null
      restoreNativeTitle()
      setActiveTooltip(null)
    }

    document.addEventListener("pointerover", handlePointerOver)
    document.addEventListener("pointerout", handlePointerOut)
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("focusin", handleFocusIn)
    document.addEventListener("focusout", handleFocusOut)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerover", handlePointerOver)
      document.removeEventListener("pointerout", handlePointerOut)
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("focusin", handleFocusIn)
      document.removeEventListener("focusout", handleFocusOut)
      document.removeEventListener("keydown", handleKeyDown)
      restoreNativeTitle()
    }
  }, [restoreNativeTitle, setActiveTooltip, show])

  if (!active || typeof document === "undefined") return null

  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      lang="en"
      dir="ltr"
      data-testid="english-assist-tooltip"
      data-placement={position?.placement ?? "above"}
      onPointerEnter={() => {
        pointerTargetRef.current = active.target
      }}
      onPointerLeave={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          active.target.contains(event.relatedTarget)
        ) {
          return
        }
        pointerTargetRef.current = null
        restoreNativeTitle()
        if (keyboardModeRef.current && focusedTargetRef.current) {
          show(focusedTargetRef.current, "focus")
        } else {
          setActiveTooltip(null)
        }
      }}
      className="pointer-events-auto fixed z-[1100] w-max max-w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-white/15 bg-stone-900 px-3 py-2 text-center text-xs leading-5 font-semibold text-white shadow-2xl shadow-black/45"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        transform: "translateX(-50%)",
        visibility: position ? "visible" : "hidden",
      }}
    >
      <span
        aria-hidden="true"
        data-testid="english-assist-tooltip-pointer-bridge"
        className={`absolute left-1/2 h-2 w-[calc(100%+1rem)] -translate-x-1/2 ${
          position?.placement === "below" ? "bottom-full" : "top-full"
        }`}
      />
      {active.text}
    </div>,
    document.body,
  )
}
