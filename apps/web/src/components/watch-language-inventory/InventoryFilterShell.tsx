"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, ChevronDown, SlidersHorizontal, X } from "lucide-react"
import { useTranslations } from "next-intl"

import { buttonVariants } from "@/components/ui/button-variants"
import {
  WATCH_PILL_BUTTON_CLASS,
  WATCH_SECTION_EYEBROW_CLASS,
} from "@/components/watch/watch-section-styles"
import { cn } from "@/lib/utils"
import {
  INVENTORY_ADDED_WINDOW_DAYS,
  type InventoryAddedWindow,
  type InventoryLengthBucket,
  type InventoryTypeGroup,
} from "@/lib/watch-language-inventory"

// Filtering is applied to the SERVER-rendered markup by toggling `hidden`,
// rather than by re-rendering the cards on the client. The English page carries
// ~1,170 items and ~9.5 MB of HTML; re-rendering that subtree in the browser to
// hide rows would cost far more than reading a few data attributes. So this
// component renders the controls and passes `children` straight through — those
// nodes are never reconciled against client state.
//
// Every facet is emitted server-side as `data-inv-*` by
// `inventoryFacetAttributes`, so no filter needs extra data.

type LengthValue = InventoryLengthBucket
type TypeValue = InventoryTypeGroup

type FilterState = {
  length: LengthValue | null
  type: TypeValue | null
  added: InventoryAddedWindow | null
}

const LENGTH_ORDER: readonly LengthValue[] = [
  "under5",
  "5to10",
  "10to30",
  "over30",
]
// Longest-form first, so the list reads as a descent from a full film to a
// clip inside a collection.
//
// `collection` is deliberately NOT offered: a series/collection renders as the
// sidebar PANEL of a group, never as a `[data-inv-item]`, so the option matched
// 0 of 990 items on the English page. `inventoryTypeGroup` still classifies it,
// so the facet attribute stays truthful if such a card ever reaches the grid.
const TYPE_ORDER: readonly TypeValue[] = ["featureFilm", "shortFilm", "episode"]

// Cumulative and ordered newest-first. There is deliberately no "last 2 years"
// window: 89% of the English library shares one platform-publish month, so that
// option matched 1,001 of 1,001 items and filtered nothing.
const ADDED_ORDER: readonly InventoryAddedWindow[] = ["60d", "6m", "12m"]

const EMPTY_STATE: FilterState = { length: null, type: null, added: null }

function matches(element: HTMLElement, state: FilterState): boolean {
  if (state.length && element.dataset.invLength !== state.length) return false
  if (state.type && element.dataset.invType !== state.type) return false
  if (state.added) {
    const ageDays = Number(element.dataset.invAgeDays)
    // `unknown` parses to NaN, so an undated item matches no window rather than
    // slipping into the newest one.
    if (!Number.isFinite(ageDays)) return false
    if (ageDays > INVENTORY_ADDED_WINDOW_DAYS[state.added]) return false
  }
  return true
}

