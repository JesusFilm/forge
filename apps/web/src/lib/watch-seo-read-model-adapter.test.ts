import { describe, expect, it } from "vitest"

import { adaptWatchSeoReadModel } from "./watch-seo-read-model-adapter"

const unavailable = (reason = "no_per_page_projection") => ({
  state: "not_connected",
  reason,
  source: { kind: "not_connected", provider: null },
  retrievedAt: null,
  window: null,
  data: null,
  caveats: ["No durable page-level source is connected."],
})

describe("adaptWatchSeoReadModel", () => {
  it("turns retained Admin evidence into the presentation contract without inventing absent metrics", () => {
    const result = adaptWatchSeoReadModel({
      version: "watch-seo-read-model/v1",
      identity: {
        videoSlug: "jesus",
        languageSlug: "english",
        locale: "en",
        videoLocaleId: "dub-1",
        canonicalUrl: "https://www.jesusfilm.org/watch/jesus.html/english.html",
        contextualParentSlug: null,
      },
      sections: {
        pageMetadata: {
          state: "available",
          reason: null,
          source: { kind: "admin_database", provider: null },
          retrievedAt: "2026-10-16T00:00:00.000Z",
          window: null,
          caveats: [],
          data: {
            title: "JESUS",
            description: "Watch the film.",
            searchTitle: "JESUS Film",
            searchDescription: "Watch JESUS.",
            hasSocialImage: true,
          },
        },
        search: {
          state: "available",
          reason: null,
          source: { kind: "retained_ledger", provider: "gsc" },
          retrievedAt: "2026-10-16T00:00:00.000Z",
          window: { start: "2026-10-01", end: "2026-10-15" },
          caveats: [],
          data: {
            queries: [
              {
                clicks: 0,
                impressions: 10,
                position: 4,
                observedAt: "2026-10-15T00:00:00.000Z",
              },
            ],
          },
        },
        crawl: {
          state: "partial",
          reason: null,
          source: { kind: "stored_observation", provider: "firecrawl" },
          retrievedAt: "2026-10-15T00:00:00.000Z",
          window: null,
          caveats: [],
          data: {
            provider: "firecrawl",
            title: "JESUS",
            description: "Watch the film.",
            fetcherCacheState: null,
            fetcherCachedAt: null,
            complete: true,
          },
        },
        ga4PageAndCta: unavailable(),
        watchDepth: unavailable("no_watch_depth_source"),
        aiReferrals: unavailable("no_ai_referral_source"),
        botVisits: unavailable("no_bot_log_source"),
        cacheHistory: unavailable("no_cache_history_source"),
        routeAlerts: {
          state: "available",
          reason: null,
          source: { kind: "route_alert_ledger", provider: "ga4" },
          retrievedAt: "2026-10-16T00:00:00.000Z",
          window: null,
          caveats: [],
          data: { alerts: [] },
        },
        proposals: {
          state: "available",
          reason: null,
          source: { kind: "retained_ledger", provider: null },
          retrievedAt: "2026-10-16T00:00:00.000Z",
          window: null,
          caveats: [],
          data: {
            proposals: [
              {
                id: "proposal-1",
                version: 2,
                payloadDigest: "digest",
                decisionState: "current",
                intent: "Improve the page title",
                expectedOutcome: "More qualified search visits",
                risk: "low",
                verificationPlan: "Compare retained GSC evidence.",
                changes: [{ field: "title", before: "Old", after: "New" }],
                caveats: [],
              },
            ],
          },
        },
      },
    })

    expect(result?.rankings.data).toMatchObject({
      clicks: 0,
      impressions: 10,
      averagePosition: 4,
    })
    expect(result?.viewing.state).toBe("not_connected")
    expect(result?.viewing.data).toBeNull()
    expect(result?.aiTraffic.data).toBeNull()
    expect(result?.opportunities.data?.items[0]).toMatchObject({
      proposalId: "proposal-1",
      version: 2,
      payloadDigest: "digest",
      decisionState: "current",
    })
  })

  it("rejects an unknown wire contract version", () => {
    expect(adaptWatchSeoReadModel({ version: "future" })).toBeNull()
  })
})
