"use client"

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import type { Route } from "next"
import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Bell,
  Bot,
  Captions,
  ChevronDown,
  Clapperboard,
  ClipboardCheck,
  CornerDownLeft,
  Crop,
  FileAudio2,
  FileChartColumn,
  FileJson2,
  Headset,
  History,
  LayoutDashboard,
  LayoutGrid,
  Library,
  Megaphone,
  MessageCircleQuestion,
  PanelsTopLeft,
  Search,
  SearchCheck,
  UserSearch,
  Workflow,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type StudioProductGroupKey =
  | "media"
  | "marketing"
  | "support"
  | "operations"
  | "analytics-data"
  | "website"

/** Media entries backed by the Manager shell report context. */
export type StudioReportProductKey = "subtitles" | "audio" | "meta"

/** Entries that navigate to an existing Manager dashboard route. */
export type StudioRouteProductKey =
  | "smart-crop"
  | "shorts"
  | "seo"
  | "alerts"
  | "agents"

export type StudioSelectableProductKey =
  | StudioReportProductKey
  | StudioRouteProductKey

export type StudioUnavailableProductKey =
  | "campaigns"
  | "hs-support-agent"
  | "hs-user-discovery"
  | "agent-registry"
  | "agent-runs"
  | "automations"
  | "evaluations"
  | "monitoring"
  | "custom-dashboards"
  | "reports"
  | "questions"
  | "website-editor"

export type StudioProductKey =
  | StudioSelectableProductKey
  | StudioUnavailableProductKey

type StudioProductBase = {
  icon: LucideIcon
  label: string
}

/** Switches the shell report context in place (no navigation). */
export type StudioReportProduct = StudioProductBase & {
  available: true
  key: StudioReportProductKey
  kind: "report"
}

/** Navigates to an existing Manager route with the client router. */
export type StudioRouteProduct = StudioProductBase & {
  available: true
  href: Route
  key: StudioRouteProductKey
  kind: "route"
}

/** Listed as "Coming Soon"; never active or selectable. */
export type StudioUnavailableProduct = StudioProductBase & {
  available: false
  key: StudioUnavailableProductKey
  kind: "unavailable"
}

export type StudioSelectableProduct = StudioReportProduct | StudioRouteProduct

/** Only entries with a real Manager destination are selectable. */
export type StudioProduct = StudioSelectableProduct | StudioUnavailableProduct

export type StudioProductGroup = {
  key: StudioProductGroupKey
  label: string
  products: readonly StudioProduct[]
}

