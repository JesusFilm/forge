"use client"

import { useEffect, useRef, type ChangeEvent } from "react"
import { useTranslations } from "next-intl"

import {
  FloatingSearchFieldInput,
  useFloatingSearchInputAutofocus,
} from "./FloatingSearchField"
import {
  FLOATING_HEADER_FIELD_WIDTH_CLASS,
  FLOATING_HEADER_LANGUAGE_SLOT_CLASS,
  FLOATING_HEADER_TRAILING_SLOT_CLASS,
  FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS,
  FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS,
  FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS,
  FLOATING_MODAL_HEADER_LAYOUT_CLASS,
  FLOATING_MODAL_HEADER_LOGO_POSITION_CLASS,
  FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS,
  WATCH_PAGE_LEFT_EDGE_CLASSES,
  WATCH_PAGE_RIGHT_EDGE_CLASSES,
} from "@/lib/content-width"

type SearchOverlayInstantShellProps = {
  open: boolean
  closing: boolean
  query: string
  setQuery: (query: string) => void
  onSubmit: (query: string) => void
  setOpen: (open: boolean) => void
  headerTopClass: string
  logoSlotClass: string
  headerLanguageControlVisible: boolean
}

export function SearchOverlayInstantShell({
  open,
  closing,
  query,
  setQuery,
  onSubmit,
  setOpen,
  headerTopClass,
  logoSlotClass,
  headerLanguageControlVisible,
}: SearchOverlayInstantShellProps) {
  const t = useTranslations("SearchOverlay")
  const inputRef = useRef<HTMLInputElement>(null)

  useFloatingSearchInputAutofocus(open, inputRef)

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, setOpen])

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
  }

  const clearInput = () => {
    setQuery("")
    inputRef.current?.focus()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogLabel")}
      data-testid="search-overlay-instant-shell"
      className={`fixed inset-0 h-dvh min-h-dvh overflow-visible ${
        closing ? "animate-overlay-fade-out" : "animate-overlay-fade-in"
      }`}
      style={{
        zIndex: 45,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        data-testid="search-overlay-instant-top-bar"
        className={`pointer-events-none absolute ${WATCH_PAGE_LEFT_EDGE_CLASSES} ${WATCH_PAGE_RIGHT_EDGE_CLASSES} ${headerTopClass} z-10 ${FLOATING_MODAL_HEADER_LAYOUT_CLASS}`}
      >
        <div
          aria-hidden="true"
          className={`${logoSlotClass} ${FLOATING_MODAL_HEADER_LOGO_POSITION_CLASS}`}
        />
        <div
          data-testid="search-overlay-instant-field-shell"
          className={`pointer-events-auto ${FLOATING_HEADER_FIELD_WIDTH_CLASS} ${FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS} ${
            headerLanguageControlVisible ? "" : "col-span-2"
          }`}
        >
          <FloatingSearchFieldInput
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            onSubmit={onSubmit}
            onClear={clearInput}
            placeholder={t("placeholder")}
            aria-label={t("inputLabel")}
            iconTestId="search-overlay-instant-input-icon"
            autoFocus
            wrapperClassName="w-full"
          />
        </div>
        <div
          aria-hidden="true"
          data-testid="search-overlay-instant-trailing-controls-spacer"
          className={FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS}
        >
          {headerLanguageControlVisible ? (
            <span
              className={`${FLOATING_HEADER_LANGUAGE_SLOT_CLASS} ${FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS}`}
            />
          ) : null}
          <span
            className={`${FLOATING_HEADER_TRAILING_SLOT_CLASS} ${FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS}`}
          />
        </div>
      </div>

      <div
        aria-hidden="true"
        data-testid="search-overlay-instant-controls"
        className="search-overlay-scroll absolute inset-x-0 bottom-0 top-44 z-1 overflow-hidden px-4 pb-8 sm:px-6 md:top-32"
      >
        <div className="mx-auto grid max-w-[1400px] gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="h-32 rounded-md border border-white/10 bg-white/8"
            />
          ))}
        </div>
      </div>
    </div>
  )
}
