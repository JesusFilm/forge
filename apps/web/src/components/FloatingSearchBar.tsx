"use client"

import { Search } from "lucide-react"
import { useTranslations } from "next-intl"

import { useFloatingSearchPinned } from "./FloatingSearchProvider"
import { FloatingSearchFieldButton } from "./FloatingSearchField"
import {
  WATCH_PAGE_MOBILE_SEARCH_RIGHT_CLASSES,
  WATCH_PAGE_SEARCH_FIELD_CLASSES,
} from "@/lib/content-width"

type FloatingSearchBarProps = {
  open: boolean
  closing: boolean
  query: string
  onOpen: () => void
}

export function FloatingSearchBar({
  open,
  closing,
  query,
  onOpen,
}: FloatingSearchBarProps) {
  const t = useTranslations("FloatingSearch")
  const { pinned, searchChromeDimmed, searchChromeVisible } =
    useFloatingSearchPinned()

  const display = query.trim().length > 0 ? query : t("placeholder")
  const isPlaceholder = query.trim().length === 0
  const topClass = pinned
    ? "top-[calc(env(safe-area-inset-top,0px)+1rem)]"
    : "top-[calc(env(safe-area-inset-top,0px)+2rem)] md:top-[calc(env(safe-area-inset-top,0px)+3rem)]"
  // Keep the bar fully hidden (and non-interactive) for the entire close
  // animation — not just while `open` is true — so it never appears in the
  // tab order while the overlay is still visible above it.
  const chromeHidden = open || closing || !searchChromeVisible
  const openClass = chromeHidden
    ? "opacity-0 pointer-events-none"
    : searchChromeDimmed
      ? "opacity-30 pointer-events-auto"
      : "opacity-100 pointer-events-auto"

  return (
    <>
      <button
        type="button"
        aria-label={t("openSearch")}
        data-testid="floating-search-mobile-button"
        onClick={onOpen}
        inert={chromeHidden || undefined}
        aria-hidden={chromeHidden || undefined}
        className={`fixed ${WATCH_PAGE_MOBILE_SEARCH_RIGHT_CLASSES} z-50 inline-flex h-[52px] w-12 cursor-pointer items-center justify-center rounded-full text-stone-100 transition-[top,opacity,color] duration-300 ease-out hover:text-white focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:outline-none sm:hidden ${topClass} ${openClass}`}
      >
        <Search
          aria-hidden
          data-testid="floating-search-icon"
          className="h-6 w-6"
        />
      </button>
      <FloatingSearchFieldButton
        aria-label={t("openSearch")}
        data-testid="floating-search-desktop-button"
        onClick={onOpen}
        inert={chromeHidden || undefined}
        aria-hidden={chromeHidden || undefined}
        display={display}
        isPlaceholder={isPlaceholder}
        className={`fixed ${WATCH_PAGE_SEARCH_FIELD_CLASSES} z-50 hidden sm:flex ${topClass} ${openClass}`}
      />
    </>
  )
}
