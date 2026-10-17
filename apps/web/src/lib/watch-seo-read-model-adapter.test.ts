import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/content", () => ({
  resolveWatchPage: vi.fn(),
  experienceToMetadata: vi.fn(),
}))

import { resolveWatchPage } from "./content"
import {
  generateWatchVideoMetadata,
  getWatchPageMetadata,
} from "./experience-metadata"

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

function readModel() {
  return {
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
  }
}

describe("adaptWatchSeoReadModel", () => {
  it("turns retained Admin evidence into the presentation contract without inventing absent metrics", () => {
    const result = adaptWatchSeoReadModel(readModel())

    expect(result?.rankings).toMatchObject({
      state: "unavailable",
      data: null,
      window: null,
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

  it.each(["current", "expired", "stale", "decided", "materialized"])(
    "never copies query-bearing proposal prose to Watch (%s)",
    (decisionState) => {
      const wire = readModel()
      const query = "private query about personal grief"
      Object.assign(wire.sections.proposals, { caveats: [query] })
      Object.assign(wire.sections.proposals.data.proposals[0], {
        decisionState,
        intent: query,
        verificationPlan: query,
        expectedOutcome: query,
        risk: query,
        changes: [{ field: query, before: query, after: query }],
        caveats: [query],
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-02T00:00:00.000Z",
      })
      const result = adaptWatchSeoReadModel(wire)
      expect(result).not.toBeNull()
      expect(JSON.stringify(result)).not.toContain(query)
      expect(result?.opportunities.data?.items[0]).toMatchObject({
        proposalId: "proposal-1",
        version: 2,
        payloadDigest: "digest",
        decisionState: ["decided", "materialized"].includes(decisionState)
          ? "already_decided"
          : decisionState,
      })
      // Projection does not rewrite the Admin record.
      expect(wire.sections.proposals.data.proposals[0].intent).toBe(query)
    },
  )

  it("does not invent daily averages or sum repeated queries across unequal rolling-window impressions", () => {
    const wire = readModel()
    wire.sections.search.data.queries = [
      {
        clicks: 1,
        impressions: 10,
        position: 2,
        observedAt: "2026-10-14T00:00:00Z",
      },
      {
        clicks: 90,
        impressions: 1000,
        position: 20,
        observedAt: "2026-10-15T00:00:00Z",
      },
      {
        clicks: 90,
        impressions: 1000,
        position: 20,
        observedAt: "2026-10-15T00:00:00Z",
      },
    ].map((row) => ({ ...row, query: "repeated query" }))
    const result = adaptWatchSeoReadModel(wire)
    expect(result?.rankings.data).toBeNull()
    expect(result?.rankings.state).toBe("unavailable")
    expect(result?.rankings.window).toBeNull()
    expect(result?.rankings.note).toContain("overlapping windows")
    expect(JSON.stringify(result)).not.toContain("repeated query")
  })

  it.each([undefined, null, "direct_http", "rendered"] as const)(
    "preserves only explicitly stored crawler rendering mode (%s)",
    (renderingMode) => {
      const wire = readModel()
      Object.assign(wire.sections.crawl.data, { renderingMode })
      expect(adaptWatchSeoReadModel(wire)?.crawler.data?.renderingMode).toBe(
        renderingMode ?? null,
      )
    },
  )

  it.each([
    {
      searchTitle: "  Approved title  ",
      searchDescription: "  Approved description  ",
    },
    { searchTitle: "   ", searchDescription: "   " },
    { searchTitle: null, searchDescription: null },
  ])(
    "matches actual Watch social/chat text and canonical rules (%j)",
    async (overrides) => {
      const wire = readModel()
      Object.assign(wire.sections.pageMetadata.data, overrides)
      const page = wire.sections.pageMetadata.data
      vi.mocked(resolveWatchPage).mockResolvedValue({
        data: {
          kind: "video-template",
          routeVideo: { ...page, snippet: "Snippet", imageUrl: null },
        },
      } as unknown as Awaited<ReturnType<typeof resolveWatchPage>>)
      const actual = await getWatchPageMetadata("en", {
        slug: "jesus",
        pathLocale: "english",
      })
      const preview = adaptWatchSeoReadModel(wire)?.previews
      expect(preview?.state).toBe("partial")
      expect(preview?.data).toMatchObject({
        title: actual.openGraph?.title,
        description: actual.openGraph?.description,
        canonicalUrl: actual.alternates?.canonical,
        imageUrl: null,
        imageAlt: null,
      })
      expect(actual.twitter).toMatchObject({
        title: preview?.data?.title,
        description: preview?.data?.description,
      })
      const videoMetadata = generateWatchVideoMetadata("en", {
        video: { ...page, slug: "jesus", subtitles: [] },
        selectedVariant: {},
        routeSlug: "jesus",
        pathLocale: "english",
      } as unknown as Parameters<typeof generateWatchVideoMetadata>[1])
      expect(videoMetadata.openGraph).toMatchObject({
        title: preview?.data?.title,
        description: preview?.data?.description,
        url: preview?.data?.canonicalUrl,
      })
    },
  )

  it("labels missing snippet and social-image inputs unavailable instead of inventing the real fallback", async () => {
    const wire = readModel()
    Object.assign(wire.sections.pageMetadata.data, {
      searchDescription: null,
      description: null,
      hasSocialImage: false,
      socialImageUrl: "https://media.example/image.jpg?token=secret",
    })
    vi.mocked(resolveWatchPage).mockResolvedValue({
      data: {
        kind: "video-template",
        routeVideo: {
          ...wire.sections.pageMetadata.data,
          snippet: "Real snippet",
          imageUrl: null,
        },
      },
    } as unknown as Awaited<ReturnType<typeof resolveWatchPage>>)
    const actual = await getWatchPageMetadata("en", {
      slug: "jesus",
      pathLocale: "english",
    })
    expect(actual.openGraph?.description).toBe("Real snippet")
    expect(actual.openGraph?.images).toBeTruthy()
    const preview = adaptWatchSeoReadModel(wire)?.previews
    expect(preview?.data?.description).toBeNull()
    expect(preview?.data?.imageUrl).toBeNull()
    expect(preview?.note).toContain("unavailable")
    expect(JSON.stringify(preview)).not.toContain("secret")
  })

  it("keeps stale metadata provenance while marking absent preview fields unavailable", () => {
    const wire = readModel()
    wire.sections.pageMetadata.state = "stale"
    expect(adaptWatchSeoReadModel(wire)?.previews.state).toBe("stale")
  })
})
