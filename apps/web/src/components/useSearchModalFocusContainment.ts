"use client"

import { useEffect, type RefObject } from "react"

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  '[tabindex]:not([tabindex="-1"])',
].join(", ")

function isFocusable(element: HTMLElement): boolean {
  return (
    element.tabIndex >= 0 &&
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-hidden") !== "true" &&
    element.closest('[aria-hidden="true"], [inert]') == null
  )
}

/**
 * The modal input lives in a lazy overlay while the logo, language button, and
 * close button stay in the persistent floating header. Keep one tab sequence
 * across those two DOM islands so keyboard focus cannot escape to the page.
 */
export function useSearchModalFocusContainment(
  active: boolean,
  overlayRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return

    function handleTab(event: KeyboardEvent) {
      if (event.key !== "Tab") return

      const overlayFocusable = Array.from(
        overlayRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ??
          [],
      ).filter(isFocusable)
      const headerLogo = document.querySelector<HTMLElement>(
        '[data-testid="floating-header-logo"]',
      )
      const headerLanguage = document.querySelector<HTMLElement>(
        '[data-testid="floating-header-language-button"]',
      )
      const headerClose = document.querySelector<HTMLElement>(
        '[data-testid="floating-header-search-close"]',
      )
      const focusable = [
        headerLogo,
        ...overlayFocusable,
        headerLanguage,
        headerClose,
      ].filter(
        (element): element is HTMLElement =>
          element != null && isFocusable(element),
      )

      if (focusable.length === 0) return

      const activeIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      )
      const nextIndex = event.shiftKey
        ? activeIndex <= 0
          ? focusable.length - 1
          : activeIndex - 1
        : activeIndex === -1 || activeIndex >= focusable.length - 1
          ? 0
          : activeIndex + 1

      event.preventDefault()
      focusable[nextIndex]?.focus()
    }

    document.addEventListener("keydown", handleTab)
    return () => document.removeEventListener("keydown", handleTab)
  }, [active, overlayRef])
}
