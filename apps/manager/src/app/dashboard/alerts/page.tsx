import type { Metadata } from "next"
import { createWatchRouteAlertsAdminClient } from "@/features/alerts/watch-route-alerts-admin-client"
import {
  watchRouteAlertsPageSchema,
  type WatchRouteAlertsPage,
} from "@/features/alerts/watch-route-alert-contract"
import { WatchRouteAlertsReport } from "@/features/alerts/watch-route-alerts-report"
import { requireAuth } from "@/lib/require-auth"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Watch route alerts — Studio" }

function unavailablePage(): WatchRouteAlertsPage {
  return watchRouteAlertsPageSchema.parse({
    generatedAt: new Date().toISOString(),
    monitorState: "UNAVAILABLE",
    recoverySuppressed: true,
    lastSuccessfulAt: null,
    latestRun: null,
    propertyRuns: [],
    propertyRunsTruncated: false,
    summary: {
      open: 0,
      critical: 0,
      supportedRouteFailures: 0,
      plausibleMissingRoutes: 0,
      recovered: 0,
    },
    items: [],
    totalCount: 0,
    showing: 0,
    hasNextPage: false,
    nextCursor: null,
  })
}

export default async function WatchRouteAlertsPage({
  searchParams,
}: {
  searchParams?: Promise<{ cursor?: string }>
}) {
  await requireAuth()
  const params = await searchParams
  let page = unavailablePage()
  let loadError: string | undefined
  try {
    page = await (
      await createWatchRouteAlertsAdminClient()
    ).getWatchRouteAlerts(25, params?.cursor)
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : "Watch route alerts could not be loaded."
  }
  return <WatchRouteAlertsReport page={page} loadError={loadError} />
}
