"use client"

import { useEffect, useState } from "react"
import { useFloatingSearch } from "./FloatingSearchProvider"

const PIN_THRESHOLD = 80

export function FloatingSearchBar() {
  const { open, query, setOpen } = useFloatingSearch()
  const [pinned, setPinned] = useState(false)

  // Mount-sync: compute initial pinned state from current scroll position
  // (covers the case where modal is pre-opened via ?q= and the scroll
  // listener below never registers until first close).
  useEffect(() => {
    if (typeof window !== "undefined") {
      setPinned(window.scrollY > PIN_THRESHOLD)
    }
  }, [])

  // Scroll listener: registered only while modal is closed. Uses a single
  // requestAnimationFrame per scroll burst to coalesce updates.
  useEffect(() => {
    if (open) return
    if (typeof window === "undefined") return

    let frame = 0
    const onScroll = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        setPinned(window.scrollY > PIN_THRESHOLD)
        frame = 0
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    // Sync once on (re)registration so the bar position matches reality
    // after the modal closes without waiting for the next scroll event.
    setPinned(window.scrollY > PIN_THRESHOLD)
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [open])

  const display = query.trim().length > 0 ? query : "Search or browse topics…"
  const isPlaceholder = query.trim().length === 0
  const topClass = pinned ? "top-[30px]" : "top-[128px]"
  const openClass = open
    ? "opacity-0 pointer-events-none"
    : "opacity-100 pointer-events-auto"

  return (
    <button
      type="button"
      aria-label="Search videos"
      onClick={() => setOpen(true)}
      inert={open || undefined}
      aria-hidden={open || undefined}
      className={`fixed left-1/2 z-50 -translate-x-1/2 rounded-[35px] bg-white/10 px-6 py-3 text-left text-white shadow-xl outline-1 outline-white/20 backdrop-blur-[10px] transition-[top,opacity] duration-300 ease-out w-[calc(100%-2rem)] max-w-[800px] focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2 ${topClass} ${openClass}`}
    >
      <span className={isPlaceholder ? "text-white/70" : "text-white"}>
        {display}
      </span>
    </button>
  )
}