export function InventoryFilterShell({
  children,
}: {
  children: React.ReactNode
}) {
  const t = useTranslations("LanguageInventory")
  const videoLabels = useTranslations("VideoLabels")
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<FilterState>(EMPTY_STATE)
  const [counts, setCounts] = useState<{
    visible: number
    total: number
  } | null>(null)
  // Collapsed by default: the catalog is the point of the page, and four filter
  // rows above it would push the first collection below the fold.
  const [open, setOpen] = useState(false)
  const active =
    state.length != null || state.type != null || state.added != null

  const apply = useCallback((next: FilterState) => {
    const root = rootRef.current
    if (!root) return

    // `hidden` (the property) is what does the hiding. It beats the episode
    // rows' own `flex` class only because Tailwind preflight ships
    // `[hidden]:where(:not([hidden="until-found"])) { display: none !important }`
    // — verified in the compiled stylesheet on 2026-08-27. If preflight ever
    // drops that `!important`, rows would stay painted while these counts still
    // read correctly, so the browser check is the one that matters here.
    const items = root.querySelectorAll<HTMLElement>("[data-inv-item]")
    let visible = 0
    for (const element of items) {
      const show = matches(element, next)
      element.hidden = !show
      if (show) visible += 1
    }
    // A container whose every item is hidden collapses, so filtering never
    // leaves an empty collection panel or a bare section heading behind.
    for (const selector of ["[data-inv-group]", "[data-inv-section]"]) {
      for (const container of root.querySelectorAll<HTMLElement>(selector)) {
        const items = container.querySelectorAll<HTMLElement>("[data-inv-item]")
        container.hidden =
          items.length > 0 &&
          Array.from(items).every((element) => element.hidden)
      }
    }
    // Both counts come from the same pass over the real DOM, so the readout can
    // never disagree with what is on screen.
    setCounts({ visible, total: items.length })
  }, [])

  useEffect(() => {
    apply(state)
    // `children` is in the deps on purpose: the filtered nodes are SERVER
    // markup passed through, and this effect is the only thing that ever sets
    // their `hidden`. If Next reuses this shell instance across a navigation
    // between two language pages, a state-only dependency list would leave the
    // new page unfiltered while the chips still read as active.
  }, [apply, state, children])

  const optionClass = (selected: boolean) =>
    cn(
      "cursor-pointer rounded-full border px-3 py-1.5 text-sm sm:text-xs leading-5 font-medium tracking-media-label uppercase transition-colors focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none",
      selected
        ? "border-white bg-white text-black"
        : "border-white/20 bg-white/[0.06] text-stone-200 hover:border-white/40 hover:bg-white/10",
    )

  return (
    <div ref={rootRef} data-testid="language-inventory-filters-root">
      <section
        aria-labelledby="language-inventory-filters-heading"
        data-testid="language-inventory-filters"
        // No `border-t`: the hero above already ends in its own bottom border,
        // so a rule here read as a second, redundant divider.
        className="py-8"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="language-inventory-filters-heading" className="contents">
              <button
                type="button"
                data-testid="language-inventory-filters-toggle"
                aria-expanded={open}
                aria-controls="language-inventory-filters-options"
                onClick={() => setOpen((current) => !current)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-full focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none",
                  WATCH_SECTION_EYEBROW_CLASS,
                )}
              >
                <SlidersHorizontal aria-hidden className="size-4 shrink-0" />
                {t("filters")}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 transition-transform duration-200",
                    open ? "rotate-180" : "rotate-0",
                  )}
                />
              </button>
            </h2>
            {active && counts != null ? (
              <p
                data-testid="language-inventory-filters-count"
                className="text-base sm:text-sm font-medium text-stone-400 tabular-nums"
              >
                {t("filterResults", {
                  count: counts.visible,
                  total: counts.total,
                })}
              </p>
            ) : null}
            {active ? (
              <button
                type="button"
                data-testid="language-inventory-filters-clear"
                onClick={() => setState(EMPTY_STATE)}
                className={cn(
                  buttonVariants({
                    variant: "pill",
                    className: WATCH_PILL_BUTTON_CLASS,
                  }),
                  "ml-auto",
                )}
              >
                <X aria-hidden size={16} />
                <span>{t("clearFilters")}</span>
              </button>
            ) : null}
          </div>

          <div
            id="language-inventory-filters-options"
            hidden={!open}
            className="mt-5 flex flex-col gap-4"
          >
            <FilterGroup label={t("filterLength")}>
              {LENGTH_ORDER.map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`language-inventory-filter-length-${value}`}
                  aria-pressed={state.length === value}
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      length: current.length === value ? null : value,
                    }))
                  }
                  className={optionClass(state.length === value)}
                >
                  {state.length === value ? (
                    <Check aria-hidden className="mr-1 inline size-3" />
                  ) : null}
                  {t(`filterLength_${value}`)}
                </button>
              ))}
            </FilterGroup>

            <FilterGroup label={t("filterType")}>
              {TYPE_ORDER.map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`language-inventory-filter-type-${value}`}
                  aria-pressed={state.type === value}
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      type: current.type === value ? null : value,
                    }))
                  }
                  className={optionClass(state.type === value)}
                >
                  {state.type === value ? (
                    <Check aria-hidden className="mr-1 inline size-3" />
                  ) : null}
                  {videoLabels(value)}
                </button>
              ))}
            </FilterGroup>

            <FilterGroup label={t("filterAdded")}>
              {ADDED_ORDER.map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`language-inventory-filter-added-${value}`}
                  aria-pressed={state.added === value}
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      added: current.added === value ? null : value,
                    }))
                  }
                  className={optionClass(state.added === value)}
                >
                  {state.added === value ? (
                    <Check aria-hidden className="mr-1 inline size-3" />
                  ) : null}
                  {t(`filterAdded_${value}`)}
                </button>
              ))}
            </FilterGroup>
          </div>

          {active && counts?.visible === 0 ? (
            <p
              data-testid="language-inventory-filters-empty"
              className="mt-6 rounded-lg border border-white/10 bg-white/[0.04] px-5 py-8 text-stone-300"
            >
              {t("noFilterResults")}
            </p>
          ) : null}
        </div>
      </section>

      {children}
    </div>
  )
}

function FilterGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-full text-sm sm:text-xs leading-5 font-medium tracking-media-label text-stone-300/80 uppercase sm:w-28">
        {label}
      </span>
      {children}
    </div>
  )
}
