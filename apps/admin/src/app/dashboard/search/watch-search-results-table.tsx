"use client"

import { Fragment, useState } from "react"
import type { Route } from "next"
import Link from "next/link"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cx } from "@/components/admin-ui"
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

function ResultMetric({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="min-w-0">
      <div className="label-text">{label}</div>
      <div className="mt-1 truncate font-mono text-[12px] text-[var(--color-text-secondary)]">
        {value}
      </div>
    </div>
  )
}

function DisclosureButton({
  expanded,
  request,
  toggle,
}: {
  expanded: boolean
  request: WatchSearchAnalyticsRequestRow
  toggle: () => void
}) {
  if (request.collapsedRequests.length === 0) {
    return null
  }

  const Icon = expanded ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
      aria-expanded={expanded}
      aria-label={
        expanded
          ? `Collapse ${request.collapsedRequests.length} child searches`
          : `Expand ${request.collapsedRequests.length} child searches`
      }
    >
      <Icon className="h-4 w-4" strokeWidth={1.7} />
    </button>
  )
}

function ChildSearchList({
  requests,
  window,
}: {
  requests: WatchSearchAnalyticsRequestRow[]
  window: WatchSearchAnalyticsWindow
}) {
  return (
    <div className="divide-y divide-[var(--color-hairline)] rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      {requests.map((request) => (
        <Link
          key={request.requestId}
          href={requestHref(request, window) as Route}
          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-3 py-2 transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
        >
          <span
            className="line-clamp-1 min-w-0 break-words text-[13px] text-[var(--color-text-secondary)]"
            title={request.queryText || "Redacted query"}
          >
            {request.queryText || "Redacted query"}
          </span>
          <span className="mono-meta whitespace-nowrap text-[var(--color-text-muted)]">
            {displayDateTime(request.createdAtIso)}
          </span>
          <span className="font-mono text-[12px] text-[var(--color-text-muted)]">
            {request.resultCount}
          </span>
        </Link>
      ))}
    </div>
  )
}

