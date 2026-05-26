"use client"

import { Search } from "lucide-react"

import {
  useFloatingSearch,
  useFloatingSearchPinned,
} from "./FloatingSearchProvider"
import { FloatingSearchFieldButton } from "./FloatingSearchField"

export function FloatingSearchBar() {
  const { open, closing, query, setOpen } = useFloatingSearch()
  const { pinned, searchChromeVisible } = useFloatingSearchPinned()

  const display = query.trim().length > 0 ? query : "Search or browse topics…"
  const isPlaceholder = query.trim().length === 0
  const topClass = pinned ? "top-4" : "top-12"
  // Keep the bar fully hidden (and non-interactive) for the entire close
  // animation — not just while `open` is true — so it never appears in the
  // tab order while the overlay is still visible above it.
  const chromeHidden = open || closing || !searchChromeVisible
  const openClass = chromeHidden
    ? "opacity-0 pointer-events-none"
    : "opacity-100 pointer-events-auto"

  return (
    <>
      <button
        type="button"
        aria-label="Search videos"
        data-testid="floating-search-mobile-button"
        onClick={() => setOpen(true)}
        inert={chromeHidden || undefined}
        aria-hidden={chromeHidden || undefined}
        className={`fixed right-36 z-50 inline-flex h-[52px] w-12 cursor-pointer items-center justify-center rounded-full text-stone-100 transition-[top,opacity,color] duration-300 ease-out hover:text-white focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:outline-none sm:hidden ${topClass} ${openClass}`}
      >
        <Search
          aria-hidden
          data-testid="floating-search-icon"
          className="h-6 w-6"
        />
      </button>
      <FloatingSearchFieldButton
        aria-label="Search videos"
        data-testid="floating-search-desktop-button"
        onClick={() => setOpen(true)}
        inert={chromeHidden || undefined}
        aria-hidden={chromeHidden || undefined}
        display={display}
        isPlaceholder={isPlaceholder}
        className={`fixed right-44 left-4 z-50 hidden sm:left-36 sm:flex md:left-48 md:right-52 xl:left-60 xl:right-60 ${topClass} ${openClass}`}
      />
    </>
  )
}
