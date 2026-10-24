"use client"

import {
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { useTranslations } from "next-intl"
import { X } from "lucide-react"

import {
  FloatingSearchFieldInput,
  useFloatingSearchInputAutofocus,
} from "./FloatingSearchField"
import {
  FLOATING_HEADER_FIELD_WIDTH_CLASS,
  FLOATING_HEADER_LANGUAGE_SLOT_CLASS,
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
  const floatingSearchT = useTranslations("FloatingSearch")
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

  // The header is inert while search is open, so this shell owns its own
  // close control and keeps Tab within its two controls until the full
  // overlay replaces it.
  const handleTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("input, button"),
    ).filter(
      (element) =>
        !element.hasAttribute("disabled") &&
        element.tabIndex >= 0 &&
        element.getClientRects().length > 0,
    )
    if (focusable.length === 0) return
    const index = focusable.indexOf(document.activeElement as HTMLElement)
    const next = event.shiftKey
      ? index <= 0
        ? focusable.length - 1
        : index - 1
      : index === -1 || index === focusable.length - 1
        ? 0
        : index + 1
    event.preventDefault()
    focusable[next]?.focus()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogLabel")}
      data-testid="search-overlay-instant-shell"
      onKeyDown={handleTab}
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
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
          onClick={(event) => event.stopPropagation()}
          className={`pointer-events-auto ${FLOATING_HEADER_FIELD_WIDTH_CLASS} ${FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS} col-span-2`}
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
            showSubmitButton={false}
            wrapperClassName="w-full"
          />
        </div>
        <div
          data-testid="search-overlay-instant-trailing-controls-spacer"
          className={FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS}
        >
          {headerLanguageControlVisible ? (
            <span
              aria-hidden="true"
              className={`hidden md:block ${FLOATING_HEADER_LANGUAGE_SLOT_CLASS} ${FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS}`}
            />
          ) : null}
          <button
            type="button"
            aria-label={floatingSearchT("closeSearch")}
            data-testid="search-overlay-instant-close"
            onClick={() => setOpen(false)}
            className="pointer-events-auto inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-stone-100 transition hover:text-white focus-visible:ring-2 focus-visible:ring-stone-300 focus-visible:outline-none md:h-[52px] md:w-[52px]"
          >
            <X aria-hidden className="h-6 w-6" />
          </button>
        </div>
      </div>

      <div
        aria-hidden="true"
        data-testid="search-overlay-instant-controls"
        className="search-overlay-scroll absolute inset-x-0 bottom-0 top-44 z-1 overflow-hidden px-4 pb-8 sm:px-6 md:top-32"
      >
        <div
          data-testid="search-overlay-instant-content"
          onClick={(event) => event.stopPropagation()}
          className="mx-auto grid max-w-[1400px] gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
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
