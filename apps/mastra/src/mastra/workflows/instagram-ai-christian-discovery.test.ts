import { describe, expect, it, vi } from "vitest"

import type { FirecrawlConfig } from "../../config/env"
import { FirecrawlSearchError } from "../../services/firecrawl-search-client"
import type { InstagramDiscoveryArtifactStore } from "../../services/instagram-discovery/artifacts"
import type {
  DiscoveryReport,
  InstagramPost,
} from "../../services/instagram-discovery/types"
import {
  _internals,
  handleInstagramDiscoveryRouteRequest,
  InstagramDiscoveryWorkflowInputSchema,
  instagramAiChristianDiscoveryWorkflow,
  runInstagramDiscovery,
  type InstagramDiscoveryWorkflowResult,
} from "./instagram-ai-christian-discovery"

const CONFIG: FirecrawlConfig = {
  apiKey: "fc-key",
  apiUrl: "https://api.firecrawl.dev",
  timeoutMs: 60_000,
  userAgent: "forge-mastra-firecrawl/1.0",
  maxSearchResults: 5,
  maxMarkdownCharacters: 16_000,
}

function fakeStore(): InstagramDiscoveryArtifactStore & {
  written: DiscoveryReport[]
} {
  const written: DiscoveryReport[] = []
  return {
    rootDir: "/tmp/fake",
    written,
    async writeReport(report) {
      written.push(report)
      return { path: `/tmp/fake/reports/${report.reportId}.json` }
    },
    async readReport() {
      throw new Error("not used")
    },
  }
}

const aiChristianHit = {
  url: "https://www.instagram.com/reel/ABC123/",
  title: "Grace Films (@grace.films) • Instagram",
  description: "AI generated film of Jesus #aiart #faith",
}
const aiOnlyHit = {
  url: "https://www.instagram.com/p/XYZ999/",
  description: "Made with Midjourney, neon city",
}
const nonInstagramHit = { url: "https://youtube.com/watch?v=1" }
const commentaryHit = {
  url: "https://www.instagram.com/reel/COMMENT1/",
  description:
    "Should we be listening to AI generated Christian music? Here's my thoughts",
}

// A genuine post from a trusted account that mentions Jesus but not "AI" — it
// would fail the keyword filter but should be kept when the account is trusted.
const christianOnlyHit = {
  url: "https://www.instagram.com/reel/TRUST1/",
  title: "biblewithlife • Instagram",
  description: "The parable of the lost sheep, retold #faith #jesus",
}

