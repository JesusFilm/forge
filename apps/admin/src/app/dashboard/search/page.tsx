import type { Route } from "next"
import Link from "next/link"
import { BarChart3, Clock3, MousePointerClick } from "lucide-react"
import {
  DashboardPageHeader,
  MetricCard,
  PageSection,
  cx,
} from "@/components/admin-ui"
import { getAdminMessages } from "@/i18n/server"
import {
  loadWatchSearchAnalyticsData,
  type WatchSearchAnalyticsWindow,
} from "@/app/dashboard/ops-data"
import { WatchSearchResultsTable } from "@/app/dashboard/search/watch-search-results-table"

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

const WINDOW_OPTIONS: Array<{
  value: WatchSearchAnalyticsWindow
  label: string
}> = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
]

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function searchHref(params: { window: WatchSearchAnalyticsWindow }) {
  const query = new URLSearchParams({ window: params.window })
  return `/dashboard/search?${query.toString()}`
}

function displayToken(value: string | null | undefined) {
  const normalized = value?.replace(/[_-]+/g, " ").trim()
  if (!normalized) return "None"
  return normalized
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase()
      if (/^\d+[a-z]+$/i.test(word)) return word.toLowerCase()
      return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`
    })
    .join(" ")
}

export default async function SearchPage({
  searchParams,
}: SearchPageProps = {}) {
  const messages = await getAdminMessages()
  const page = messages.pages.search
  const params = (await searchParams) ?? {}
  const watchSearch = await loadWatchSearchAnalyticsData({
    window: firstParam(params.window),
  })

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
        action={
          <div className="inline-flex rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1">
            {WINDOW_OPTIONS.map((option) => (
              <Link
                key={option.value}
                href={searchHref({ window: option.value }) as Route}
                className={cx(
                  "rounded-sm px-3 py-1.5 font-mono text-[11px] uppercase transition-all duration-[120ms] ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
                  option.value === watchSearch.window
                    ? "bg-[var(--color-brand)] text-white"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
                )}
              >
                {option.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {watchSearch.metrics.map((card) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            footer={displayToken(card.footer)}
          />
        ))}
      </div>

      <PageSection
        title="Search Results"
        meta={`Requests ${watchSearch.window}`}
        actions={
          <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
            <BarChart3 className="h-4 w-4" strokeWidth={1.5} />
            <MousePointerClick className="h-4 w-4" strokeWidth={1.5} />
            <Clock3 className="h-4 w-4" strokeWidth={1.5} />
          </div>
        }
      >
        <WatchSearchResultsTable
          requests={watchSearch.requests}
          window={watchSearch.window}
        />
      </PageSection>
    </div>
  )
}
