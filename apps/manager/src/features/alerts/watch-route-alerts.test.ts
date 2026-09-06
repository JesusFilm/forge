import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { AdminGraphqlClient } from "@/backend/admin-client"
import { watchRouteAlertsPageSchema } from "./watch-route-alert-contract"
import {
  safeWatchUrl,
  WatchRouteAlertsReport,
} from "./watch-route-alerts-report"

const payload = {
  generatedAt: "2026-09-04T12:00:00.000Z",
  monitorState: "PARTIAL",
  recoverySuppressed: true,
  lastSuccessfulAt: "2026-09-03T12:00:00.000Z",
  latestRun: {
    id: "run-1",
    propertyId: "320198532",
    mode: "LIVE",
    status: "PARTIAL",
    startedAt: "2026-09-04T11:59:00.000Z",
    completedAt: "2026-09-04T12:00:00.000Z",
    lanes: [
      {
        source: "EXPLICIT_EVENT",
        status: "COMPLETE",
        countKind: "EVENT_COUNT",
        rowCount: 1,
        windowStart: "2026-09-01T00:00:00.000Z",
        windowEnd: "2026-09-03T23:59:59.000Z",
        caveats: [],
      },
      {
        source: "LOCALIZED_TITLE",
        status: "PARTIAL",
        countKind: "PAGE_VIEWS",
        rowCount: 4,
        windowStart: "2026-09-01T00:00:00.000Z",
        windowEnd: "2026-09-03T23:59:59.000Z",
        caveats: ["GA4 row cap reached."],
      },
    ],
    validationCaveats: [],
  },
  propertyRuns: [],
  propertyRunsTruncated: false,
  summary: {
    open: 1,
    critical: 0,
    supportedRouteFailures: 1,
    plausibleMissingRoutes: 0,
    recovered: 0,
  },
  items: [
    {
      id: "alert-1",
      propertyId: "320198532",
      origin: "https://www.jesusfilm.org",
      path: "/watch/jesus.html/english.html",
      lifecycle: "OPEN",
      verdict: "SUPPORTED_ROUTE_FAILURE",
      severity: "HIGH",
      count: 12,
      countKind: "PAGE_VIEWS",
      activeUsers: 10,
      occurrenceCount: 2,
      firstSeenAt: "2026-09-02T00:00:00.000Z",
      lastSeenAt: "2026-09-03T00:00:00.000Z",
      lastProbedAt: "2026-09-04T00:00:00.000Z",
      httpStatus: 200,
      manifestVersion: "abcdef1234567890",
      sources: ["LOCALIZED_TITLE"],
    },
  ],
  totalCount: 1,
  showing: 1,
  hasNextPage: false,
  nextCursor: null,
} as const