describe("runInstagramDiscovery — trusted handles", () => {
  it("scopes each handle to an account search and trusts the results", async () => {
    const searchQuery = vi.fn(async (query: string) =>
      query.includes("site:instagram.com/biblewithlife")
        ? [christianOnlyHit]
        : [],
    )
    const result = await runInstagramDiscovery(
      { handles: ["biblewithlife"], queries: [] },
      {
        runId: "run-handle",
        firecrawlConfig: CONFIG,
        searchQuery,
        artifactStore: fakeStore(),
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    // kept despite having no AI keyword (trusted account)
    expect(result.posts).toHaveLength(1)
    expect(result.posts[0]!.shortcode).toBe("TRUST1")
    // the search was scoped to the account
    expect(searchQuery.mock.calls[0]![0]).toBe(
      "site:instagram.com/biblewithlife",
    )
  })

  it("does NOT keep the same non-AI post when it comes from keyword search", async () => {
    const result = await runInstagramDiscovery(
      { handles: [], queries: ["q"] },
      {
        runId: "run-search-strict",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [christianOnlyHit],
        artifactStore: fakeStore(),
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.posts).toHaveLength(0)
  })

  it("merges saved handles from the sources endpoint", async () => {
    const searchQuery = vi.fn(async (_query: string) => [christianOnlyHit])
    const sourcesJson = new Response(
      JSON.stringify({ sources: [{ value: "savedhandle", label: "Saved" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
    const result = await runInstagramDiscovery(
      { handles: [], queries: [] },
      {
        runId: "run-saved-ig",
        firecrawlConfig: CONFIG,
        searchQuery,
        artifactStore: fakeStore(),
        sourcesConfig: {
          url: "https://site.test/api/discovery-sources",
          token: "t",
        },
        fetchSources: (async () => sourcesJson) as unknown as typeof fetch,
      },
    )
    expect(result.ok).toBe(true)
    expect(searchQuery.mock.calls[0]![0]).toBe("site:instagram.com/savedhandle")
  })

  it("resolves saved handles before the registered Studio search step", async () => {
    const loaded = await _internals.withSavedInstagramSources(
      InstagramDiscoveryWorkflowInputSchema.parse({}),
      {
        config: {
          url: "https://site.test/api/discovery-sources",
          token: "t",
        },
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              sources: [{ value: "savedhandle", label: "Saved" }],
            }),
            { headers: { "content-type": "application/json" } },
          )) as unknown as typeof fetch,
      },
    )

    expect(loaded).toMatchObject({
      input: { handles: ["savedhandle"] },
      sourceLoadStatus: "loaded",
    })
  })

  it("reports a saved-source outage when no handles or queries can run", async () => {
    const result = await runInstagramDiscovery(
      { handles: [], queries: [] },
      {
        runId: "run-sources-failed",
        firecrawlConfig: CONFIG,
        artifactStore: fakeStore(),
        sourcesConfig: {
          url: "https://site.test/api/discovery-sources",
          token: "t",
        },
        fetchSources: (async () =>
          new Response("down", { status: 500 })) as unknown as typeof fetch,
      },
    )
    expect(result).toMatchObject({
      ok: false,
      reason: "sources_unavailable",
      retryable: true,
    })
  })

  it("still drops commentary from a trusted handle", async () => {
    const result = await runInstagramDiscovery(
      { handles: ["someone"], queries: [] },
      {
        runId: "run-handle-comment",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [commentaryHit],
        artifactStore: fakeStore(),
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.posts).toHaveLength(0)
    expect(result.totals.excludedCommentary).toBe(1)
  })
})

describe("instagramAiChristianDiscoveryWorkflow schedule", () => {
  it("runs once a day at midnight UTC on the evented engine", () => {
    expect(instagramAiChristianDiscoveryWorkflow.engineType).toBe("evented")

    const schedules = (
      instagramAiChristianDiscoveryWorkflow as typeof instagramAiChristianDiscoveryWorkflow & {
        getScheduleConfigs: () => Array<{
          cron: string
          timezone?: string
          inputData?: unknown
        }>
      }
    ).getScheduleConfigs()

    expect(schedules).toHaveLength(1)
    expect(schedules[0]).toMatchObject({
      cron: "0 0 * * *",
      timezone: "UTC",
    })
    expect(schedules[0]).not.toHaveProperty("id")
    expect(schedules[0]).not.toHaveProperty("inputData")
  })

  it("resolves empty scheduled input through the existing workflow defaults", () => {
    expect(InstagramDiscoveryWorkflowInputSchema.parse({})).toEqual({
      handles: [],
      queries: [],
      limitPerQuery: 10,
      scrapeMetadata: false,
      maxResults: 10,
      persistArtifact: true,
    })
  })
})

describe("runInstagramDiscovery", () => {
  it("honors Firecrawl result and markdown caps", async () => {
    const searchQuery = vi.fn(async () => [])
    await runInstagramDiscovery(
      { queries: ["q"], limitPerQuery: 50 },
      {
        runId: "run-firecrawl-caps",
        firecrawlConfig: CONFIG,
        searchQuery,
        artifactStore: fakeStore(),
      },
    )

    expect(searchQuery).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({
        limit: 5,
        maxMarkdownCharacters: 16_000,
      }),
    )
  })

  it("returns only qualifying posts and writes an artifact", async () => {
    const store = fakeStore()
    const searchQuery = vi.fn(async () => [
      aiChristianHit,
      aiOnlyHit,
      nonInstagramHit,
    ])

    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-1",
        firecrawlConfig: CONFIG,
        searchQuery,
        artifactStore: store,
        now: () => new Date("2026-06-08T00:00:00Z"),
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.posts).toHaveLength(1)
    expect(result.posts[0]!.shortcode).toBe("ABC123")
    expect(result.posts[0]!.matchedChristian).toContain("jesus")
    expect(result.totals).toEqual({
      candidates: 3,
      instagram: 2,
      deduped: 2,
      excludedCommentary: 0,
      qualified: 1,
    })
    expect(result.artifactPath).toBe("/tmp/fake/reports/run-1.json")
    expect(store.written).toHaveLength(1)
  })

  it("submits only qualified posts to the site review queue", async () => {
    const submitPosts = vi.fn(async (_posts: InstagramPost[]) => ({
      ok: true,
      inserted: 1,
      skipped: 0,
    }))
    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-submit",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiChristianHit, aiOnlyHit, nonInstagramHit],
        artifactStore: fakeStore(),
        submitPosts,
      },
    )

    expect(result.ok).toBe(true)
    expect(submitPosts).toHaveBeenCalledTimes(1)
    const submitted = submitPosts.mock.calls[0]![0]
    expect(submitted).toHaveLength(1)
    expect(submitted[0]!.shortcode).toBe("ABC123")
    if (!result.ok) throw new Error("expected success")
    expect(result.reviewQueue).toEqual({
      status: "submitted",
      inserted: 1,
      skipped: 0,
    })
  })

  it("does not submit when the site is not configured", async () => {
    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-nosubmit",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiChristianHit],
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.reviewQueue).toEqual({ status: "not_configured" })
  })

  it("records a review-queue failure without discarding discovery results", async () => {
    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-submit-failure",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiChristianHit],
        artifactStore: fakeStore(),
        submitPosts: async () => {
          throw new Error("site offline")
        },
      },
    )
    expect(result).toMatchObject({
      ok: true,
      reviewQueue: { status: "failed", reason: "upstream_failed" },
    })
  })

  it("excludes commentary posts and counts them", async () => {
    const store = fakeStore()
    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-comment",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiChristianHit, commentaryHit],
        artifactStore: store,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.posts).toHaveLength(1)
    expect(result.posts[0]!.shortcode).toBe("ABC123")
    expect(result.posts.some((p) => p.shortcode === "COMMENT1")).toBe(false)
    expect(result.totals.excludedCommentary).toBe(1)
    expect(result.totals.qualified).toBe(1)
  })

  it("dedupes the same shortcode across queries", async () => {
    const store = fakeStore()
    const searchQuery = vi.fn(async (query: string) =>
      query === "a" ? [aiChristianHit] : [aiChristianHit],
    )

    const result = await runInstagramDiscovery(
      { queries: ["a", "b"] },
      {
        runId: "run-2",
        firecrawlConfig: CONFIG,
        searchQuery,
        artifactStore: store,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.posts).toHaveLength(1)
    expect(result.totals.candidates).toBe(2)
    expect(result.totals.deduped).toBe(1)
  })

  it("does not persist an artifact when persistArtifact is false", async () => {
    const store = fakeStore()
    const result = await runInstagramDiscovery(
      { queries: ["q"], persistArtifact: false },
      {
        runId: "run-3",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiChristianHit],
        artifactStore: store,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.artifactPath).toBeUndefined()
    expect(store.written).toHaveLength(0)
  })

  it("returns config_missing when no Firecrawl key is configured", async () => {
    const searchQuery = vi.fn()
    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-4",
        firecrawlConfig: { ...CONFIG, apiKey: undefined },
        searchQuery: searchQuery as never,
        artifactStore: fakeStore(),
      },
    )

    expect(result).toMatchObject({ ok: false, reason: "config_missing" })
    expect(searchQuery).not.toHaveBeenCalled()
  })

  it("returns all_queries_failed when every query errors", async () => {
    const result = await runInstagramDiscovery(
      { queries: ["a", "b"] },
      {
        runId: "run-5",
        firecrawlConfig: CONFIG,
        searchQuery: async () => {
          throw new FirecrawlSearchError("upstream_failed", "boom", true)
        },
        artifactStore: fakeStore(),
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "all_queries_failed",
      retryable: true,
    })
  })

  it("succeeds with partial query failures", async () => {
    const store = fakeStore()
    const searchQuery = vi.fn(async (query: string) => {
      if (query === "bad") throw new FirecrawlSearchError("auth_failed", "no")
      return [aiChristianHit]
    })

    const result = await runInstagramDiscovery(
      { queries: ["bad", "good"] },
      {
        runId: "run-6",
        firecrawlConfig: CONFIG,
        searchQuery,
        artifactStore: store,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.queryFailures).toHaveLength(1)
    expect(result.queryFailures[0]!.code).toBe("auth_failed")
    expect(result.posts).toHaveLength(1)
  })

  it("caps the result set at maxResults", async () => {
    const store = fakeStore()
    const secondHit = {
      url: "https://www.instagram.com/reel/SECOND/",
      description: "AI generated film of Christ #aiart #gospel",
    }
    const result = await runInstagramDiscovery(
      { queries: ["q"], maxResults: 1 },
      {
        runId: "run-cap",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiChristianHit, secondHit],
        artifactStore: store,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.posts).toHaveLength(1)
    expect(result.totals.deduped).toBe(2)
    expect(result.totals.qualified).toBe(1)
  })

  it("returns invalid_input for an out-of-range limit", async () => {
    const result = await runInstagramDiscovery(
      { queries: ["q"], limitPerQuery: 0 },
      { runId: "run-7", firecrawlConfig: CONFIG, artifactStore: fakeStore() },
    )
    expect(result).toMatchObject({ ok: false, reason: "invalid_input" })
  })
})

