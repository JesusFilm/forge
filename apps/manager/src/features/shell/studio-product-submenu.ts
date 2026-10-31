import type { Route } from "next"
import type { LucideIcon } from "lucide-react"
import {
  BarChart2,
  Beaker,
  Bell,
  Bot,
  CalendarDays,
  Crop,
  FolderKanban,
  History,
  LayoutDashboard,
  ListChecks,
  SquarePlus,
} from "lucide-react"
import {
  getStudioRouteProductForPathname,
  type StudioReportProductKey,
  type StudioSelectableProductKey,
} from "./studio-product-switcher"

/**
 * A location that marks a submenu item active: `pathname` itself or one of its
 * sub-pages (unless `exact`), plus every `query` parameter when present.
 */
export type StudioSubmenuMatch = {
  exact?: boolean
  pathname: string
  query?: Readonly<Record<string, string>>
}

export type StudioSubmenuItem = {
  /** Shows the job queue count beside the item. */
  badge?: "job-queue"
  href: Route
  icon: LucideIcon
  key: string
  label: string
  /** Locations beyond `href` (and its sub-pages) that mark the item active. */
  matches?: readonly StudioSubmenuMatch[]
}

const REPORT: StudioSubmenuItem = {
  key: "coverage",
  label: "Report",
  icon: BarChart2,
  href: "/dashboard/coverage",
  // `/dashboard` redirects to the coverage report.
  matches: [{ pathname: "/dashboard", exact: true }],
}

const JOBS: StudioSubmenuItem = {
  key: "jobs",
  label: "Jobs",
  icon: ListChecks,
  href: "/dashboard/jobs",
  badge: "job-queue",
}

const SUBTITLE_LAB: StudioSubmenuItem = {
  key: "subtitle-lab",
  label: "Subtitle Lab",
  icon: Beaker,
  href: "/dashboard/subtitle-lab" as Route,
}

// Each selectable product owns the navigation list below the product switcher.
// Only existing Manager routes appear here. SEO run history is the existing
// `/dashboard/seo?view=runs` view; run reports live under /dashboard/seo/runs.
const STUDIO_PRODUCT_SUBMENUS: Readonly<
  Record<StudioSelectableProductKey, readonly StudioSubmenuItem[]>
> = {
  subtitles: [REPORT, JOBS, SUBTITLE_LAB],
  audio: [REPORT, JOBS],
  meta: [REPORT, JOBS],
  "smart-crop": [
    {
      key: "smart-crop",
      label: "Smart Crop",
      icon: Crop,
      href: "/dashboard/smart-crop",
    },
  ],
  shorts: [
    {
      key: "shorts-projects",
      label: "Projects",
      icon: FolderKanban,
      href: "/dashboard/shorts",
    },
    {
      key: "shorts-new",
      label: "New Project",
      icon: SquarePlus,
      href: "/dashboard/shorts/new" as Route,
    },
    {
      key: "shorts-calendar",
      label: "Planning Calendar",
      icon: CalendarDays,
      href: "/dashboard/shorts/calendar" as Route,
    },
  ],
  seo: [
    {
      key: "seo-overview",
      label: "Overview",
      icon: LayoutDashboard,
      href: "/dashboard/seo",
    },
    {
      key: "seo-runs",
      label: "Runs",
      icon: History,
      href: "/dashboard/seo?view=runs" as Route,
      matches: [{ pathname: "/dashboard/seo/runs" }],
    },
  ],
  alerts: [
    {
      key: "alerts",
      label: "Alerts",
      icon: Bell,
      href: "/dashboard/alerts",
    },
  ],
  agents: [
    {
      key: "agents",
      label: "Agents",
      icon: Bot,
      href: "/dashboard/agents",
    },
  ],
}

const REPORT_PRODUCT_KEYS: readonly StudioReportProductKey[] = [
  "subtitles",
  "audio",
  "meta",
]

export function isStudioReportProductKey(
  key: StudioSelectableProductKey,
): key is StudioReportProductKey {
  return (REPORT_PRODUCT_KEYS as readonly string[]).includes(key)
}

export function getStudioProductSubmenu(
  key: StudioSelectableProductKey,
): readonly StudioSubmenuItem[] {
  return STUDIO_PRODUCT_SUBMENUS[key]
}

function hrefToMatch(href: string): StudioSubmenuMatch {
  const [pathname, search = ""] = href.split("?")
  const params = new URLSearchParams(search)
  const query = Object.fromEntries(params.entries())

  return Object.keys(query).length > 0 ? { pathname, query } : { pathname }
}

/** Specificity of `match` for the location, or -1 when it does not match. */
function scoreMatch(
  match: StudioSubmenuMatch,
  pathname: string,
  searchParams: URLSearchParams,
): number {
  const pathMatches =
    pathname === match.pathname ||
    (!match.exact && pathname.startsWith(`${match.pathname}/`))

  if (!pathMatches) {
    return -1
  }

  const query = Object.entries(match.query ?? {})
  if (query.some(([name, value]) => searchParams.get(name) !== value)) {
    return -1
  }

  // Longer paths are more specific; matched query parameters break ties.
  return match.pathname.length * 100 + query.length
}

function toSearchParams(
  search: string | URLSearchParams | null | undefined,
): URLSearchParams {
  return search instanceof URLSearchParams
    ? search
    : new URLSearchParams(search ?? "")
}

/**
 * The key of the single most specific submenu item for the location, so a
 * nested route (for example /dashboard/shorts/new) marks only its own item.
 */
export function getActiveStudioSubmenuItemKey(
  items: readonly StudioSubmenuItem[],
  pathname: string,
  search?: string | URLSearchParams | null,
): string | null {
  const searchParams = toSearchParams(search)
  let activeKey: string | null = null
  let bestScore = -1

  for (const item of items) {
    for (const match of [hrefToMatch(item.href), ...(item.matches ?? [])]) {
      const score = scoreMatch(match, pathname, searchParams)
      if (score > bestScore) {
        bestScore = score
        activeKey = item.key
      }
    }
  }

  return activeKey
}

/** Whether the location belongs to one of the product's submenu items. */
export function isPathnameInStudioProductSubmenu(
  key: StudioSelectableProductKey,
  pathname: string,
  search?: string | URLSearchParams | null,
): boolean {
  return (
    getActiveStudioSubmenuItemKey(
      getStudioProductSubmenu(key),
      pathname,
      search,
    ) !== null
  )
}

/** Subtitle Lab belongs only to the Subtitles product. */
export function isSubtitleLabPathname(pathname: string): boolean {
  return (
    pathname === "/dashboard/subtitle-lab" ||
    pathname.startsWith("/dashboard/subtitle-lab/")
  )
}

/**
 * The selected product: a route product owns its route and sub-pages, Subtitle
 * Lab belongs to Subtitles, and shared Report/Jobs pages follow `reportType`.
 */
export function getStudioCurrentProductKey(
  pathname: string,
  reportType: StudioReportProductKey,
): StudioSelectableProductKey {
  const routeProduct = getStudioRouteProductForPathname(pathname)
  if (routeProduct) {
    return routeProduct.key
  }

  return isSubtitleLabPathname(pathname) ? "subtitles" : reportType
}
