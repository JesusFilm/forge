import { afterEach, describe, expect, it, vi } from "vitest"

import type { FirecrawlConfig } from "../../config/env"
import {
  InstagramDiscoveryArtifactError,
  type InstagramDiscoveryArtifactStore,
} from "../../services/instagram-discovery/artifacts"
import type {
  DiscoveryReport,
  InstagramPost,
} from "../../services/instagram-discovery/types"
import {
  handleInstagramDiscoveryRouteRequest,
  InstagramDiscoveryWorkflowInputSchema,
  InstagramDiscoverySearchError,
  instagramAiChristianDiscoveryWorkflow,
  runInstagramDiscovery,
  type InstagramDiscoveryWorkflowResult,
} from "./instagram-ai-christian-discovery"
import { MAX_DISCOVERY_TEXT_LENGTH } from "../../services/instagram-discovery/types"

class TestWorkflowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TestWorkflowError"
  }
}

function expectSuccess(
  result: InstagramDiscoveryWorkflowResult,
): asserts result is Extract<InstagramDiscoveryWorkflowResult, { ok: true }> {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new TestWorkflowError("expected success")
}

const CONFIG: FirecrawlConfig = {
  apiKey: "fc-key",
  apiUrl: "https://api.firecrawl.dev",
  timeoutMs: 60_000,
  userAgent: "forge-test-firecrawl/1.0",
  maxSearchResults: 10,
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
      throw new TestWorkflowError("not used")
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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
      queries: [
        "AI generated Jesus video site:instagram.com",
        "AI generated Christian reel site:instagram.com",
      ],
      limitPerQuery: 5,
      scrapeMetadata: true,
      maxResults: 50,
      persistArtifact: true,
    })
  })
})

