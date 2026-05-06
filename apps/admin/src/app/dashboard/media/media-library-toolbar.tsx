"use client"

import type { Route } from "next"
import { Check, ChevronDown, Folder, Search } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { cx } from "@/components/admin-ui"

type SupportedMediaKind = "IMAGE" | "VIDEO" | "PDF" | "FILE"

type ToolbarProps = {
  queryText: string
  selectedType: "all" | SupportedMediaKind
}

const TYPE_OPTIONS: Array<{
  value: "all" | SupportedMediaKind
  label: string
}> = [
  { value: "all", label: "All types" },
  { value: "IMAGE", label: "Images" },
  { value: "VIDEO", label: "Videos" },
  { value: "PDF", label: "PDFs" },
  { value: "FILE", label: "Files" },
]

export function MediaLibraryToolbar({ queryText, selectedType }: ToolbarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchValue, setSearchValue] = useState(queryText)

  const selectedTypeLabel = useMemo(
    () =>
      TYPE_OPTIONS.find((option) => option.value === selectedType)?.label ??
      "All types",
    [selectedType],
  )

  useEffect(() => {
    setSearchValue(queryText)
  }, [queryText])

  useEffect(() => {
    if (!menuOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [menuOpen])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const currentQuery = searchParams.get("q") ?? ""
      const nextQuery = searchValue.trim()

      if (currentQuery === nextQuery) {
        return
      }

      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.delete("asset")
      if (nextQuery.length > 0) {
        nextParams.set("q", nextQuery)
      } else {
        nextParams.delete("q")
      }

      const suffix = nextParams.toString()
      router.replace(`${pathname}${suffix ? `?${suffix}` : ""}` as Route)
    }, 200)

    return () => window.clearTimeout(timeout)
  }, [pathname, router, searchParams, searchValue])

  function applyTypeFilter(nextType: "all" | SupportedMediaKind) {
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete("asset")
    if (nextType === "all") {
      nextParams.delete("type")
    } else {
      nextParams.set("type", nextType)
    }

    const suffix = nextParams.toString()
    router.replace(`${pathname}${suffix ? `?${suffix}` : ""}` as Route)
    setMenuOpen(false)
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="min-w-0 shrink-0">
        <div className="flex items-center gap-2">
          <Folder
            className="h-4 w-4 text-[var(--color-text-muted)]"
            strokeWidth={1.5}
          />
          <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            Media Library
          </span>
        </div>
      </div>

      <div className="flex min-w-0 max-w-xl flex-1 items-center gap-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3">
          <Search
            className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]"
            strokeWidth={1.5}
          />
          <input
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search assets"
            className="w-full border-0 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
          />
        </label>

        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex h-8 items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            {selectedTypeLabel}
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>

          {menuOpen ? (
            <div
              className="absolute right-0 z-30 mt-2 grid min-w-36 gap-1 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
              role="menu"
            >
              {TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => applyTypeFilter(option.value)}
                  className={cx(
                    "inline-flex h-8 items-center justify-between gap-3 rounded-[2px] px-3 text-left text-[12px] transition-colors duration-[120ms] ease-out",
                    selectedType === option.value
                      ? "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
                  )}
                  role="menuitemradio"
                  aria-checked={selectedType === option.value}
                >
                  <span>{option.label}</span>
                  <Check
                    className={cx(
                      "h-3.5 w-3.5",
                      selectedType === option.value
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                    strokeWidth={1.5}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
