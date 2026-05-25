"use client"

import { ChevronsUpDown, Languages, type LucideIcon } from "lucide-react"
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
  /** Optional native-script name; rendered as a muted subtitle below `name`. */
  nativeName?: string | null
}

export type LanguageComboboxProps = {
  options: LanguageComboboxOption[]
  value: string
  onChange: (slug: string) => void
  icon?: LucideIcon
}

export function LanguageCombobox({
  options,
  value,
  onChange,
  icon: Icon = Languages,
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

  // Memoised: options is up to ~2000 items and re-renders fire on every
  // setActiveIndex (hover, keyboard nav). The find call shouldn't run on
  // each frame when nothing relevant changed.
  const selected = useMemo(
    () => options.find((o) => o.slug === value) ?? null,
    [options, value],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => {
      if (o.name.toLowerCase().includes(q)) return true
      if (o.nativeName?.toLowerCase().includes(q)) return true
      return false
    })
  }, [options, query])

  // Keep ref in sync with state
  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  // Also keep a ref for filtered so keydown can read it without stale closure.
  // Sync via useEffect — React Compiler rejects render-phase ref writes; the
  // effect runs before the next keypress can fire, so the ref stays current
  // for any keydown handler invocation.
  const filteredRef = useRef(filtered)
  useEffect(() => {
    filteredRef.current = filtered
  }, [filtered])

  // Reset query/active-index on the closed→open transition. Use the
  // render-phase snapshot pattern so the reset queues with the same
  // commit that opens the popover — avoids React Compiler's cascading-
  // setState-in-effect warning while preserving the same UX (search
  // input shows up cleared and at index 0 on every open).
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setActiveIndex(0)
      setQuery("")
    }
  }
  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  // Install the click-outside listener once at mount, gate its body on a
  // ref read so it remains a no-op while the popover is closed. Re-binding
  // on every open/close transition leaves a one-tick gap (between React
  // commit and effect flush) where outside clicks go unhandled.
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])
  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (!openRef.current) return
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
  }, [])

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
          <Icon aria-hidden className="h-5 w-5 text-stone-400" />
          <span>{selected?.name}</span>
        </span>
        <ChevronsUpDown aria-hidden className="h-4 w-4 text-stone-400" />
      </button>

      {open ? (
        <div
          ref={popoverRef}
          data-testid="language-combobox-popover"
          // `overflow-hidden` is load-bearing — the listbox <ul> below has
          // its own `overflow-y-auto` for scrolling, but without clipping
          // at the popover edge the last option's hover/active background
          // (the filled `<button>`) paints past the `rounded-2xl` corner.
          // `shadow-xl` is unaffected because box-shadow renders outside
          // the element's bounding box, not against its overflow rule.
          className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-2xl border border-stone-700 bg-stone-900 shadow-xl"
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
          {/*
            Same stone-themed scrollbar class string is also used on
            DownloadModal.tsx's terms-of-use body. Keep both in sync —
            or promote to a shared `stone-scrollbar` utility in
            globals.css, following the `search-overlay-scroll` precedent.
          */}
          <ul
            role="listbox"
            aria-label="Languages"
            className="max-h-72 overflow-y-auto py-1 [scrollbar-color:theme(colors.stone.700)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-700 hover:[&::-webkit-scrollbar-thumb]:bg-stone-600 [&::-webkit-scrollbar-track]:bg-transparent"
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
                      className={`block w-full px-4 py-2 text-left transition ${
                        active
                          ? "bg-stone-700 text-stone-50"
                          : "text-stone-200 hover:bg-stone-800"
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        {option.name}
                      </span>
                      {option.nativeName ? (
                        <span
                          data-testid="language-combobox-option-native"
                          className="block text-xs text-stone-400"
                        >
                          {option.nativeName}
                        </span>
                      ) : null}
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