// Report entries (Subtitles, Audio, Meta) switch the Manager shell report
// context. Route entries (Smart Crop, Shorts, SEO, Alerts, Agents) navigate to
// their dashboard roots. Each selectable entry owns the sidebar submenu below
// the switcher (see studio-product-submenu.ts). The other entries have no
// Manager routes yet, so they are listed but disabled, labelled "Coming Soon"
// and skipped by keyboard and pointer focus; they never own a submenu.
const STUDIO_PRODUCT_GROUPS: readonly StudioProductGroup[] = [
  {
    key: "media",
    label: "Media",
    products: [
      {
        key: "subtitles",
        label: "Subtitles",
        icon: Captions,
        available: true,
        kind: "report",
      },
      {
        key: "audio",
        label: "Audio",
        icon: FileAudio2,
        available: true,
        kind: "report",
      },
      {
        key: "meta",
        label: "Meta",
        icon: FileJson2,
        available: true,
        kind: "report",
      },
      {
        key: "smart-crop",
        label: "Smart Crop",
        icon: Crop,
        available: true,
        kind: "route",
        href: "/dashboard/smart-crop",
      },
      {
        key: "shorts",
        label: "Shorts",
        icon: Clapperboard,
        available: true,
        kind: "route",
        href: "/dashboard/shorts",
      },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    products: [
      {
        key: "seo",
        label: "SEO",
        icon: SearchCheck,
        available: true,
        kind: "route",
        href: "/dashboard/seo",
      },
      {
        key: "campaigns",
        label: "Campaigns",
        icon: Megaphone,
        available: false,
        kind: "unavailable",
      },
    ],
  },
  {
    key: "support",
    label: "Support",
    products: [
      {
        key: "hs-support-agent",
        label: "HS Support Agent",
        icon: Headset,
        available: false,
        kind: "unavailable",
      },
      {
        key: "hs-user-discovery",
        label: "HS User Discovery",
        icon: UserSearch,
        available: false,
        kind: "unavailable",
      },
    ],
  },
  {
    // Agent-operations lifecycle: the existing Alerts and Agents routes, then
    // planned registry, runs, automations, evaluations and monitoring.
    // Named agents (HS Support Agent, HS User Discovery) stay under Support.
    key: "operations",
    label: "Operations",
    products: [
      {
        key: "alerts",
        label: "Alerts",
        icon: Bell,
        available: true,
        kind: "route",
        href: "/dashboard/alerts",
      },
      {
        key: "agents",
        label: "Agents",
        icon: Bot,
        available: true,
        kind: "route",
        href: "/dashboard/agents",
      },
      {
        key: "agent-registry",
        label: "Agent Registry",
        icon: Library,
        available: false,
        kind: "unavailable",
      },
      {
        key: "agent-runs",
        label: "Agent Runs",
        icon: History,
        available: false,
        kind: "unavailable",
      },
      {
        key: "automations",
        label: "Automations",
        icon: Workflow,
        available: false,
        kind: "unavailable",
      },
      {
        key: "evaluations",
        label: "Evaluations",
        icon: ClipboardCheck,
        available: false,
        kind: "unavailable",
      },
      {
        key: "monitoring",
        label: "Monitoring",
        icon: Activity,
        available: false,
        kind: "unavailable",
      },
    ],
  },
  {
    key: "analytics-data",
    label: "Analytics/Data",
    products: [
      {
        key: "custom-dashboards",
        label: "Custom Dashboards",
        icon: LayoutDashboard,
        available: false,
        kind: "unavailable",
      },
      {
        key: "reports",
        label: "Reports",
        icon: FileChartColumn,
        available: false,
        kind: "unavailable",
      },
      {
        key: "questions",
        label: "Questions",
        icon: MessageCircleQuestion,
        available: false,
        kind: "unavailable",
      },
    ],
  },
  {
    key: "website",
    label: "Website",
    products: [
      {
        key: "website-editor",
        label: "Website Editor",
        icon: PanelsTopLeft,
        available: false,
        kind: "unavailable",
      },
    ],
  },
]

export function getStudioProductGroups(): readonly StudioProductGroup[] {
  return STUDIO_PRODUCT_GROUPS
}

/**
 * The route entry whose destination contains `pathname` (the route itself or
 * one of its sub-pages), or null when the page belongs to no route entry.
 */
export function getStudioRouteProductForPathname(
  pathname: string,
): StudioRouteProduct | null {
  for (const product of flattenStudioProductGroups(STUDIO_PRODUCT_GROUPS)) {
    if (
      product.kind === "route" &&
      (pathname === product.href || pathname.startsWith(`${product.href}/`))
    ) {
      return product
    }
  }

  return null
}

/** Entries in rendered (flattened group) order. */
export function flattenStudioProductGroups(
  groups: readonly StudioProductGroup[],
): StudioProduct[] {
  return groups.flatMap((group) => group.products)
}

/** Rendered-order indices of the entries that can become active or selected. */
export function getSelectableProductIndices(
  products: readonly StudioProduct[],
): number[] {
  return products.flatMap((product, index) =>
    product.available ? [index] : [],
  )
}

function firstSelectableIndex(products: readonly StudioProduct[]): number {
  return getSelectableProductIndices(products)[0] ?? -1
}

/**
 * Filters entries by entry label or group label and omits groups left empty.
 */
export function filterStudioProductGroups(query: string): StudioProductGroup[] {
  const normalized = query.trim().toLowerCase()

  if (!normalized) {
    return [...STUDIO_PRODUCT_GROUPS]
  }

  return STUDIO_PRODUCT_GROUPS.flatMap((group) => {
    const groupMatches = group.label.toLowerCase().includes(normalized)
    const products = groupMatches
      ? group.products
      : group.products.filter((product) =>
          product.label.toLowerCase().includes(normalized),
        )

    return products.length > 0 ? [{ ...group, products }] : []
  })
}

export function StudioProductSwitcher({
  currentKey,
  onSelect,
  triggerClassName,
}: {
  /**
   * The entry marked current: the route entry for the current page, otherwise
   * the shell report context.
   */
  currentKey: StudioSelectableProductKey
  /**
   * The parent may cancel before the popover closes or selection state changes.
   * This component imports neither shell state nor the router.
   */
  onSelect: (product: StudioSelectableProduct) => void | boolean
  triggerClassName: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState("")
  // Index into the flattened, filtered entries; -1 when nothing is selectable.
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const baseId = useId()
  const listboxId = `${baseId}-products`
  const optionId = (key: StudioProductKey) => `${baseId}-product-${key}`
  const groupHeadingId = (key: StudioProductGroupKey) =>
    `${baseId}-group-${key}`

  const groups = useMemo(() => filterStudioProductGroups(query), [query])
  // Keyboard movement walks the selectable entries of the flattened, filtered
  // result order; disabled "Coming Soon" entries are never active.
  const products = useMemo(() => flattenStudioProductGroups(groups), [groups])
  const selectableIndices = useMemo(
    () => getSelectableProductIndices(products),
    [products],
  )
  const candidate = products[activeIndex]
  const activeProduct = candidate?.available ? candidate : null
  const activeOptionId = activeProduct ? optionId(activeProduct.key) : null

  // The top layer escapes the editor sidebar scrollport without reparenting
  // the menu: scoped theme tokens, blur handling and Tab order stay inherited.
  // All layout measurement/listeners exist only for the mounted open menu.
  useLayoutEffect(() => {
    if (!isOpen) return
    const menu = menuRef.current!
    const trigger = triggerRef.current!
    const position = () => {
      const rect = trigger.getBoundingClientRect()
      const sidebar = trigger.closest(".design-system-shell-sidebar")
      const besideRail =
        window.innerWidth > 900 &&
        sidebar?.querySelector<HTMLInputElement>(
          ".design-system-sidebar-checkbox",
        )?.checked
      const width = menu.getBoundingClientRect().width
      const height = menu.getBoundingClientRect().height
      menu.style.left = `${Math.max(16, Math.min(besideRail ? rect.right + 8 : rect.left, window.innerWidth - width - 16))}px`
      menu.style.top = `${Math.max(16, Math.min(besideRail ? rect.top : rect.bottom + 8, window.innerHeight - height - 16))}px`
    }
    menu.showPopover?.()
    position()
    // Search changes the height; keep the smaller result anchored as well.
    const observer = new ResizeObserver(position)
    observer.observe(menu)
    window.addEventListener("resize", position)
    window.addEventListener("scroll", position, true)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", position)
      window.removeEventListener("scroll", position, true)
      menu.hidePopover?.()
    }
  }, [isOpen])

  // Keep the keyboard-active option visible when the list scrolls.
  useEffect(() => {
    if (!isOpen || !activeOptionId) {
      return
    }

    document
      .getElementById(activeOptionId)
      ?.scrollIntoView?.({ block: "nearest" })
  }, [activeOptionId, isOpen])

  const close = useCallback((restoreFocus: boolean) => {
    setIsOpen(false)
    setQuery("")

    if (restoreFocus) {
      triggerRef.current?.focus()
    }
  }, [])

  const open = useCallback(() => {
    const allProducts = flattenStudioProductGroups(STUDIO_PRODUCT_GROUPS)
    const currentIndex = allProducts.findIndex(
      (product) => product.key === currentKey && product.available,
    )
    setQuery("")
    setActiveIndex(
      currentIndex >= 0 ? currentIndex : firstSelectableIndex(allProducts),
    )
    setIsOpen(true)
  }, [currentKey])

  // Listeners exist only while the popover is open, so the closed control adds
  // no document-level work to the shell.
  useEffect(() => {
    if (!isOpen) {
      return
    }

    inputRef.current?.focus()

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        close(false)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)

    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
    }
  }, [close, isOpen])

  const selectProduct = (product: StudioProduct | null) => {
    if (!product || !product.available) {
      return
    }

    if (onSelect(product) === false) return
    close(true)
  }

  /** Moves to the next/previous selectable entry, wrapping at either end. */
  const moveActive = (direction: 1 | -1) => {
    if (selectableIndices.length === 0) {
      return
    }

    const position = activeProduct ? selectableIndices.indexOf(activeIndex) : -1
    const lastPosition = selectableIndices.length - 1
    let next: number

    if (position < 0) {
      next = direction === 1 ? 0 : lastPosition
    } else if (direction === 1) {
      next = position >= lastPosition ? 0 : position + 1
    } else {
      next = position <= 0 ? lastPosition : position - 1
    }

    setActiveIndex(selectableIndices[next])
  }

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        moveActive(1)
        break
      case "ArrowUp":
        event.preventDefault()
        moveActive(-1)
        break
      case "Home":
        event.preventDefault()
        setActiveIndex(selectableIndices[0] ?? -1)
        break
      case "End":
        event.preventDefault()
        setActiveIndex(selectableIndices[selectableIndices.length - 1] ?? -1)
        break
      case "Enter":
        event.preventDefault()
        selectProduct(activeProduct)
        break
      case "Escape":
        event.preventDefault()
        event.stopPropagation()
        close(true)
        break
      case "Tab":
        close(false)
        break
    }
  }

  return (
    <div
      className="studio-product-switch relative w-full"
      ref={rootRef}
      onBlur={(event) => {
        if (
          isOpen &&
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          close(false)
        }
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className={cn(
          triggerClassName,
          "studio-product-switch-trigger w-full justify-start gap-2 px-3.5 text-sm font-semibold",
          isOpen &&
            "border-[color:var(--ds-black)] text-[color:var(--ds-black)] ring-[0.5px] ring-[color:var(--ds-black)]",
        )}
        aria-label="Switch product"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close(false) : open())}
      >
        <LayoutGrid size={17} aria-hidden="true" />
        <span className="studio-product-switch-label min-w-0 truncate">
          Switch product
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn(
            "studio-product-switch-chevron ml-auto shrink-0 transition-transform duration-150",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen ? (
        <div
          ref={menuRef}
          popover="manual"
          className="studio-product-switch-menu fixed inset-auto m-0 max-h-[calc(100dvh-2rem)] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[calc(var(--ds-radius)+12px)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-3 shadow-[0_20px_55px_rgba(17,17,17,0.14)]"
          role="dialog"
          aria-label="Switch product"
        >
          <div className="relative">
            <Search
              size={17}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--ds-muted)]"
            />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Switch product"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={activeOptionId ?? undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder="Switch product"
              value={query}
              onChange={(event) => {
                const nextQuery = event.currentTarget.value
                setQuery(nextQuery)
                setActiveIndex(
                  firstSelectableIndex(
                    flattenStudioProductGroups(
                      filterStudioProductGroups(nextQuery),
                    ),
                  ),
                )
              }}
              onKeyDown={handleInputKeyDown}
              className="h-11 w-full rounded-xl border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] pl-10 pr-3 text-sm font-medium text-[color:var(--ds-ink)] outline-none placeholder:text-[color:var(--ds-muted)] focus-visible:border-[color:var(--ds-black)] focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)]"
            />
          </div>

          <div
            id={listboxId}
            role="listbox"
            aria-label="Products"
            className="mt-2 flex max-h-[min(26rem,calc(100dvh-8rem))] flex-col gap-2 overflow-y-auto"
          >
            {groups.map((group) => (
              <div
                key={group.key}
                role="group"
                aria-labelledby={groupHeadingId(group.key)}
                className="flex flex-col gap-0.5"
              >
                <div
                  id={groupHeadingId(group.key)}
                  className="studio-product-switch-group-heading px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--ds-muted)]"
                >
                  {group.label}
                </div>
                {group.products.map((product) => {
                  const Icon = product.icon
                  const index = products.indexOf(product)
                  const isCurrent = product.key === currentKey
                  const isDisabled = !product.available
                  const isActive = !isDisabled && index === activeIndex

                  return (
                    <div
                      key={product.key}
                      id={optionId(product.key)}
                      role="option"
                      aria-selected={isCurrent}
                      aria-disabled={isDisabled || undefined}
                      onMouseDown={(event) => {
                        // Keep focus in the filter input while choosing.
                        event.preventDefault()
                      }}
                      onMouseMove={
                        isDisabled ? undefined : () => setActiveIndex(index)
                      }
                      onClick={
                        isDisabled ? undefined : () => selectProduct(product)
                      }
                      className={cn(
                        "flex min-h-[46px] select-none items-center gap-3 rounded-xl px-2.5 py-1.5 transition-colors duration-75",
                        isDisabled
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer",
                        isActive &&
                          "bg-[color:color-mix(in_srgb,var(--ds-black)_5%,transparent)]",
                      )}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--ds-black)_5%,transparent)] text-[color:var(--ds-ink)]">
                        <Icon size={17} strokeWidth={2} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[color:var(--ds-ink)]">
                        {product.label}
                      </span>
                      {isDisabled ? (
                        <Badge
                          variant="outline"
                          className="studio-product-switch-coming-soon shrink-0 whitespace-nowrap px-2 py-0.5"
                        >
                          Coming Soon
                        </Badge>
                      ) : null}
                      {isCurrent ? (
                        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[color:var(--ds-muted)]">
                          Current
                          <CornerDownLeft size={15} aria-hidden="true" />
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {products.length === 0 ? (
            <p
              className="px-2.5 py-3 text-sm font-medium text-[color:var(--ds-muted)]"
              role="status"
            >
              No entries match “{query.trim()}”.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