export function WatchSearchResultsTable({
  requests,
  window,
}: {
  requests: WatchSearchAnalyticsRequestRow[]
  window: WatchSearchAnalyticsWindow
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  )

  function toggleGroup(requestId: string) {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(requestId)) {
        next.delete(requestId)
      } else {
        next.add(requestId)
      }
      return next
    })
  }

  if (requests.length === 0) {
    return (
      <div className="px-4 py-3">
        <div className="text-[13px] font-medium">No search traces</div>
        <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
          Try a wider time window or run a search on /watch.
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="divide-y divide-[var(--color-hairline)] lg:hidden">
        {requests.map((request) => (
          <div key={request.requestId}>
            <div className="px-4 py-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-start">
                  <div className="flex justify-center px-2">
                    <DisclosureButton
                      expanded={expandedGroups.has(request.requestId)}
                      request={request}
                      toggle={() => toggleGroup(request.requestId)}
                    />
                  </div>
                  <Link
                    href={requestHref(request, window) as Route}
                    className="line-clamp-2 min-w-0 break-words text-[13px] leading-5 font-medium"
                    title={request.queryText || "Redacted query"}
                  >
                    {request.queryText || "Redacted query"}
                  </Link>
                </div>
                <InlineStatus value={request.outcome} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <ResultMetric
                  label="Date"
                  value={displayDateTime(request.createdAtIso)}
                />
                <ResultMetric
                  label="Target"
                  value={request.targetLanguageLabel}
                />
                <ResultMetric label="Results" value={request.resultCount} />
                <ResultMetric
                  label="Latency"
                  value={
                    request.latencyMs === null
                      ? "n/a"
                      : `${Math.round(request.latencyMs)}ms`
                  }
                />
              </div>
              {request.clickedPosition ? (
                <div className="mono-meta mt-3 text-[var(--color-text-muted)]">
                  Clicked rank {request.clickedPosition}
                </div>
              ) : null}
            </div>
            {expandedGroups.has(request.requestId) ? (
              <div className="border-t border-[var(--color-hairline)] bg-[var(--color-surface-raised)]/35 px-4 py-3">
                <ChildSearchList
                  requests={request.collapsedRequests}
                  window={window}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="hidden lg:block">
        <div className="app-card overflow-x-auto rounded-none border-0">
          <table className="w-full border-collapse text-left">
            <thead className="hairline-strong-b">
              <tr className="h-10">
                {[
                  "",
                  "Query",
                  "Date",
                  "Target",
                  "Results",
                  "Click",
                  "Latency",
                  "Status",
                ].map((column, index) => (
                  <th
                    key={column || "toggle"}
                    className={cx(
                      "label-text px-4",
                      index === 0 && "w-11 px-2",
                      index === 1 && "pr-4 pl-0",
                    )}
                    aria-label={
                      index === 0 ? "Expand grouped searches" : undefined
                    }
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <Fragment key={request.requestId}>
                  <tr className="hairline-b h-[52px]">
                    <td className="w-11 align-middle">
                      <div className="flex h-[52px] items-center justify-center px-2 py-2">
                        <DisclosureButton
                          expanded={expandedGroups.has(request.requestId)}
                          request={request}
                          toggle={() => toggleGroup(request.requestId)}
                        />
                      </div>
                    </td>
                    <td className="align-middle">
                      <div className="w-[min(34rem,42vw)] min-w-[180px] max-w-[34rem] py-2 pr-4 pl-0">
                        <Link
                          href={requestHref(request, window) as Route}
                          className="line-clamp-2 min-w-0 break-words text-[13px] leading-5 font-medium text-[var(--color-text-primary)] transition-colors duration-[120ms] ease-out hover:text-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                          title={request.queryText || "Redacted query"}
                        >
                          {request.queryText || "Redacted query"}
                        </Link>
                      </div>
                    </td>
                    <td className="align-middle">
                      <Link
                        href={requestHref(request, window) as Route}
                        className="flex h-[52px] items-center px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                      >
                        <span className="mono-meta whitespace-nowrap text-[var(--color-text-muted)]">
                          {displayDateTime(request.createdAtIso)}
                        </span>
                      </Link>
                    </td>
                    <td className="align-middle">
                      <Link
                        href={requestHref(request, window) as Route}
                        className="flex h-[52px] items-center px-4 py-2 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                      >
                        {request.targetLanguageLabel}
                      </Link>
                    </td>
                    <td className="align-middle">
                      <Link
                        href={requestHref(request, window) as Route}
                        className="flex h-[52px] items-center px-4 py-2 font-mono text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                      >
                        {request.resultCount}
                      </Link>
                    </td>
                    <td className="align-middle">
                      <Link
                        href={requestHref(request, window) as Route}
                        className="flex h-[52px] items-center px-4 py-2 font-mono text-[12px] text-[var(--color-text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                      >
                        {request.clickedPosition
                          ? `rank ${request.clickedPosition}`
                          : "none"}
                      </Link>
                    </td>
                    <td className="align-middle">
                      <Link
                        href={requestHref(request, window) as Route}
                        className="flex h-[52px] items-center px-4 py-2 font-mono text-[12px] text-[var(--color-text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                      >
                        {request.latencyMs === null
                          ? "n/a"
                          : `${Math.round(request.latencyMs)}ms`}
                      </Link>
                    </td>
                    <td className="align-middle">
                      <Link
                        href={requestHref(request, window) as Route}
                        className="flex h-[52px] items-center px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                      >
                        <InlineStatus value={request.outcome} />
                      </Link>
                    </td>
                  </tr>
                  {expandedGroups.has(request.requestId)
                    ? request.collapsedRequests.map((childRequest) => (
                        <tr
                          key={childRequest.requestId}
                          className="hairline-b h-[52px] bg-[var(--color-surface-raised)]/35"
                        >
                          <td className="w-11 align-middle">
                            <div className="flex h-[52px] items-center justify-center px-2 py-2">
                              <span className="h-6 w-px bg-[var(--color-hairline-strong)]" />
                            </div>
                          </td>
                          <td className="align-middle">
                            <div className="w-[min(34rem,42vw)] min-w-[180px] max-w-[34rem] py-2 pr-4 pl-0">
                              <Link
                                href={
                                  requestHref(childRequest, window) as Route
                                }
                                className="line-clamp-2 min-w-0 break-words text-[13px] leading-5 font-normal text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:text-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                                title={
                                  childRequest.queryText || "Redacted query"
                                }
                              >
                                {childRequest.queryText || "Redacted query"}
                              </Link>
                            </div>
                          </td>
                          <td className="align-middle">
                            <Link
                              href={requestHref(childRequest, window) as Route}
                              className="flex h-[52px] items-center px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                            >
                              <span className="mono-meta whitespace-nowrap text-[var(--color-text-muted)]">
                                {displayDateTime(childRequest.createdAtIso)}
                              </span>
                            </Link>
                          </td>
                          <td className="align-middle">
                            <Link
                              href={requestHref(childRequest, window) as Route}
                              className="flex h-[52px] items-center px-4 py-2 text-[13px] text-[var(--color-text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                            >
                              {childRequest.targetLanguageLabel}
                            </Link>
                          </td>
                          <td className="align-middle">
                            <Link
                              href={requestHref(childRequest, window) as Route}
                              className="flex h-[52px] items-center px-4 py-2 font-mono text-[13px] text-[var(--color-text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                            >
                              {childRequest.resultCount}
                            </Link>
                          </td>
                          <td className="align-middle">
                            <Link
                              href={requestHref(childRequest, window) as Route}
                              className="flex h-[52px] items-center px-4 py-2 font-mono text-[12px] text-[var(--color-text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                            >
                              {childRequest.clickedPosition
                                ? `rank ${childRequest.clickedPosition}`
                                : "none"}
                            </Link>
                          </td>
                          <td className="align-middle">
                            <Link
                              href={requestHref(childRequest, window) as Route}
                              className="flex h-[52px] items-center px-4 py-2 font-mono text-[12px] text-[var(--color-text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                            >
                              {childRequest.latencyMs === null
                                ? "n/a"
                                : `${Math.round(childRequest.latencyMs)}ms`}
                            </Link>
                          </td>
                          <td className="align-middle">
                            <Link
                              href={requestHref(childRequest, window) as Route}
                              className="flex h-[52px] items-center px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand)]"
                            >
                              <InlineStatus value={childRequest.outcome} />
                            </Link>
                          </td>
                        </tr>
                      ))
                    : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
