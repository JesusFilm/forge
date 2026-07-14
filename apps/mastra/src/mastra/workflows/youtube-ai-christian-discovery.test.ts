import { describe, expect, it, vi } from "vitest"

import type { YouTubeConfig } from "../../config/env"
import type { DiscoveredVideo } from "../../services/discovery/candidate"
import type { YouTubeDiscoveryArtifactStore } from "../../services/youtube-discovery/artifacts"
import type {
  YouTubeDiscoveryReport,
  YouTubeRawItem,
} from "../../services/youtube-discovery/types"
import { YouTubeSearchError } from "../../services/youtube-search-client"
import {
  handleYouTubeDiscoveryRouteRequest,
  runYouTubeDiscovery,
  youtubeAiChristianDiscoveryWorkflow,
  type YouTubeClient,
  type YouTubeDiscoveryWorkflowResult,
} from "./youtube-ai-christian-discovery"

const CONFIG: YouTubeConfig = {
  apiKey: "yt-key",
  baseUrl: "https://www.googleapis.com/youtube/v3",
  timeoutMs: 30_000,
}

function fakeStore(): YouTubeDiscoveryArtifactStore & {
  written: YouTubeDiscoveryReport[]
} {
  const written: YouTubeDiscoveryReport[] = []
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

function videoItem(
  id: string,
  title: string,
  description = "",
): YouTubeRawItem {
  return {
    id: { videoId: id },
    snippet: {
      title,
      description,
      channelId: "UC_grace",
      channelTitle: "Grace Films",
      publishedAt: "2026-06-01T00:00:00Z",
    },
  }
}

const aiChristian = videoItem(
  "vid-good",
  "AI generated film of Jesus walking on water #aiart #faith",
)
const aiOnly = videoItem("vid-ai", "Made with Midjourney, neon city")
const commentary = videoItem(
  "vid-comment",
  "Should we be listening to AI generated Christian music? My thoughts",
)

function clientFor(
  searchResult: YouTubeRawItem[],
  overrides: Partial<YouTubeClient> = {},
): YouTubeClient {
  return {
    searchVideos: vi.fn(async () => searchResult),
    resolveUploadsPlaylist: vi.fn(async () => "UU_grace"),
    listPlaylistVideos: vi.fn(async () => []),
    ...overrides,
  }
}

describe("runYouTubeDiscovery", () => {
  it("returns only qualifying videos and writes an artifact", async () => {
    const store = fakeStore()
    const result = await runYouTubeDiscovery(
      { queries: ["q"], channels: [] },
      {
        runId: "run-1",
        youtubeConfig: CONFIG,
        client: clientFor([aiChristian, aiOnly]),
        artifactStore: store,
        now: () => new Date("2026-06-17T00:00:00Z"),
        siteIngest: null,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.videos).toHaveLength(1)
    expect(result.videos[0]!.videoId).toBe("vid-good")
    expect(result.videos[0]!.matchedChristian).toContain("jesus")
    expect(result.totals).toEqual({
      candidates: 2,
      videos: 2,
      deduped: 2,
      excludedCommentary: 0,
      qualified: 1,
    })
    expect(result.artifactPath).toBe("/tmp/fake/reports/run-1.json")
    expect(store.written).toHaveLength(1)
  })

  it("pulls from trusted channels via the uploads playlist", async () => {
    const listPlaylistVideos = vi.fn(async () => [aiChristian])
    const resolveUploadsPlaylist = vi.fn(async () => "UU_grace")
    const result = await runYouTubeDiscovery(
      { channels: ["@grace"], queries: [] },
      {
        runId: "run-channel",
        youtubeConfig: CONFIG,
        client: clientFor([], { listPlaylistVideos, resolveUploadsPlaylist }),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(resolveUploadsPlaylist).toHaveBeenCalledWith(
      "@grace",
      expect.anything(),
    )
    expect(result.videos).toHaveLength(1)
    expect(result.videos[0]!.videoId).toBe("vid-good")
  })

  it("pulls directly from a playlist id (no channel resolution)", async () => {
    const listPlaylistVideos = vi.fn(async () => [aiChristian])
    const resolveUploadsPlaylist = vi.fn(async () => "UU_x")
    const result = await runYouTubeDiscovery(
      { playlists: ["PLqbible123"], channels: [], queries: [] },
      {
        runId: "run-playlist",
        youtubeConfig: CONFIG,
        client: clientFor([], { listPlaylistVideos, resolveUploadsPlaylist }),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(listPlaylistVideos).toHaveBeenCalledWith(
      "PLqbible123",
      expect.anything(),
    )
    // playlists are pulled directly — no channel resolution call
    expect(resolveUploadsPlaylist).not.toHaveBeenCalled()
    expect(result.videos).toHaveLength(1)
    expect(result.videos[0]!.videoId).toBe("vid-good")
  })

  it("trusts curated sources: keeps a playlist video with no English keywords", async () => {
    // A non-English "Bible animation" title — matches no English AI/Christian
    // keyword, so it would fail keyword search, but a trusted playlist keeps it.
    const nonEnglish = videoItem("ko-1", "예수님의 기적 | 성경애니메이션")

    const fromPlaylist = await runYouTubeDiscovery(
      { playlists: ["PLqbible"], channels: [], queries: [] },
      {
        runId: "run-trust",
        youtubeConfig: CONFIG,
        client: clientFor([], {
          listPlaylistVideos: vi.fn(async () => [nonEnglish]),
        }),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )
    expect(fromPlaylist.ok).toBe(true)
    if (!fromPlaylist.ok) throw new Error("expected success")
    expect(fromPlaylist.videos).toHaveLength(1)
    expect(fromPlaylist.videos[0]!.videoId).toBe("ko-1")

    // The same video via keyword SEARCH is dropped (no AI+Christian signal).
    const fromSearch = await runYouTubeDiscovery(
      { queries: ["q"], channels: [], playlists: [] },
      {
        runId: "run-search",
        youtubeConfig: CONFIG,
        client: clientFor([nonEnglish]),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )
    expect(fromSearch.ok).toBe(true)
    if (!fromSearch.ok) throw new Error("expected success")
    expect(fromSearch.videos).toHaveLength(0)
  })

  it("drops commentary even from a trusted source", async () => {
    const result = await runYouTubeDiscovery(
      { playlists: ["PLx"], channels: [], queries: [] },
      {
        runId: "run-trust-comment",
        youtubeConfig: CONFIG,
        client: clientFor([], {
          listPlaylistVideos: vi.fn(async () => [commentary]),
        }),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.videos).toHaveLength(0)
    expect(result.totals.excludedCommentary).toBe(1)
  })

  it("excludes commentary videos and counts them", async () => {
    const result = await runYouTubeDiscovery(
      { queries: ["q"], channels: [] },
      {
        runId: "run-comment",
        youtubeConfig: CONFIG,
        client: clientFor([aiChristian, commentary]),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.videos).toHaveLength(1)
    expect(result.videos.some((v) => v.videoId === "vid-comment")).toBe(false)
    expect(result.totals.excludedCommentary).toBe(1)
  })

  it("dedupes the same videoId across a channel and a query", async () => {
    const result = await runYouTubeDiscovery(
      { channels: ["@grace"], queries: ["q"] },
      {
        runId: "run-dedupe",
        youtubeConfig: CONFIG,
        client: clientFor([aiChristian], {
          listPlaylistVideos: vi.fn(async () => [aiChristian]),
        }),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.videos).toHaveLength(1)
    expect(result.totals.candidates).toBe(2)
    expect(result.totals.deduped).toBe(1)
  })

  it("submits only qualified videos to the site review queue", async () => {
    const submitVideos = vi.fn(async (_videos: DiscoveredVideo[]) => ({
      ok: true,
      inserted: 1,
      skipped: 0,
    }))
    const result = await runYouTubeDiscovery(
      { queries: ["q"], channels: [] },
      {
        runId: "run-submit",
        youtubeConfig: CONFIG,
        client: clientFor([aiChristian, aiOnly]),
        artifactStore: fakeStore(),
        submitVideos,
      },
    )

    expect(result.ok).toBe(true)
    expect(submitVideos).toHaveBeenCalledTimes(1)
    const submitted = submitVideos.mock.calls[0]![0]
    expect(submitted).toHaveLength(1)
    expect(submitted[0]!.platform).toBe("youtube")
    expect(submitted[0]!.externalId).toBe("vid-good")
    expect(submitted[0]!.authorUrl).toBe(
      "https://www.youtube.com/channel/UC_grace",
    )
    if (!result.ok) throw new Error("expected success")
    expect(result.reviewQueue).toEqual({
      status: "submitted",
      inserted: 1,
      skipped: 0,
    })
  })

  it("does not submit when the site is not configured", async () => {
    const result = await runYouTubeDiscovery(
      { queries: ["q"], channels: [] },
      {
        runId: "run-nosubmit",
        youtubeConfig: CONFIG,
        client: clientFor([aiChristian]),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.reviewQueue).toEqual({ status: "not_configured" })
  })

  it("returns config_missing when no API key is configured", async () => {
    const client = clientFor([aiChristian])
    const result = await runYouTubeDiscovery(
      { queries: ["q"], channels: [] },
      {
        runId: "run-nokey",
        youtubeConfig: { ...CONFIG, apiKey: undefined },
        client,
        artifactStore: fakeStore(),
      },
    )

    expect(result).toMatchObject({ ok: false, reason: "config_missing" })
    expect(client.searchVideos).not.toHaveBeenCalled()
  })

  it("returns all_sources_failed when every source errors", async () => {
    const result = await runYouTubeDiscovery(
      { queries: ["a", "b"], channels: [] },
      {
        runId: "run-allfail",
        youtubeConfig: CONFIG,
        client: clientFor([], {
          searchVideos: vi.fn(async () => {
            throw new YouTubeSearchError("upstream_failed", "boom", true)
          }),
        }),
        artifactStore: fakeStore(),
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "all_sources_failed",
      retryable: true,
    })
  })

  it("succeeds with partial source failures", async () => {
    const searchVideos = vi.fn(async (query: string) => {
      if (query === "bad")
        throw new YouTubeSearchError("auth_failed", "no", false)
      return [aiChristian]
    })
    const result = await runYouTubeDiscovery(
      { queries: ["bad", "good"], channels: [] },
      {
        runId: "run-partial",
        youtubeConfig: CONFIG,
        client: clientFor([], { searchVideos }),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.sourceFailures).toHaveLength(1)
    expect(result.sourceFailures[0]!.code).toBe("auth_failed")
    expect(result.videos).toHaveLength(1)
  })

  it("caps the result set at maxResults while still counting commentary", async () => {
    const second = videoItem(
      "vid-good-2",
      "AI generated film of Christ #aiart #gospel",
    )
    const result = await runYouTubeDiscovery(
      { queries: ["q"], channels: [], maxResults: 1 },
      {
        runId: "run-cap",
        youtubeConfig: CONFIG,
        client: clientFor([aiChristian, second, commentary]),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.videos).toHaveLength(1)
    expect(result.totals.deduped).toBe(3)
    expect(result.totals.qualified).toBe(1)
    expect(result.totals.excludedCommentary).toBe(1)
  })

  it("merges saved sources: a saved playlist value is pulled as a playlist", async () => {
    const listPlaylistVideos = vi.fn(async () => [aiChristian])
    const sourcesJson = new Response(
      JSON.stringify({
        sources: [
          {
            value: "https://www.youtube.com/playlist?list=PLsaved123456",
            label: "QBIBLE",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
    const result = await runYouTubeDiscovery(
      { channels: [], queries: [], playlists: [] },
      {
        runId: "run-saved",
        youtubeConfig: CONFIG,
        client: clientFor([], { listPlaylistVideos }),
        artifactStore: fakeStore(),
        siteIngest: null,
        sourcesConfig: {
          url: "https://site.test/api/discovery-sources",
          token: "t",
        },
        fetchSources: (async () => sourcesJson) as unknown as typeof fetch,
      },
    )
    expect(result.ok).toBe(true)
    expect(listPlaylistVideos).toHaveBeenCalledWith(
      "PLsaved123456",
      expect.anything(),
    )
  })

  it("reports a saved-source outage when no source can run", async () => {
    const result = await runYouTubeDiscovery(
      { channels: [], playlists: [], queries: [] },
      {
        runId: "run-sources-failed",
        youtubeConfig: CONFIG,
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

  it("returns invalid_input for an out-of-range limit", async () => {
    const result = await runYouTubeDiscovery(
      { queries: ["q"], limitPerQuery: 0 },
      { runId: "run-bad", youtubeConfig: CONFIG, artifactStore: fakeStore() },
    )
    expect(result).toMatchObject({ ok: false, reason: "invalid_input" })
  })
})

describe("youtubeAiChristianDiscoveryWorkflow", () => {
  it("loads saved channels during a registered Studio run", async () => {
    vi.stubEnv(
      "DISCOVERY_SOURCES_URL",
      "https://site.test/api/discovery-sources",
    )
    vi.stubEnv("INSTAGRAM_DISCOVERY_SITE_INGEST_TOKEN", "discovery-token")
    vi.stubEnv("YOUTUBE_API_KEY", "yt-key")
    vi.resetModules()
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input))
        if (url.hostname === "site.test") {
          return new Response(
            JSON.stringify({
              sources: [{ value: "@saved-channel", label: "Saved" }],
            }),
            { headers: { "content-type": "application/json" } },
          )
        }
        if (url.pathname.endsWith("/channels")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  contentDetails: { relatedPlaylists: { uploads: "UU123" } },
                },
              ],
            }),
            { headers: { "content-type": "application/json" } },
          )
        }
        if (url.pathname.endsWith("/playlistItems")) {
          return new Response(JSON.stringify({ items: [] }), {
            headers: { "content-type": "application/json" },
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })

    try {
      const { youtubeAiChristianDiscoveryWorkflow: workflow } =
        await import("./youtube-ai-christian-discovery")
      const run = await workflow.createRun({
        runId: "run-studio-saved-youtube",
      })
      const result = await run.start({
        inputData: {
          channels: [],
          playlists: [],
          queries: [],
          persistArtifact: false,
        },
      })

      expect(result.status).toBe("success")
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual(
        expect.arrayContaining([
          expect.stringContaining("https://site.test/api/discovery-sources"),
          expect.stringContaining(
            "https://www.googleapis.com/youtube/v3/channels",
          ),
          expect.stringContaining(
            "https://www.googleapis.com/youtube/v3/playlistItems",
          ),
        ]),
      )
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it("preserves saved-source outages for Studio runs and launchers", async () => {
    vi.stubEnv(
      "DISCOVERY_SOURCES_URL",
      "https://site.test/api/discovery-sources",
    )
    vi.stubEnv("INSTAGRAM_DISCOVERY_SITE_INGEST_TOKEN", "discovery-token")
    vi.resetModules()
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("down", { status: 500 }))

    try {
      const {
        _internals,
        launchYouTubeDiscoveryWorkflow,
        youtubeAiChristianDiscoveryWorkflow: workflow,
      } = await import("./youtube-ai-christian-discovery")
      const input = {
        channels: [],
        playlists: [],
        queries: [],
        persistArtifact: false,
      }
      const run = await workflow.createRun({
        runId: "run-studio-failed-youtube-sources",
      })
      const result = await run.start({ inputData: input })

      expect(result.status).toBe("failed")
      expect(_internals.discoveryFailureFromRunResult(result)).toMatchObject({
        ok: false,
        reason: "sources_unavailable",
        retryable: true,
      })
      await expect(
        launchYouTubeDiscoveryWorkflow(input, {
          runId: "run-launch-failed-youtube-sources",
        }),
      ).resolves.toMatchObject({
        ok: false,
        reason: "sources_unavailable",
        retryable: true,
      })
    } finally {
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it("remains registered", () => {
    expect(youtubeAiChristianDiscoveryWorkflow.committed).toBe(true)
  })
})

describe("handleYouTubeDiscoveryRouteRequest", () => {
  const okResult: YouTubeDiscoveryWorkflowResult = {
    ok: true,
    mastraRunId: "r",
    totals: {
      candidates: 0,
      videos: 0,
      deduped: 0,
      excludedCommentary: 0,
      qualified: 0,
    },
    videos: [],
    sourceFailures: [],
    reviewQueue: { status: "empty" },
  }

  it("rejects requests without a valid bearer", async () => {
    const launch = vi.fn()
    const outcome = await handleYouTubeDiscoveryRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["right"],
      readJson: async () => ({}),
      launch: launch as never,
    })
    expect(outcome.status).toBe(401)
    expect(launch).not.toHaveBeenCalled()
  })

  it("launches the workflow for a valid bearer", async () => {
    const outcome = await handleYouTubeDiscoveryRouteRequest({
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
    const outcome = await handleYouTubeDiscoveryRouteRequest({
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
    const outcome = await handleYouTubeDiscoveryRouteRequest({
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

  it("maps all_sources_failed to 502", async () => {
    const outcome = await handleYouTubeDiscoveryRouteRequest({
      authHeader: "Bearer right",
      serviceKeys: ["right"],
      readJson: async () => ({}),
      launch: async () => ({
        ok: false,
        reason: "all_sources_failed",
        retryable: true,
        mastraRunId: "r",
      }),
    })
    expect(outcome.status).toBe(502)
  })
})
