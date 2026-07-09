"use client"

import {
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { X } from "lucide-react"
import { useTranslations } from "next-intl"

import { FloatingSearchFieldInput } from "./FloatingSearchField"
import { SEARCH_OVERLAY_FIELD_WIDTH_CLASSES } from "@/lib/content-width"

type SearchOverlayInstantShellProps = {
  open: boolean
  closing: boolean
  query: string
  setQuery: (query: string) => void
  setOpen: (open: boolean) => void
}

export function SearchOverlayInstantShell({
  open,
  closing,
  query,
  setQuery,
  setOpen,
}: SearchOverlayInstantShellProps) {
  const t = useTranslations("SearchOverlay")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [open])

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

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.preventDefault()
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
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-4 pt-[calc(env(safe-area-inset-top,0px)+2rem)] sm:px-6 md:pt-[calc(env(safe-area-inset-top,0px)+3rem)]">
        <div
          className={`pointer-events-auto md:mx-0 md:max-w-[calc(100vw-11rem)] xl:mx-auto xl:max-w-[810px] ${SEARCH_OVERLAY_FIELD_WIDTH_CLASSES}`}
        >
          <FloatingSearchFieldInput
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onClear={clearInput}
            placeholder={t("placeholder")}
            aria-label={t("inputLabel")}
            iconTestId="search-overlay-instant-input-icon"
            wrapperClassName="w-full"
          />
        </div>
      </div>

      <button
        type="button"
        aria-label="Close search"
        data-testid="search-overlay-instant-close"
        onClick={() => setOpen(false)}
        className="fixed right-4 top-[calc(env(safe-area-inset-top,0px)+2rem)] z-20 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-white/12 text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 md:right-10 md:top-[calc(env(safe-area-inset-top,0px)+3rem)]"
      >
        <X size={20} aria-hidden />
      </button>

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