describe("runInstagramDiscovery", () => {
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

    expectSuccess(result)
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
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const submitPosts = vi.fn(async (_posts: InstagramPost[]) => ({
      ok: true,
      inserted: 0,
      skipped: 1,
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

    expectSuccess(result)
    expect(submitPosts).toHaveBeenCalledTimes(1)
    const submitted = submitPosts.mock.calls[0]![0]
    expect(submitted).toHaveLength(1)
    expect(submitted[0]!.shortcode).toBe("ABC123")
    expect(result.siteIngest).toEqual({
      runId: "run-submit",
      inserted: 0,
      skipped: 1,
    })
    expect(log).toHaveBeenCalledWith(
      "[instagram-discovery] event=site_ingest runId=run-submit inserted=0 skipped=1",
    )
  })

  it("preserves Firecrawl og:image through the real adapter and submitted post", async () => {
    const thumbnailUrl = "https://cdn.example.com/instagram-thumbnail.jpg"
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              web: [
                {
                  url: "https://www.instagram.com/reel/THUMB123/",
                  description: "AI generated film of Jesus #aiart #faith",
                  metadata: {
                    "og:image": thumbnailUrl,
                    ignored: "not forwarded across the workflow boundary",
                  },
                },
              ],
            },
            creditsUsed: 1,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    )
    vi.stubGlobal("fetch", fetchImpl)
    vi.spyOn(console, "log").mockImplementation(() => {})
    const submitPosts = vi.fn(async (_posts: InstagramPost[]) => ({
      ok: true,
      inserted: 1,
      skipped: 0,
    }))

    const result = await runInstagramDiscovery(
      { queries: ["q"], persistArtifact: false },
      {
        runId: "run-real-adapter",
        firecrawlConfig: CONFIG,
        artifactStore: fakeStore(),
        submitPosts,
      },
    )

    expectSuccess(result)
    expect(result.posts[0]!.thumbnailUrl).toBe(thumbnailUrl)
    expect(submitPosts).toHaveBeenCalledWith([
      expect.objectContaining({
        shortcode: "THUMB123",
        thumbnailUrl,
      }),
    ])
    expect(result.siteIngest).toEqual({
      runId: "run-real-adapter",
      inserted: 1,
      skipped: 0,
    })
    const requestBody = JSON.parse(
      String(fetchImpl.mock.calls[0]![1]!.body),
    ) as { scrapeOptions?: unknown }
    expect(requestBody.scrapeOptions).toEqual({
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: 60_000,
    })
  })

  it("reports zero ingest counts without submitting an empty candidate set", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const submitPosts = vi.fn()

    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-empty-submit",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiOnlyHit],
        artifactStore: fakeStore(),
        submitPosts,
      },
    )

    expectSuccess(result)
    expect(submitPosts).not.toHaveBeenCalled()
    expect(result.siteIngest).toEqual({
      runId: "run-empty-submit",
      inserted: 0,
      skipped: 0,
    })
    expect(log).toHaveBeenCalledWith(
      "[instagram-discovery] event=site_ingest runId=run-empty-submit inserted=0 skipped=0",
    )
  })

  it("does not submit when site ingest is explicitly disabled", async () => {
    const submitPosts = vi.fn()
    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-nosubmit",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiChristianHit],
        artifactStore: fakeStore(),
        siteIngest: null,
        submitPosts,
      },
    )

    expectSuccess(result)
    expect(submitPosts).not.toHaveBeenCalled()
    expect(result.siteIngest).toBeNull()
  })

  it("keeps discovery successful when site submission fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    const submitPosts = vi.fn(async () => {
      throw new TestWorkflowError("site down")
    })
    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-submit-failed",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiChristianHit],
        artifactStore: fakeStore(),
        submitPosts,
      },
    )

    expectSuccess(result)
    expect(result.posts).toHaveLength(1)
    expect(result.siteIngest).toBeNull()
    expect(errorLog).toHaveBeenCalledWith(
      "[instagram-discovery] event=site_ingest_failed runId=run-submit-failed message=site down",
    )
  })

  it("does not report counts from an unsuccessful injected submission", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-submit-unsuccessful",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiChristianHit],
        artifactStore: fakeStore(),
        submitPosts: async () => ({ ok: false, inserted: 0, skipped: 0 }),
      },
    )

    expectSuccess(result)
    expect(result.siteIngest).toBeNull()
    expect(errorLog).toHaveBeenCalledWith(
      "[instagram-discovery] event=site_ingest_failed runId=run-submit-unsuccessful message=site ingest returned an unsuccessful result",
    )
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

    expectSuccess(result)
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

    expectSuccess(result)
    expect(result.artifactPath).toBeUndefined()
    expect(store.written).toHaveLength(0)
  })

  it("returns artifact_failed when report persistence fails", async () => {
    const store = fakeStore()
    store.writeReport = async () => {
      throw new InstagramDiscoveryArtifactError("write_failed", "disk full")
    }

    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-artifact-failed",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiChristianHit],
        artifactStore: store,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "artifact_failed",
      retryable: true,
    })
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

  it("rejects queries that exceed the artifact text bound before search", async () => {
    const searchQuery = vi.fn()
    const result = await runInstagramDiscovery(
      { queries: ["q".repeat(MAX_DISCOVERY_TEXT_LENGTH + 1)] },
      {
        runId: "run-long-query",
        firecrawlConfig: CONFIG,
        searchQuery: searchQuery as never,
        artifactStore: fakeStore(),
      },
    )

    expect(result).toMatchObject({ ok: false, reason: "invalid_input" })
    expect(searchQuery).not.toHaveBeenCalled()
  })

  it("accepts queries at the artifact text bound", async () => {
    const store = fakeStore()
    const query = "q".repeat(MAX_DISCOVERY_TEXT_LENGTH)
    const result = await runInstagramDiscovery(
      { queries: [query] },
      {
        runId: "run-max-query",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [aiChristianHit],
        artifactStore: store,
      },
    )

    expectSuccess(result)
    expect(store.written[0]!.queries[0]).toBe(query)
  })

  it("returns all_queries_failed when every query errors", async () => {
    const result = await runInstagramDiscovery(
      { queries: ["a", "b"] },
      {
        runId: "run-5",
        firecrawlConfig: CONFIG,
        searchQuery: async () => {
          throw new InstagramDiscoverySearchError("network_error", "boom", true)
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
      if (query === "bad") {
        throw new InstagramDiscoverySearchError("auth_failed", "no")
      }
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

    expectSuccess(result)
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
        searchQuery: async () => [aiChristianHit, secondHit, commentaryHit],
        artifactStore: store,
      },
    )

    expectSuccess(result)
    expect(result.posts).toHaveLength(1)
    expect(result.totals.deduped).toBe(3)
    expect(result.totals.excludedCommentary).toBe(1)
    expect(result.totals.qualified).toBe(1)
  })

  it("merges duplicate shortcode variants before classification", async () => {
    const store = fakeStore()
    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-duplicate-merge",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [
          {
            url: "https://www.instagram.com/reel/DUPLICATE/",
            description: "Beautiful sunset over the hills",
          },
          {
            url: "https://www.instagram.com/reel/DUPLICATE/",
            description: "AI generated film of Jesus #aiart #faith",
          },
        ],
        artifactStore: store,
      },
    )

    expectSuccess(result)
    expect(result.posts).toHaveLength(1)
    expect(result.posts[0]!.matchedAi).toContain("ai generated")
    expect(result.posts[0]!.matchedChristian).toContain("jesus")
    expect(result.totals).toMatchObject({
      candidates: 2,
      deduped: 1,
      qualified: 1,
    })
  })

  it("bounds hydrated markdown before selecting and persisting posts", async () => {
    const store = fakeStore()
    const result = await runInstagramDiscovery(
      { queries: ["q"], scrapeMetadata: true },
      {
        runId: "run-bounded-markdown",
        firecrawlConfig: CONFIG,
        searchQuery: async () => [
          {
            url: "https://www.instagram.com/reel/LONGMD/",
            markdown: `AI generated Jesus ${"x".repeat(MAX_DISCOVERY_TEXT_LENGTH + 500)}`,
          },
        ],
        artifactStore: store,
      },
    )

    expectSuccess(result)
    expect(result.posts[0]!.caption).toHaveLength(MAX_DISCOVERY_TEXT_LENGTH)
    expect(store.written[0]!.posts[0]!.caption).toHaveLength(
      MAX_DISCOVERY_TEXT_LENGTH,
    )
  })

  it.each([0, 21])(
    "returns invalid_input for out-of-range limitPerQuery %i",
    async (limitPerQuery) => {
      const result = await runInstagramDiscovery(
        { queries: ["q"], limitPerQuery },
        {
          runId: `run-limit-${limitPerQuery}`,
          firecrawlConfig: CONFIG,
          artifactStore: fakeStore(),
        },
      )
      expect(result).toMatchObject({ ok: false, reason: "invalid_input" })
    },
  )

  it("uses the shared Firecrawl default cap as the default query limit", async () => {
    const searchQuery = vi.fn(async () => [aiChristianHit])
    const result = await runInstagramDiscovery(
      { queries: ["q"] },
      {
        runId: "run-default-limit",
        firecrawlConfig: CONFIG,
        searchQuery,
        artifactStore: fakeStore(),
      },
    )

    expectSuccess(result)
    expect(searchQuery).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({ includeMarkdown: true, limit: 5 }),
    )
  })

  it("allows operators to opt out of Firecrawl result hydration", async () => {
    const searchQuery = vi.fn(async () => [aiChristianHit])
    const result = await runInstagramDiscovery(
      { queries: ["q"], scrapeMetadata: false },
      {
        runId: "run-no-hydration",
        firecrawlConfig: CONFIG,
        searchQuery,
        artifactStore: fakeStore(),
      },
    )

    expectSuccess(result)
    expect(searchQuery).toHaveBeenCalledWith(
      "q",
      expect.objectContaining({ includeMarkdown: false }),
    )
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
    siteIngest: null,
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
        throw new TestWorkflowError("bad json")
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

  it("maps artifact_failed to 500", async () => {
    const outcome = await handleInstagramDiscoveryRouteRequest({
      authHeader: "Bearer right",
      serviceKeys: ["right"],
      readJson: async () => ({}),
      launch: async () => ({
        ok: false,
        reason: "artifact_failed",
        retryable: true,
        mastraRunId: "r",
      }),
    })
    expect(outcome.status).toBe(500)
  })

  it("maps launch rejections to a typed failure response", async () => {
    const outcome = await handleInstagramDiscoveryRouteRequest({
      authHeader: "Bearer right",
      serviceKeys: ["right"],
      readJson: async () => ({}),
      launch: async () => {
        throw new TestWorkflowError("storage unavailable")
      },
    })

    expect(outcome.status).toBe(502)
    expect(outcome.body.result).toMatchObject({
      ok: false,
      reason: "all_queries_failed",
      retryable: true,
      details: "storage unavailable",
    })
  })
})
