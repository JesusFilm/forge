import type { Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import {
  loadWatchSearchAnalyticsData,
  type WatchSearchAnalyticsWindow,
} from "@/app/dashboard/ops-data"
import { WatchSearchRequestDetailPanel } from "@/app/dashboard/search/request-detail-panel"

type SearchRequestPageProps = {
  params: Promise<{ requestId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function searchHref(window: WatchSearchAnalyticsWindow) {
  const query = new URLSearchParams({ window })
  return `/dashboard/search?${query.toString()}`
}

export default async function SearchRequestPage({
  params,
  searchParams,
}: SearchRequestPageProps) {
  const routeParams = await params
  const queryParams = (await searchParams) ?? {}
  const data = await loadWatchSearchAnalyticsData({
    requestId: routeParams.requestId,
    window: firstParam(queryParams.window),
  })
  const request = data.selectedRequest

  if (!request) notFound()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2">
          <Link
            href={searchHref(data.window) as Route}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
            Results
          </Link>
          <span className="text-[12px] text-[var(--color-text-muted)]">/</span>
          <span className="label-text">Search Request</span>
        </nav>

        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            {request.queryText || "Redacted query"}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
            {request.createdAt}
          </p>
        </div>
      </div>

      <WatchSearchRequestDetailPanel request={request} />
    </div>
  )
}
