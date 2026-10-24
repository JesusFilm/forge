"use client"

import { useTranslations } from "next-intl"

import { useFloatingSearchPinned } from "./FloatingSearchProvider"
import { FloatingSearchFieldButton } from "./FloatingSearchField"

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
  const { searchChromeDimmed, searchChromeVisible } = useFloatingSearchPinned()

  const display = query.trim().length > 0 ? query : t("placeholder")
  const isPlaceholder = query.trim().length === 0
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
    <FloatingSearchFieldButton
      aria-label={t("openSearch")}
      data-testid="floating-search-desktop-button"
      onClick={onOpen}
      inert={chromeHidden || undefined}
      aria-hidden={chromeHidden || undefined}
      display={display}
      mobileDisplay={isPlaceholder ? t("openSearch") : undefined}
      isPlaceholder={isPlaceholder}
      className={`h-[52px] w-full ${openClass}`}
    />
  )
}
