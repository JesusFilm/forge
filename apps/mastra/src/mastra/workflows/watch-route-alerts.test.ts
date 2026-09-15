import { describe, expect, it, vi } from "vitest"
import { classifyPublicWatchPathname } from "@forge/watch-url-policy/routes"

import { getSeoConfig } from "../../config/seo"
import { completeWatchRouteAlertRun } from "../../services/admin-watch-route-alert-client"
import { queryWatchRouteNotFoundLane } from "../../services/google-analytics-client"
import {
  isManifestAdmitted,
  runWatchRouteAlerts,
  watchRouteAlertsWorkflow,
} from "./watch-route-alerts"

const manifest = {
  version: "manifest-v1",
  generatedAt: "2026-09-03T00:00:00.000Z",
  contentSlugs: ["jesus"],
  oneSegmentSlugs: ["jesus"],
  homepageLocales: ["english"],
  episodePairsByParent: {},
  audioLanguageSlugs: ["english"],
  audioLanguageIndexesByContent: { jesus: [0] },
  audioLanguageIndexesByEpisode: {},
  nestedContainerAudioLanguageIndexesByParent: {},
}

function config(
  mode: "off" | "dry_run" | "live" = "live",
  maxCandidates = "25",
) {
  return getSeoConfig({
    WATCH_ROUTE_ALERT_MODE: mode,
    WATCH_ROUTE_ALERT_MAX_CANDIDATES: maxCandidates,
    SEO_GA4_PROPERTY_IDS: "320198532",
    SEO_ADMIN_BASE_URL: "https://admin.test",
    SEO_ADMIN_ALLOWED_HOSTS: "admin.test",
    SEO_WORKLOAD_KEY_ID: "test-key",
    SEO_WORKLOAD_PRIVATE_KEY: "test-key",
  })
}

function claimResult() {
  return {
    ok: true as const,
    result: {
      run: {
        id: "run-1",
        propertyId: "320198532",
        mode: "live" as const,
        status: "running" as const,
        windowStart: "2026-09-01T00:00:00.000Z",
        windowEnd: "2026-09-03T23:59:59.999Z",
        startedAt: "2026-09-04T12:15:00.000Z",
        completedAt: null,
      },
      claim: {
        generation: 1,
        token: "claim-token-long-enough",
        expiresAt: "2026-09-04T03:30:00.000Z",
      },
      replayed: false,
      openAlerts: [{ id: "old", path: "/watch/old.html", lastProbedAt: null }],
      manifest,
    },
  }
}

