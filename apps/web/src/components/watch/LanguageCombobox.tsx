"use client"

import { Captions, ChevronDown, Languages } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react"
import { createPortal } from "react-dom"

import { languageCodeFor, primaryLanguageCode } from "@/lib/language-code"

export type LanguageComboboxOption = {
  slug: string
  name: string
  /** Optional native-script name; rendered as a muted subtitle below `name`. */
  nativeName?: string | null
  /** BCP 47 tag used to show the primary language code when available. */
  bcp47?: string | null
  /** Render as visible context in the list without allowing selection. */
  disabled?: boolean
  /** Small status label rendered at the end of the option row. */
  chipLabel?: string | null
}

export type LanguageComboboxProps = {
  options: LanguageComboboxOption[]
  value: string
  onChange: (slug: string) => void
  icon?: "language" | "subtitles"
  disabled?: boolean
  placeholder?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  compact?: boolean
  triggerClassName?: string
  triggerWrapper?: (trigger: ReactNode) => ReactNode
  popoverPortalContainer?: HTMLElement | null
}

const LISTBOX_MAX_HEIGHT_PX = 288
const OPTION_ROW_HEIGHT_PX = 72
const POPOVER_GAP_PX = 8
const POPOVER_VIEWPORT_PADDING_PX = 24
const POPOVER_SEARCH_FALLBACK_HEIGHT_PX = 65
const VIRTUALIZATION_THRESHOLD = 80
const VIRTUALIZATION_OVERSCAN = 4

function capitalizeNativeName(name: string, language: string): string {
  const first = Array.from(name)[0]
  if (!first) return name
  return `${first.toLocaleUpperCase(language)}${name.slice(first.length)}`
}

function nativeNameForOption(option: LanguageComboboxOption): string | null {
  const normalizedName = option.name.trim().toLocaleLowerCase()
  const explicitNativeName = option.nativeName?.trim()
  if (explicitNativeName) {
    return explicitNativeName.toLocaleLowerCase() === normalizedName
      ? null
      : explicitNativeName
  }
  const language = primaryLanguageCode(option.bcp47)?.toLowerCase()
  if (!language) return null
  try {
    const displayName = new Intl.DisplayNames([language], {
      type: "language",
    }).of(language)
    if (!displayName || displayName.toLowerCase() === language) return null
    if (displayName.toLowerCase() === option.name.toLowerCase()) return null
    return capitalizeNativeName(displayName, language)
  } catch {
    return null
  }
}

