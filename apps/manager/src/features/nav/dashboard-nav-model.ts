import type { Route } from "next"
import { resolveRequestedLanguageIds } from "@/features/coverage/language-selection"

export type DashboardNavPath =
  | "/dashboard/coverage"
  | "/dashboard/jobs"
  | "/dashboard/agents"

export type DashboardReportQueryPath =
  | DashboardNavPath
  | `/dashboard/jobs/${string}`

export function buildDashboardHrefWithReportQuery<
  TPath extends DashboardReportQueryPath,
>(pathname: TPath, currentQuery: string): Route<TPath> {
  const params = new URLSearchParams(currentQuery)
  const languageIds = resolveRequestedLanguageIds({
    languageId: params.get("languageId") ?? undefined,
    languageIds: params.get("languageIds") ?? undefined,
  })

  if (languageIds.length === 0) {
    return pathname as Route<TPath>
  }

  const nextParams = new URLSearchParams()
  nextParams.set("languageId", languageIds.join(","))

  return `${pathname}?${nextParams.toString()}` as Route<TPath>
}

export function buildDashboardNavHref<TPath extends DashboardNavPath>(
  pathname: TPath,
  currentQuery: string,
): Route<TPath> {
  return buildDashboardHrefWithReportQuery(pathname, currentQuery)
}