describe("runWatchRouteAlerts", () => {
  it("prefers explicit event counts and persists supported soft-404 evidence", async () => {
    const completions: Array<Parameters<typeof completeWatchRouteAlertRun>[0]> =
      []
    const complete: typeof completeWatchRouteAlertRun = async (input) => {
      completions.push(input)
      return {
        ok: true as const,
        result: { run: claimResult().result.run, replayed: false },
      }
    }
    const queryLane: typeof queryWatchRouteNotFoundLane = vi.fn(
      async ({ lane }) => ({
        ok: true as const,
        propertyId: "320198532",
        lane,
        complete: true,
        caveats: [],
        propertyTimezone: "America/Los_Angeles",
        rows: [
          {
            dimensions: {
              date: "20260903",
              pagePathPlusQueryString:
                "/watch/jesus.html/english.html?utm_source=test",
              ...(lane === "localized_title"
                ? { pageTitle: "Page not found" }
                : {}),
            },
            metrics: (lane === "explicit_event"
              ? { eventCount: 4, activeUsers: 3 }
              : { screenPageViews: 99, activeUsers: 80 }) as Record<
              string,
              number
            >,
          },
        ],
      }),
    )
    const result = await runWatchRouteAlerts(
      { scheduledFor: "2026-09-04T12:15:00.000Z" },
      {
        config: config(),
        now: () => new Date("2026-09-04T12:15:00.000Z"),
        claim: vi.fn(async () => claimResult()),
        complete,
        queryLane,
        probe: vi.fn(async ({ path }) => ({
          kind: "healthy_html" as const,
          status: 200,
          probedAt: "2026-09-04T12:15:00.000Z",
          finalUrl: `https://www.jesusfilm.org${path}`,
          contentType: "text/html; charset=utf-8",
        })),
      },
    )

    expect(result).toMatchObject({ ok: true, reason: "completed" })
    const completion = completions[0]
    expect(completion).toBeDefined()
    if (!completion) throw new Error("expected completion")
    expect(completion.observations).toEqual([
      expect.objectContaining({
        path: "/watch/jesus.html/english.html",
        verdict: "supported_route_failure",
        count: 4,
        countKind: "event_count",
        evidence: { sources: ["EXPLICIT_EVENT", "LOCALIZED_TITLE"] },
      }),
    ])
    expect(completion.reprobes).toHaveLength(1)
    expect(queryLane).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-09-01",
        endDate: "2026-09-03",
        config: expect.objectContaining({
          maxGa4Rows: 20_000,
          timeoutMs: 15_000,
        }),
      }),
    )
  })

  it("suppresses recovery when a GA4 lane is incomplete", async () => {
    const completions: Array<Parameters<typeof completeWatchRouteAlertRun>[0]> =
      []
    const complete: typeof completeWatchRouteAlertRun = async (input) => {
      completions.push(input)
      return {
        ok: true as const,
        result: { run: claimResult().result.run, replayed: false },
      }
    }
    const queryLane: typeof queryWatchRouteNotFoundLane = async ({ lane }) =>
      lane === "explicit_event"
        ? { ok: false as const, reason: "timeout" as const, retryable: true }
        : {
            ok: true as const,
            propertyId: "320198532",
            lane,
            complete: true,
            caveats: [],
            propertyTimezone: null,
            rows: [],
          }
    await runWatchRouteAlerts(
      { scheduledFor: "2026-09-04T12:15:00.000Z" },
      {
        config: config(),
        now: () => new Date("2026-09-04T12:15:00.000Z"),
        claim: vi.fn(async () => claimResult()),
        complete,
        queryLane,
        probe: vi.fn(async ({ path }) => ({
          kind: "healthy_html" as const,
          status: 200,
          probedAt: "2026-09-04T12:15:00.000Z",
          finalUrl: `https://www.jesusfilm.org${path}`,
          contentType: "text/html",
        })),
      },
    )

    expect(completions[0]).toMatchObject({
      status: "partial",
      reprobes: [],
    })
  })

  it("does not recover a GA-observed path omitted by the candidate cap", async () => {
    const completions: Array<Parameters<typeof completeWatchRouteAlertRun>[0]> =
      []
    const probe = vi.fn(async ({ path }: { path: string }) => ({
      kind: "missing" as const,
      status: 404,
      probedAt: "2026-09-04T12:15:00.000Z",
      finalUrl: `https://www.jesusfilm.org${path}`,
      contentType: "text/html",
    }))
    await runWatchRouteAlerts(
      { scheduledFor: "2026-09-04T12:15:00.000Z" },
      {
        config: config("live", "1"),
        now: () => new Date("2026-09-04T12:15:00.000Z"),
        claim: vi.fn(async () => ({
          ...claimResult(),
          result: {
            ...claimResult().result,
            openAlerts: [
              {
                id: "lower-ranked",
                path: "/watch/jesus.html/english.html",
                lastProbedAt: null,
              },
            ],
          },
        })),
        complete: vi.fn(async (input) => {
          completions.push(input)
          return {
            ok: true as const,
            result: { run: claimResult().result.run, replayed: false },
          }
        }),
        queryLane: vi.fn(async ({ lane }) => ({
          ok: true as const,
          propertyId: "320198532",
          lane,
          complete: true,
          caveats: [],
          propertyTimezone: "America/Los_Angeles",
          rows:
            lane === "localized_title"
              ? []
              : [
                  {
                    dimensions: {
                      date: "20260903",
                      pagePathPlusQueryString: "/watch/jesus.html",
                    },
                    metrics: { eventCount: 10, activeUsers: 8 },
                  },
                  {
                    dimensions: {
                      date: "20260903",
                      pagePathPlusQueryString: "/watch/jesus.html/english.html",
                    },
                    metrics: { eventCount: 1, activeUsers: 1 },
                  },
                ],
        })),
        probe,
      },
    )

    expect(completions[0]?.observations).toHaveLength(1)
    expect(completions[0]?.reprobes).toEqual([])
    expect(completions[0]).toMatchObject({
      status: "partial",
      report: {
        candidateTruncatedCount: 1,
        validationCaveats: [
          "1 actionable candidate(s) exceeded the validation cap.",
        ],
      },
    })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it("marks the run partial and suppresses recovery when a route probe is inconclusive", async () => {
    const completions: Array<Parameters<typeof completeWatchRouteAlertRun>[0]> =
      []
    await runWatchRouteAlerts(
      { scheduledFor: "2026-09-04T12:15:00.000Z" },
      {
        config: config(),
        now: () => new Date("2026-09-04T12:15:00.000Z"),
        claim: vi.fn(async () => claimResult()),
        complete: vi.fn(async (input) => {
          completions.push(input)
          return {
            ok: true as const,
            result: { run: claimResult().result.run, replayed: false },
          }
        }),
        queryLane: vi.fn(async ({ lane }) => ({
          ok: true as const,
          propertyId: "320198532",
          lane,
          complete: true,
          caveats: [],
          propertyTimezone: "America/Los_Angeles",
          rows:
            lane === "localized_title"
              ? []
              : [
                  {
                    dimensions: {
                      date: "20260903",
                      pagePathPlusQueryString: "/watch/jesus.html",
                    },
                    metrics: { eventCount: 2, activeUsers: 2 },
                  },
                ],
        })),
        probe: vi.fn(async () => ({
          kind: "inconclusive" as const,
          status: 503,
          probedAt: "2026-09-04T12:15:00.000Z",
          finalUrl: "https://www.jesusfilm.org/watch/jesus.html",
          contentType: "text/html",
        })),
      },
    )

    expect(completions[0]).toMatchObject({
      status: "partial",
      reprobes: [],
      report: {
        inconclusiveProbeCount: 2,
        validationCaveats: [
          "2 route probe(s) were inconclusive or redirected.",
        ],
      },
    })
  })

  it("recognizes public language home routes as admitted", () => {
    const route = classifyPublicWatchPathname("/watch/french.html")
    expect(route.kind).toBe("page")
    if (route.kind !== "page") throw new Error("expected public Watch page")
    expect(isManifestAdmitted(route, manifest)).toBe(true)
  })

  it("fails closed without provider calls when the route manifest is stale", async () => {
    const complete = vi.fn(async () => ({
      ok: true as const,
      result: { run: claimResult().result.run, replayed: false },
    }))
    const queryLane = vi.fn<typeof queryWatchRouteNotFoundLane>()

    const result = await runWatchRouteAlerts(
      { scheduledFor: "2026-09-10T12:15:00.000Z" },
      {
        config: config(),
        now: () => new Date("2026-09-10T12:15:00.000Z"),
        claim: vi.fn(async () => claimResult()),
        complete,
        queryLane,
      },
    )

    expect(queryLane).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, reason: "failed" })
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        report: expect.objectContaining({
          validationCaveats: [
            "The Admin Watch route manifest is stale or future-dated.",
          ],
        }),
      }),
      expect.any(Object),
    )
  })

  it("persists plausible routes while treating malformed, reserved, and off-origin rows as noise", async () => {
    const completions: Array<Parameters<typeof completeWatchRouteAlertRun>[0]> =
      []
    const probe = vi.fn(async ({ path }: { path: string }) => ({
      kind: "missing" as const,
      status: 404,
      probedAt: "2026-09-04T12:15:00.000Z",
      finalUrl: `https://www.jesusfilm.org${path}`,
      contentType: "text/html",
    }))
    await runWatchRouteAlerts(
      { scheduledFor: "2026-09-04T12:15:00.000Z" },
      {
        config: config(),
        now: () => new Date("2026-09-04T12:15:00.000Z"),
        claim: vi.fn(async () => ({
          ...claimResult(),
          result: { ...claimResult().result, openAlerts: [] },
        })),
        complete: vi.fn(async (input) => {
          completions.push(input)
          return {
            ok: true as const,
            result: { run: claimResult().result.run, replayed: false },
          }
        }),
        queryLane: vi.fn(async ({ lane }) => ({
          ok: true as const,
          propertyId: "320198532",
          lane,
          complete: true,
          caveats: [],
          propertyTimezone: "America/Los_Angeles",
          rows:
            lane === "localized_title"
              ? []
              : [
                  "/watch/jesus.html/french.html",
                  "/watch/api/private",
                  "/watch/no-extension",
                  "/watch/jesus.html/arbitrary.html",
                  "/watch/arbitrary.html/english.html",
                  "https://attacker.example/watch/jesus.html",
                ].map((path) => ({
                  dimensions: {
                    date: "20260903",
                    pagePathPlusQueryString: path,
                  },
                  metrics: { eventCount: 1, activeUsers: 1 },
                })),
        })),
        probe,
      },
    )

    expect(completions[0]).toMatchObject({
      status: "completed",
      noiseCount: 5,
      observations: [
        {
          path: "/watch/jesus.html/french.html",
          verdict: "plausible_missing_route",
        },
      ],
    })
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/watch/jesus.html/french.html" }),
    )
  })

  it("uses only settled GA4 dates during an early UTC manual run", async () => {
    const claim = vi.fn(async () => ({
      ok: false as const,
      reason: "network_error" as const,
      retryable: true,
    }))
    await runWatchRouteAlerts(
      { scheduledFor: "2026-09-04T03:15:00.000Z" },
      {
        config: config(),
        now: () => new Date("2026-09-10T18:00:00.000Z"),
        claim,
      },
    )
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        windowStart: "2026-08-31T00:00:00.000Z",
        windowEnd: "2026-09-02T23:59:59.999Z",
      }),
      expect.any(Object),
    )
  })

  it("returns the terminal status when an idempotent run has no claim", async () => {
    const result = await runWatchRouteAlerts(
      { scheduledFor: "2026-09-04T12:15:00.000Z" },
      {
        config: config(),
        now: () => new Date("2026-09-04T12:15:00.000Z"),
        claim: vi.fn(async () => ({
          ...claimResult(),
          result: {
            ...claimResult().result,
            run: {
              ...claimResult().result.run,
              status: "completed" as const,
              completedAt: "2026-09-04T12:20:00.000Z",
            },
            claim: null,
            manifest: null,
          },
        })),
      },
    )

    expect(result).toMatchObject({
      ok: true,
      reason: "completed",
      properties: [{ status: "completed" }],
    })
  })

  it("is registered after every GA4 property day has settled", () => {
    const schedules = (
      watchRouteAlertsWorkflow as unknown as {
        getScheduleConfigs: () => Array<{ cron: string; timezone?: string }>
      }
    ).getScheduleConfigs()
    expect(schedules).toEqual([
      expect.objectContaining({ cron: "15 12 * * *", timezone: "UTC" }),
    ])
  })
})
