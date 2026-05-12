"use client"

import { ChevronsUpDown, Languages } from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"

export type LanguageComboboxOption = {
  slug: string
  name: string
}

export type LanguageComboboxProps = {
  options: LanguageComboboxOption[]
  value: string
  onChange: (slug: string) => void
}

export function LanguageCombobox({
  options,
  value,
  onChange,
}: LanguageComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  // Mirror activeIndex in a ref so keydown handlers always read the latest value
  // even when multiple key events fire within the same React batch.
  const activeIndexRef = useRef(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const selected = options.find((o) => o.slug === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.name.toLowerCase().includes(q))
  }, [options, query])

  // Keep ref in sync with state
  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  // Also keep a ref for filtered so keydown can read it without stale closure
  const filteredRef = useRef(filtered)
  filteredRef.current = filtered

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    setActiveIndex(0)
    activeIndexRef.current = 0
    setQuery("")
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(event: MouseEvent) {
      const target = event.target as Node
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [open])

  // Reset query and active index together so the list is always in sync with
  // the search input — avoids the off-by-one that a post-render clamp useEffect produces.
  const resetQuery = useCallback((next: string) => {
    setQuery(next)
    setActiveIndex(0)
    activeIndexRef.current = 0
  }, [])

  const handleSelect = useCallback(
    (slug: string) => {
      onChange(slug)
      setOpen(false)
      triggerRef.current?.focus()
    },
    [onChange],
  )

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        // Update ref immediately so a subsequent key event in the same batch
        // (e.g. ArrowDown then Enter) reads the correct index.
        const next = Math.min(
          activeIndexRef.current + 1,
          filteredRef.current.length - 1,
        )
        activeIndexRef.current = next
        setActiveIndex(next)
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        const prev = Math.max(activeIndexRef.current - 1, 0)
        activeIndexRef.current = prev
        setActiveIndex(prev)
      } else if (event.key === "Enter") {
        event.preventDefault()
        const option = filteredRef.current[activeIndexRef.current]
        if (option) handleSelect(option.slug)
      } else if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    },
    [handleSelect],
  )

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="language-combobox-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center justify-between gap-3 rounded-full border border-stone-700 bg-stone-800/60 px-4 py-3 text-left text-base font-medium text-stone-100 transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
      >
        <span className="flex items-center gap-3">
          <Languages aria-hidden className="h-5 w-5 text-stone-400" />
          <span>{selected?.name}</span>
        </span>
        <ChevronsUpDown aria-hidden className="h-4 w-4 text-stone-400" />
      </button>

      {open ? (
        <div
          ref={popoverRef}
          data-testid="language-combobox-popover"
          className="absolute left-0 right-0 z-20 mt-2 rounded-2xl border border-stone-700 bg-stone-900 shadow-xl"
        >
          <div className="border-b border-stone-700 px-3 py-2">
            <input
              ref={searchRef}
              data-testid="language-combobox-search"
              type="text"
              value={query}
              onChange={(e) => resetQuery(e.target.value)}
              // jsdom-only: dispatchEvent(new Event("input")) does not trigger React's synthetic onChange.
              // In production both fire on every keystroke; React batches identical setQuery values, so no double-render.
              onInput={(e) => resetQuery((e.target as HTMLInputElement).value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search languages…"
              aria-activedescendant={
                filtered[activeIndex]
                  ? `lcb-opt-${filtered[activeIndex].slug}`
                  : undefined
              }
              className="w-full bg-transparent text-sm text-stone-100 placeholder:text-stone-500 focus:outline-none"
            />
          </div>
          {/* Non-virtualised: acceptable up to a few thousand items. Revisit if scroll jank appears on lower-end devices. */}
          <ul
            role="listbox"
            aria-label="Languages"
            className="max-h-72 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li
                data-testid="language-combobox-empty"
                className="px-4 py-3 text-sm text-stone-500"
              >
                No matches
              </li>
            ) : (
              filtered.map((option, index) => {
                const active = index === activeIndex
                return (
                  <li key={option.slug}>
                    <button
                      type="button"
                      id={`lcb-opt-${option.slug}`}
                      role="option"
                      aria-selected={active}
                      data-testid="language-combobox-option"
                      data-language-slug={option.slug}
                      data-active={active ? "true" : "false"}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => handleSelect(option.slug)}
                      className={`w-full px-4 py-2 text-left text-sm transition ${
                        active
                          ? "bg-stone-700 text-stone-50"
                          : "text-stone-200 hover:bg-stone-800"
                      }`}
                    >
                      {option.name}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
