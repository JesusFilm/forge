"use client"

import {
  useFloatingSearch,
  useFloatingSearchPinned,
} from "./FloatingSearchProvider"

export function FloatingSearchBar() {
  const { open, closing, query, setOpen } = useFloatingSearch()
  const { pinned } = useFloatingSearchPinned()

  const display = query.trim().length > 0 ? query : "Search or browse topics…"
  const isPlaceholder = query.trim().length === 0
  const topClass = pinned ? "top-3" : "top-10"
  // Keep the bar fully hidden (and non-interactive) for the entire close
  // animation — not just while `open` is true — so it never appears in the
  // tab order while the overlay is still visible above it.
  const chromeHidden = open || closing
  const openClass = chromeHidden
    ? "opacity-0 pointer-events-none"
    : "opacity-100 pointer-events-auto"

  return (
    <button
      type="button"
      aria-label="Search videos"
      onClick={() => setOpen(true)}
      inert={chromeHidden || undefined}
      aria-hidden={chromeHidden || undefined}
      className={`fixed left-[calc(50%+8px)] z-50 -translate-x-1/2 rounded-[35px] bg-white/10 px-6 py-3 text-left text-white shadow-xl outline-1 outline-white/20 backdrop-blur-[10px] transition-[top,opacity] duration-300 ease-out w-[calc(100%-2rem)] sm:w-[calc(100%-3rem)] max-w-[810px] [text-shadow:0_1px_3px_rgba(0,0,0,0.5)] focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2 ${topClass} ${openClass}`}
    >
      <span className={isPlaceholder ? "text-white/90" : "text-white"}>
        {display}
      </span>
    </button>
  )
}
