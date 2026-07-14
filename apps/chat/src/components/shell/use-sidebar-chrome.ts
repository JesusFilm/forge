"use client"

import {
  type RefObject,
  type TransitionEvent,
  useEffect,
  useRef,
  useState,
} from "react"

type UseSidebarChromeOptions = {
  collapsed: boolean
  mobileOpen: boolean
  onToggleCollapsed: () => void
  onCloseMobile: () => void
}

type SidebarChrome = {
  /** Whether the rail clips overflow right now (true while animating or expanded). */
  clip: boolean
  /** Attach to the mobile close (X) button so the drawer can focus it on open. */
  closeRef: RefObject<HTMLButtonElement | null>
  /** Wraps onToggleCollapsed to start the clip-during-animation flag. */
  handleToggleCollapsed: () => void
  /** Clears the clip flag once the rail's width transition finishes. */
  handleTransitionEnd: (event: TransitionEvent<HTMLElement>) => void
}

/**
 * Owns the sidebar's local UI mechanics so the JSX stays presentational: the
 * collapse clip state machine (clip while the width animates, restore overflow
 * once a collapsed rail settles so its tooltip can escape), an Escape listener
 * that closes the mobile drawer, and the drawer focus trap (focus the close
 * button on open; restore the trigger on close, only while it's still visible).
 * State ownership (`collapsed`/`mobileOpen`) stays in AppShell — this hook only
 * derives presentation from those flags and the toggle/close callbacks.
 */
export function useSidebarChrome({
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onCloseMobile,
}: UseSidebarChromeOptions): SidebarChrome {
  const closeRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  // Clip the rail while its width animates so expanded content is revealed
  // left-to-right instead of reflowing; overflow is restored once collapsed and
  // settled, so the "Open sidebar" tooltip can overflow to the right.
  const [animatingCollapse, setAnimatingCollapse] = useState(false)

  // Start clipping the moment a collapse/expand is initiated (not in an effect —
  // that trips react-hooks/set-state-in-effect); the transitionend clears it.
  const handleToggleCollapsed = () => {
    setAnimatingCollapse(true)
    onToggleCollapsed()
  }

  // Clip during the width animation; keep overflow visible only once a collapsed
  // rail has settled (so its hover tooltip can escape to the right).
  const clip = animatingCollapse || !collapsed

  const handleTransitionEnd = (event: TransitionEvent<HTMLElement>) => {
    if (event.propertyName === "width") setAnimatingCollapse(false)
  }

  // Fallback clear: if the width transitionend never fires (e.g. transitions
  // disabled globally), drop the flag anyway so overflow can't latch hidden.
  useEffect(() => {
    if (!animatingCollapse) return
    const id = setTimeout(() => setAnimatingCollapse(false), 400)
    return () => clearTimeout(id)
  }, [animatingCollapse])

  // Escape closes the mobile drawer (parity with the X button and scrim).
  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseMobile()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [mobileOpen, onCloseMobile])

  // Mobile drawer focus: on open, store the trigger and focus the close button
  // (AppShell marks <main> inert to trap focus); on close, restore the trigger.
  // Desktop never enters this — `mobileOpen` is mobile-only.
  useEffect(() => {
    if (mobileOpen) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      closeRef.current?.focus()
    } else if (triggerRef.current) {
      // Restore only if the trigger is still visible — after a resize past `md`
      // the mobile hamburger is display:none, and focusing it drops focus to body.
      const trigger = triggerRef.current
      triggerRef.current = null
      if (trigger.isConnected && trigger.offsetParent !== null) trigger.focus()
    }
  }, [mobileOpen])

  return { clip, closeRef, handleToggleCollapsed, handleTransitionEnd }
}