const SEARCH_WORD_SEPARATOR = /[\s,.;:!?()[\]{}"'/\\|_-]+/u

function searchMatchTierForText(
  value: string | null | undefined,
  query: string,
): number | null {
  const text = value?.trim().toLowerCase()
  if (!text || !text.includes(query)) return null
  if (text.startsWith(query)) return 0
  if (
    text
      .split(SEARCH_WORD_SEPARATOR)
      .filter(Boolean)
      .some((word) => word.startsWith(query))
  ) {
    return 1
  }
  return 2
}

function searchMatchTierForOption(
  option: LanguageComboboxOption,
  query: string,
): number | null {
  const tiers = [
    searchMatchTierForText(option.name, query),
    searchMatchTierForText(nativeNameForOption(option), query),
  ].filter((tier): tier is number => tier != null)

  return tiers.length > 0 ? Math.min(...tiers) : null
}

function initialsForOption(option: LanguageComboboxOption): string {
  const words = option.name.split(/\s+/).filter(Boolean).slice(0, 2)
  const initials = words.map((word) => word[0]).join("")
  return (initials || option.slug.slice(0, 2)).toUpperCase()
}

function LanguageCodeMarker({
  option,
  size = "option",
}: {
  option: LanguageComboboxOption
  size?: "trigger" | "triggerCompact" | "option"
}) {
  const languageCode = languageCodeFor(option) ?? initialsForOption(option)
  const compact = size === "trigger"
  const extraCompact = size === "triggerCompact"
  return (
    <span
      aria-hidden
      data-testid="language-combobox-option-code"
      className={`grid shrink-0 place-items-center rounded-full border border-stone-200/45 bg-stone-950/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${
        extraCompact ? "size-7" : compact ? "size-8" : "size-10"
      }`}
    >
      <span
        className={`font-bold tracking-[0.12em] text-stone-100 ${
          extraCompact ? "text-[8px]" : compact ? "text-[9px]" : "text-[10px]"
        }`}
      >
        {languageCode}
      </span>
    </span>
  )
}

export function LanguageCombobox({
  options,
  value,
  onChange,
  icon = "language",
  disabled = false,
  placeholder,
  open: controlledOpen,
  onOpenChange,
  compact = false,
  triggerClassName: triggerClassNameOverride,
  triggerWrapper,
  popoverPortalContainer,
}: LanguageComboboxProps) {
  const t = useTranslations("LanguageCombobox")
  // Fall back to the localized default only when the caller did not pass an
  // explicit placeholder (e.g. LanguagePickerModal passes "No subtitles").
  const resolvedPlaceholder = placeholder ?? t("selectLanguage")
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [listboxMaxHeight, setListboxMaxHeight] = useState(
    LISTBOX_MAX_HEIGHT_PX,
  )
  const [popoverPlacement, setPopoverPlacement] = useState<"above" | "below">(
    "below",
  )
  const [popoverRect, setPopoverRect] = useState<{
    left: number
    top: number
    width: number
  } | null>(null)
  const open = controlledOpen ?? uncontrolledOpen
  // Mirror activeIndex in a ref so keydown handlers always read the latest value
  // even when multiple key events fire within the same React batch.
  const activeIndexRef = useRef(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const searchFrameRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listboxRef = useRef<HTMLUListElement | null>(null)

  // Memoised: options is up to ~2000 items and re-renders fire on every
  // setActiveIndex (hover, keyboard nav). The find call shouldn't run on
  // each frame when nothing relevant changed.
  const selected = useMemo(
    () => options.find((o) => o.slug === value) ?? null,
    [options, value],
  )
  const Icon = icon === "subtitles" ? Captions : Languages

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options
      .map((option, index) => ({
        option,
        index,
        tier: searchMatchTierForOption(option, q),
      }))
      .filter(
        (
          entry,
        ): entry is {
          option: LanguageComboboxOption
          index: number
          tier: number
        } => entry.tier != null,
      )
      .sort((a, b) => a.tier - b.tier || a.index - b.index)
      .map((entry) => entry.option)
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

  const setComboboxOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen == null) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange],
  )

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  useLayoutEffect(() => {
    if (!open) return

    function updatePopoverLayout() {
      const trigger = triggerRef.current
      if (!trigger) return

      const triggerRect = trigger.getBoundingClientRect()
      // iOS keeps the layout viewport tall while the software keyboard
      // shrinks and may shift the visual viewport. Measure the portion the
      // viewer can actually see so the search field and results never land
      // behind the keyboard or browser chrome.
      const visualViewport = window.visualViewport
      const viewportTop = visualViewport?.offsetTop ?? 0
      const viewportBottom =
        viewportTop + (visualViewport?.height ?? window.innerHeight)
      const measuredSearchHeight =
        searchFrameRef.current?.getBoundingClientRect().height ?? 0
      const searchHeight =
        measuredSearchHeight > 0
          ? measuredSearchHeight
          : POPOVER_SEARCH_FALLBACK_HEIGHT_PX
      const desiredPopoverHeight = searchHeight + LISTBOX_MAX_HEIGHT_PX
      const spaceBelow =
        viewportBottom -
        triggerRect.bottom -
        POPOVER_GAP_PX -
        POPOVER_VIEWPORT_PADDING_PX
      const spaceAbove =
        triggerRect.top -
        viewportTop -
        POPOVER_GAP_PX -
        POPOVER_VIEWPORT_PADDING_PX
      const nextPlacement =
        spaceBelow < desiredPopoverHeight && spaceAbove > spaceBelow
          ? "above"
          : "below"
      const availableSpace = nextPlacement === "above" ? spaceAbove : spaceBelow
      const nextMaxHeight = Math.max(
        1,
        Math.min(
          LISTBOX_MAX_HEIGHT_PX,
          Math.floor(availableSpace - searchHeight),
        ),
      )
      const estimatedPopoverHeight = searchHeight + nextMaxHeight

      setPopoverPlacement(nextPlacement)
      setListboxMaxHeight(nextMaxHeight)
      setPopoverRect({
        left: triggerRect.left,
        top:
          nextPlacement === "above"
            ? Math.max(
                viewportTop + POPOVER_VIEWPORT_PADDING_PX,
                triggerRect.top - POPOVER_GAP_PX - estimatedPopoverHeight,
              )
            : triggerRect.bottom + POPOVER_GAP_PX,
        width: triggerRect.width,
      })
    }

    updatePopoverLayout()
    const visualViewport = window.visualViewport
    window.addEventListener("resize", updatePopoverLayout, { passive: true })
    visualViewport?.addEventListener("resize", updatePopoverLayout, {
      passive: true,
    })
    visualViewport?.addEventListener("scroll", updatePopoverLayout, {
      passive: true,
    })
    document.addEventListener("scroll", updatePopoverLayout, {
      capture: true,
      passive: true,
    })
    return () => {
      window.removeEventListener("resize", updatePopoverLayout)
      visualViewport?.removeEventListener("resize", updatePopoverLayout)
      visualViewport?.removeEventListener("scroll", updatePopoverLayout)
      document.removeEventListener("scroll", updatePopoverLayout, {
        capture: true,
      })
    }
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
      setComboboxOpen(false)
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [setComboboxOpen])

  // Reset query and active index together so the list is always in sync with
  // the search input — avoids the off-by-one that a post-render clamp useEffect produces.
  const resetQuery = useCallback((next: string) => {
    setQuery(next)
    setActiveIndex(0)
    activeIndexRef.current = 0
    setScrollTop(0)
    if (listboxRef.current) listboxRef.current.scrollTop = 0
  }, [])

  const openCombobox = useCallback(() => {
    setQuery("")
    setActiveIndex(0)
    activeIndexRef.current = 0
    setScrollTop(0)
    if (listboxRef.current) listboxRef.current.scrollTop = 0
    setComboboxOpen(true)
  }, [setComboboxOpen])

  const handleSelect = useCallback(
    (slug: string) => {
      const option = options.find((candidate) => candidate.slug === slug)
      if (option?.disabled) return
      onChange(slug)
      setComboboxOpen(false)
      triggerRef.current?.focus()
    },
    [onChange, options, setComboboxOpen],
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
        setComboboxOpen(false)
        triggerRef.current?.focus()
      }
    },
    [handleSelect, setComboboxOpen],
  )

  const shouldVirtualize = filtered.length > VIRTUALIZATION_THRESHOLD
  const visibleRange = useMemo(() => {
    if (!shouldVirtualize) {
      return { end: filtered.length, start: 0 }
    }

    const visibleCount = Math.ceil(listboxMaxHeight / OPTION_ROW_HEIGHT_PX)
    const windowSize = visibleCount + VIRTUALIZATION_OVERSCAN * 2
    const scrollStart = Math.max(
      0,
      Math.floor(scrollTop / OPTION_ROW_HEIGHT_PX) - VIRTUALIZATION_OVERSCAN,
    )
    const start = Math.min(
      scrollStart,
      Math.max(0, filtered.length - windowSize),
    )
    const end = Math.min(filtered.length, start + windowSize)
    return { end, start }
  }, [filtered.length, listboxMaxHeight, scrollTop, shouldVirtualize])
  const visibleOptions = useMemo(
    () =>
      shouldVirtualize
        ? filtered.slice(visibleRange.start, visibleRange.end)
        : filtered,
    [filtered, shouldVirtualize, visibleRange.end, visibleRange.start],
  )

  useEffect(() => {
    if (!open || !shouldVirtualize) return
    const listbox = listboxRef.current
    if (!listbox) return

    const rowTop = activeIndex * OPTION_ROW_HEIGHT_PX
    const rowBottom = rowTop + OPTION_ROW_HEIGHT_PX
    const viewportTop = listbox.scrollTop
    const viewportBottom = viewportTop + listbox.clientHeight
    let nextScrollTop: number | null = null

    if (rowTop < viewportTop) {
      nextScrollTop = rowTop
    } else if (rowBottom > viewportBottom) {
      nextScrollTop = rowBottom - listbox.clientHeight
    }

    if (nextScrollTop != null) {
      listbox.scrollTop = nextScrollTop
    }
  }, [activeIndex, open, shouldVirtualize])

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLUListElement>) => {
      if (!shouldVirtualize) return
      setScrollTop(event.currentTarget.scrollTop)
    },
    [shouldVirtualize],
  )

  const selectedNativeName = selected ? nativeNameForOption(selected) : null
  const triggerClassName = compact
    ? "flex h-14 min-h-12 w-full cursor-pointer items-center justify-between gap-2.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-left text-sm font-semibold text-stone-100 transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    : "flex h-16 min-h-16 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-left text-base font-semibold text-stone-100 transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
  const triggerButton = (
    <button
      ref={triggerRef}
      type="button"
      data-testid="language-combobox-trigger"
      onClick={() => {
        if (disabled) return
        if (open) setComboboxOpen(false)
        else openCombobox()
      }}
      aria-expanded={open}
      aria-haspopup="listbox"
      disabled={disabled}
      className={`${triggerClassName} ${triggerClassNameOverride ?? ""}`}
    >
      <span
        className={`flex min-w-0 items-center ${compact ? "gap-2.5" : "gap-3"}`}
      >
        {selected ? (
          <LanguageCodeMarker
            option={selected}
            size={compact ? "triggerCompact" : "trigger"}
          />
        ) : (
          <Icon
            aria-hidden
            className={`shrink-0 text-stone-400 ${
              compact ? "h-4 w-4" : "h-5 w-5"
            }`}
          />
        )}
        <span className="grid min-w-0 content-center">
          <span className="block truncate leading-tight">
            {selected?.name ?? resolvedPlaceholder}
          </span>
          {selectedNativeName ? (
            <span
              data-testid="language-combobox-trigger-native"
              className={`mt-0.5 block truncate leading-tight text-stone-400 ${
                compact ? "text-[11px]" : "text-xs"
              }`}
            >
              {selectedNativeName}
            </span>
          ) : null}
        </span>
      </span>
      <ChevronDown
        aria-hidden
        className={`shrink-0 text-stone-500 transition-transform duration-200 ${
          open ? "rotate-180" : "rotate-0"
        } ${compact ? "h-4 w-4" : "h-5 w-5"}`}
      />
    </button>
  )
  const popoverContainer =
    popoverPortalContainer ??
    (typeof document !== "undefined" ? document.body : null)

  return (
    <div className="relative">
      {triggerWrapper ? triggerWrapper(triggerButton) : triggerButton}

      {open && popoverContainer
        ? createPortal(
            <div
              ref={popoverRef}
              data-testid="language-combobox-popover"
              data-placement={popoverPlacement}
              // `overflow-hidden` is load-bearing — the listbox <ul> below has
              // its own `overflow-y-auto` for scrolling, but without clipping
              // at the popover edge the last option's hover/active background
              // (the filled `<button>`) paints past the `rounded-2xl` corner.
              // `shadow-xl` is unaffected because box-shadow renders outside
              // the element's bounding box, not against its overflow rule.
              className="fixed z-[1000] overflow-hidden rounded-2xl border border-white/10 bg-stone-950/95 shadow-2xl backdrop-blur-md"
              style={{
                left: popoverRect?.left ?? 0,
                top: popoverRect?.top ?? 0,
                width: popoverRect?.width ?? 0,
              }}
            >
              <div
                ref={searchFrameRef}
                className="border-b border-white/10 px-5 py-4"
              >
                <input
                  ref={searchRef}
                  data-testid="language-combobox-search"
                  type="text"
                  value={query}
                  onChange={(e) => resetQuery(e.target.value)}
                  // jsdom-only: dispatchEvent(new Event("input")) does not trigger React's synthetic onChange.
                  // In production both fire on every keystroke; React batches identical setQuery values, so no double-render.
                  onInput={(e) =>
                    resetQuery((e.target as HTMLInputElement).value)
                  }
                  onKeyDown={handleSearchKeyDown}
                  placeholder={t("searchPlaceholder")}
                  aria-activedescendant={
                    filtered[activeIndex]
                      ? `lcb-opt-${filtered[activeIndex].slug}`
                      : undefined
                  }
                  className="w-full bg-transparent text-lg font-normal text-stone-100 placeholder:text-stone-500 focus:outline-none"
                />
              </div>
              {/* Large lists are windowed so the 2k+ language picker opens immediately. */}
              {/*
            Same stone-themed scrollbar class string is also used on
            DownloadModal.tsx's terms-of-use body. Keep both in sync —
            or promote to a shared `stone-scrollbar` utility in
            globals.css, following the `search-overlay-scroll` precedent.
          */}
              <ul
                ref={listboxRef}
                role="listbox"
                aria-label={t("languages")}
                data-virtualized={shouldVirtualize ? "true" : "false"}
                onScroll={handleListScroll}
                style={{ maxHeight: listboxMaxHeight }}
                className="overflow-y-auto py-1 [scrollbar-color:theme(colors.stone.700)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-700 hover:[&::-webkit-scrollbar-thumb]:bg-stone-600 [&::-webkit-scrollbar-track]:bg-transparent"
              >
                {filtered.length === 0 ? (
                  <li
                    data-testid="language-combobox-empty"
                    className="px-4 py-3 text-sm text-stone-500"
                  >
                    {t("noMatches")}
                  </li>
                ) : (
                  <>
                    {shouldVirtualize && visibleRange.start > 0 ? (
                      <li
                        aria-hidden="true"
                        style={{
                          height: visibleRange.start * OPTION_ROW_HEIGHT_PX,
                        }}
                      />
                    ) : null}
                    {visibleOptions.map((option, visibleIndex) => {
                      const index = shouldVirtualize
                        ? visibleRange.start + visibleIndex
                        : visibleIndex
                      const active = index === activeIndex
                      const optionDisabled = option.disabled === true
                      const selectedOption =
                        !optionDisabled && option.slug === value
                      const nativeName = nativeNameForOption(option)
                      return (
                        <li key={option.slug}>
                          <button
                            type="button"
                            id={`lcb-opt-${option.slug}`}
                            role="option"
                            aria-selected={selectedOption}
                            aria-disabled={optionDisabled ? "true" : undefined}
                            disabled={optionDisabled}
                            aria-posinset={
                              shouldVirtualize ? index + 1 : undefined
                            }
                            aria-setsize={
                              shouldVirtualize ? filtered.length : undefined
                            }
                            data-testid="language-combobox-option"
                            data-language-slug={option.slug}
                            data-active={active ? "true" : "false"}
                            data-disabled={optionDisabled ? "true" : "false"}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => handleSelect(option.slug)}
                            className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-100 ${
                              optionDisabled
                                ? active
                                  ? "bg-white/[0.06] text-stone-500"
                                  : "text-stone-500"
                                : selectedOption
                                  ? "cursor-pointer bg-white/[0.08] text-white hover:bg-white/[0.12]"
                                  : active
                                    ? "cursor-pointer bg-white/10 text-stone-100"
                                    : "cursor-pointer text-stone-100 hover:bg-white/10"
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-4">
                              <LanguageCodeMarker option={option} />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">
                                  {option.name}
                                </span>
                                {nativeName ? (
                                  <span
                                    data-testid="language-combobox-option-native"
                                    className="block truncate text-xs text-stone-400"
                                  >
                                    {nativeName}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            {option.chipLabel ? (
                              <span
                                data-testid="language-combobox-option-chip"
                                className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold ${
                                  optionDisabled
                                    ? "border-stone-500/40 text-stone-400"
                                    : "border-stone-400/50 text-stone-300"
                                }`}
                              >
                                {option.chipLabel}
                              </span>
                            ) : null}
                            {optionDisabled && !option.chipLabel ? (
                              <span className="sr-only">
                                {" "}
                                {option.chipLabel ?? "Not available"}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      )
                    })}
                    {shouldVirtualize && visibleRange.end < filtered.length ? (
                      <li
                        aria-hidden="true"
                        style={{
                          height:
                            (filtered.length - visibleRange.end) *
                            OPTION_ROW_HEIGHT_PX,
                        }}
                      />
                    ) : null}
                  </>
                )}
              </ul>
            </div>,
            popoverContainer,
          )
        : null}
    </div>
  )
}
