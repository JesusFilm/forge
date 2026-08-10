import type { Route } from "next"
import Link from "next/link"
import { env } from "@/config/env"
import { ChevronLeft, ChevronRight } from "lucide-react"
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
import { requireSession } from "@/auth/session"

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

function searchPageHref(params: {
  page: number
  window: WatchSearchAnalyticsWindow
}) {
  const query = new URLSearchParams({ window: params.window })
  if (params.page > 1) query.set("page", String(params.page))
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
  const principal = await requireSession()
  const messages = await getAdminMessages()
  const page = messages.pages.search
  const params = (await searchParams) ?? {}
  const watchSearch = await loadWatchSearchAnalyticsData({
    page: firstParam(params.page),
    window: firstParam(params.window),
  })
  const pagination = watchSearch.pagination
  const paginationLabel =
    pagination.totalRequests === 0
      ? "No requests"
      : `Showing ${pagination.startIndex + 1}-${pagination.endIndex} of ${pagination.totalRequests}`

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {principal.role === "ADMIN" &&
            env.WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED ? (
              <Link
                href={"/dashboard/search/compare" as Route}
                className="rounded-sm border border-[var(--color-hairline)] px-3 py-2 font-mono text-[11px] uppercase text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
              >
                Compare versions
              </Link>
            ) : null}
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
        meta={`${paginationLabel} - ${watchSearch.window}`}
      >
        <WatchSearchResultsTable
          requests={watchSearch.requests}
          window={watchSearch.window}
        />
        {pagination.totalPages > 1 ? (
          <div className="flex flex-col gap-3 border-t border-[var(--color-hairline)] px-4 pt-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="mono-meta text-[var(--color-text-muted)]">
              Page {pagination.currentPage} of {pagination.totalPages}
            </div>
            <div className="flex items-center gap-2">
              {pagination.currentPage > 1 ? (
                <Link
                  href={
                    searchPageHref({
                      window: watchSearch.window,
                      page: pagination.currentPage - 1,
                    }) as Route
                  }
                  className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-hairline)] px-3 py-1.5 font-mono text-[11px] uppercase text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                >
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.7} />
                  Previous
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-hairline)] px-3 py-1.5 font-mono text-[11px] uppercase text-[var(--color-text-muted)] opacity-50">
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.7} />
                  Previous
                </span>
              )}
              {pagination.currentPage < pagination.totalPages ? (
                <Link
                  href={
                    searchPageHref({
                      window: watchSearch.window,
                      page: pagination.currentPage + 1,
                    }) as Route
                  }
                  className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-hairline)] px-3 py-1.5 font-mono text-[11px] uppercase text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.7} />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-hairline)] px-3 py-1.5 font-mono text-[11px] uppercase text-[var(--color-text-muted)] opacity-50">
                  Next
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.7} />
                </span>
              )}
            </div>
          </div>
        ) : null}
      </PageSection>
    </div>
  )
}
