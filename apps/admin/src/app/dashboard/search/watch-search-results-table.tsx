"use client"

import type { Route } from "next"
import { DataTable, cx } from "@/components/admin-ui"
import type {
  WatchSearchAnalyticsRequestRow,
  WatchSearchAnalyticsWindow,
} from "@/app/dashboard/ops-data"

function statusTone(value: string) {
  if (value === "success" || value === "fulfilled") return "success"
  if (value === "degraded") return "warning"
  if (value === "skipped") return "muted"
  if (value === "unavailable" || value === "failed") return "danger"
  return "info"
}

function statusDotClass(value: string) {
  const tone = statusTone(value)
  if (tone === "success") return "bg-[var(--color-success)]"
  if (tone === "warning") return "bg-[var(--color-warning)]"
  if (tone === "danger") return "bg-[var(--color-danger)]"
  if (tone === "info") return "bg-[var(--color-info)]"
  return "bg-[var(--color-text-muted)]"
}

function InlineStatus({ value }: { value: string }) {
  return (
    <span className="inline-flex h-5 items-center gap-1.5 whitespace-nowrap font-mono text-[12px] leading-none text-[var(--color-text-secondary)]">
      <span
        aria-hidden="true"
        className={cx("h-1.5 w-1.5 rounded-full", statusDotClass(value))}
      />
      {displayToken(value)}
    </span>
  )
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

function displayDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value))
}

function requestHref(
  request: WatchSearchAnalyticsRequestRow,
  window: WatchSearchAnalyticsWindow,
) {
  const query = new URLSearchParams({ window })
  return `/dashboard/search/${encodeURIComponent(request.requestId)}?${query.toString()}`
}

export function WatchSearchResultsTable({
  requests,
  window,
}: {
  requests: WatchSearchAnalyticsRequestRow[]
  window: WatchSearchAnalyticsWindow
}) {
  return (
    <DataTable
      columns={[
        "Query",
        "Date",
        "Target",
        "Results",
        "Click",
        "Latency",
        "Status",
      ]}
      rowHrefs={
        requests.length > 0
          ? requests.map((request) => requestHref(request, window) as Route)
          : undefined
      }
      rows={
        requests.length > 0
          ? requests.map((request) => [
              <div
                key={`${request.requestId}-query`}
                className="min-w-[220px] truncate text-[13px] font-medium"
              >
                {request.queryText || "Redacted query"}
              </div>,
              <span
                key={`${request.requestId}-date`}
                className="mono-meta whitespace-nowrap text-[var(--color-text-muted)]"
              >
                {displayDateTime(request.createdAtIso)}
              </span>,
              <span key={`${request.requestId}-target`} className="text-[13px]">
                {request.targetLanguageLabel}
              </span>,
              <span
                key={`${request.requestId}-results`}
                className="font-mono text-[13px]"
              >
                {request.resultCount}
              </span>,
              <span
                key={`${request.requestId}-click`}
                className="font-mono text-[12px] text-[var(--color-text-secondary)]"
              >
                {request.clickedPosition
                  ? `rank ${request.clickedPosition}`
                  : "none"}
              </span>,
              <span
                key={`${request.requestId}-latency`}
                className="font-mono text-[12px] text-[var(--color-text-secondary)]"
              >
                {request.latencyMs === null
                  ? "n/a"
                  : `${Math.round(request.latencyMs)}ms`}
              </span>,
              <span
                key={`${request.requestId}-status`}
                className="flex items-center"
              >
                <InlineStatus value={request.outcome} />
              </span>,
            ])
          : [
              [
                <div key="empty-query">
                  <div className="text-[13px] font-medium">
                    No Watch search traces
                  </div>
                  <div className="mono-meta text-[var(--color-text-muted)]">
                    Try a wider time window or run a search on /watch.
                  </div>
                </div>,
                <span key="empty-date" className="mono-meta">
                  --
                </span>,
                <span key="empty-target" className="mono-meta">
                  --
                </span>,
                <span key="empty-results" className="mono-meta">
                  --
                </span>,
                <span key="empty-click" className="mono-meta">
                  --
                </span>,
                <span key="empty-latency" className="mono-meta">
                  --
                </span>,
                <span key="empty-status" className="mono-meta">
                  --
                </span>,
              ],
            ]
      }
    />
  )
}