describe("Watch route alerts Manager contract", () => {
  it("requests and validates the bounded Admin projection", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: { managerWatchRouteAlerts: payload } }),
          {
            status: 200,
          },
        ),
    )
    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example.test/api/graphql",
      apiKey: "manager-bearer",
      fetchImpl,
    })

    await expect(client.getWatchRouteAlerts(25)).resolves.toEqual(payload)
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0]![1] as RequestInit).body),
    ) as { query: string; variables: unknown }
    expect(body.query).toContain("managerWatchRouteAlerts")
    expect(body.query).toContain("lanes")
    expect(body.query).toContain("propertyRuns")
    expect(body.variables).toEqual({ limit: 25 })
  })

  it("rejects an unbounded or malformed Admin projection", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              managerWatchRouteAlerts: {
                ...payload,
                items: [{ ...payload.items[0], path: "/outside/secret" }],
              },
            },
          }),
          { status: 200 },
        ),
    )
    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example.test/api/graphql",
      fetchImpl,
    })
    await expect(client.getWatchRouteAlerts()).rejects.toThrow(
      "invalid payload",
    )
  })

  it("constructs links only for safe query-free Watch paths", () => {
    expect(safeWatchUrl("/watch/jesus.html/english.html")).toBe(
      "https://www.jesusfilm.org/watch/jesus.html/english.html",
    )
    expect(safeWatchUrl("/watch/api/private")).toBeNull()
    expect(safeWatchUrl("/watch/a?token=secret")).toBeNull()
    expect(safeWatchUrl("//evil.example/watch/a")).toBeNull()
  })

  it("renders surfaced issues and both GA4 evidence lanes", () => {
    const html = renderToStaticMarkup(
      createElement(WatchRouteAlertsReport, {
        page: watchRouteAlertsPageSchema.parse(payload),
      }),
    )

    expect(html).toContain("Coverage is partial.")
    expect(html).toContain("GA4 page_not_found")
    expect(html).toContain("Localized 404-title check")
    expect(html).toContain("/watch/jesus.html/english.html")
    expect(html).toContain("Supported route failed")
  })

  it("distinguishes a healthy empty report from a load failure", () => {
    const healthy = watchRouteAlertsPageSchema.parse({
      ...payload,
      monitorState: "HEALTHY",
      recoverySuppressed: false,
      latestRun: {
        ...payload.latestRun,
        status: "COMPLETED",
        lanes: payload.latestRun.lanes.map((lane) => ({
          ...lane,
          status: "COMPLETE",
          caveats: [],
        })),
      },
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
    })
    const healthyHtml = renderToStaticMarkup(
      createElement(WatchRouteAlertsReport, { page: healthy }),
    )
    const failureHtml = renderToStaticMarkup(
      createElement(WatchRouteAlertsReport, {
        page: healthy,
        loadError: "Admin GraphQL unavailable.",
      }),
    )

    expect(healthyHtml).toContain("No actionable Watch 404s found.")
    expect(failureHtml).toContain("Alerts could not be loaded.")
    expect(failureHtml).toContain("Admin GraphQL unavailable.")
  })

  it("renders never-run, unavailable, recovered, and pagination states", () => {
    const parsed = watchRouteAlertsPageSchema.parse(payload)
    const neverRun = renderToStaticMarkup(
      createElement(WatchRouteAlertsReport, {
        page: {
          ...parsed,
          monitorState: "NEVER_RUN",
          latestRun: null,
          lastSuccessfulAt: null,
        },
      }),
    )
    const unavailable = renderToStaticMarkup(
      createElement(WatchRouteAlertsReport, {
        page: { ...parsed, monitorState: "UNAVAILABLE" },
      }),
    )
    const recoveredAndPaginated = renderToStaticMarkup(
      createElement(WatchRouteAlertsReport, {
        page: {
          ...parsed,
          items: [{ ...parsed.items[0]!, lifecycle: "RECOVERED" }],
          hasNextPage: true,
          nextCursor: "cursor/with+symbols",
        },
      }),
    )

    expect(neverRun).toContain("Monitoring has not run yet.")
    expect(unavailable).toContain("The latest monitor run is unavailable.")
    expect(unavailable).toContain("Last successful run:")
    expect(recoveredAndPaginated).toContain("Recovered")
    expect(recoveredAndPaginated).toContain(
      "/dashboard/alerts?cursor=cursor%2Fwith%2Bsymbols",
    )
  })

  it("shows per-property health and validation coverage", () => {
    const firstRun = watchRouteAlertsPageSchema.parse(payload).latestRun!
    const html = renderToStaticMarkup(
      createElement(WatchRouteAlertsReport, {
        page: watchRouteAlertsPageSchema.parse({
          ...payload,
          propertyRuns: [
            firstRun,
            {
              ...firstRun,
              id: "run-2",
              propertyId: "987654321",
              status: "PARTIAL",
              validationCaveats: [
                "2 route probe(s) were inconclusive or redirected.",
              ],
            },
          ],
        }),
      }),
    )

    expect(html).toContain("GA4 property 320198532")
    expect(html).toContain("GA4 property 987654321")
    expect(html).toContain(
      "Validation coverage: 2 route probe(s) were inconclusive or redirected.",
    )
  })
})