describe("handleInstagramDiscoveryRouteRequest", () => {
  const okResult: InstagramDiscoveryWorkflowResult = {
    ok: true,
    mastraRunId: "r",
    totals: {
      candidates: 0,
      instagram: 0,
      deduped: 0,
      excludedCommentary: 0,
      qualified: 0,
    },
    posts: [],
    queryFailures: [],
    reviewQueue: { status: "empty" },
  }

  it("rejects requests without a valid bearer", async () => {
    const launch = vi.fn()
    const outcome = await handleInstagramDiscoveryRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["right"],
      readJson: async () => ({}),
      launch: launch as never,
    })
    expect(outcome.status).toBe(401)
    expect(launch).not.toHaveBeenCalled()
  })

  it("launches the workflow for a valid bearer", async () => {
    const outcome = await handleInstagramDiscoveryRouteRequest({
      authHeader: "Bearer right",
      serviceKeys: ["right"],
      readJson: async () => ({ queries: ["q"] }),
      launch: async () => okResult,
    })
    expect(outcome.status).toBe(200)
    expect(outcome.body.result).toEqual(okResult)
  })

  it("maps a JSON parse failure to invalid_input (400)", async () => {
    const launch = vi.fn()
    const outcome = await handleInstagramDiscoveryRouteRequest({
      authHeader: "Bearer right",
      serviceKeys: ["right"],
      readJson: async () => {
        throw new Error("bad json")
      },
      launch: launch as never,
    })
    expect(outcome.status).toBe(400)
    expect(outcome.body.result).toMatchObject({ reason: "invalid_input" })
    expect(launch).not.toHaveBeenCalled()
  })

  it("maps config_missing to 503", async () => {
    const outcome = await handleInstagramDiscoveryRouteRequest({
      authHeader: "Bearer right",
      serviceKeys: ["right"],
      readJson: async () => ({}),
      launch: async () => ({
        ok: false,
        reason: "config_missing",
        retryable: false,
        mastraRunId: "r",
      }),
    })
    expect(outcome.status).toBe(503)
  })

  it("maps all_queries_failed to 502", async () => {
    const outcome = await handleInstagramDiscoveryRouteRequest({
      authHeader: "Bearer right",
      serviceKeys: ["right"],
      readJson: async () => ({}),
      launch: async () => ({
        ok: false,
        reason: "all_queries_failed",
        retryable: true,
        mastraRunId: "r",
      }),
    })
    expect(outcome.status).toBe(502)
  })
})
