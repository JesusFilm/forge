import { describe, expect, it, vi } from "vitest"

import type { DiscoveredVideo } from "../../services/discovery/candidate"
import type { PinterestDiscoveryArtifactStore } from "../../services/pinterest-discovery/artifacts"
import type {
  PinterestDiscoveryReport,
  PinterestRawItem,
} from "../../services/pinterest-discovery/types"
import { PinterestSearchError } from "../../services/pinterest-search-client"
import {
  handlePinterestDiscoveryRouteRequest,
  runPinterestDiscovery,
  type PinterestDiscoveryWorkflowResult,
} from "./pinterest-ai-christian-discovery"

function fakeStore(): PinterestDiscoveryArtifactStore & {
  written: PinterestDiscoveryReport[]
} {
  const written: PinterestDiscoveryReport[] = []
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

function rawItem(
  id: string,
  title: string,
  board = "user/board",
): PinterestRawItem {
  return {
    title,
    link: `https://www.pinterest.com/pin/${id}/`,
    pubDate: "Sat, 28 Dec 2024 17:35:04 GMT",
    description: "&lt;img src=&quot;https://i.pinimg.com/t.jpg&quot;&gt;",
    boardName: board,
    boardUrl: `https://www.pinterest.com/${board}/`,
  }
}

const christianPin = rawItem("1", "AI art of Jesus on the cross #faith")
const offTopicPin = rawItem("2", "A beautiful sunset over the mountains")
const commentaryPin = rawItem(
  "3",
  "My thoughts: should we trust AI art? reaction",
)

describe("runPinterestDiscovery", () => {
  it("trusts the board: keeps pins regardless of AI/Christian keywords", async () => {
    const store = fakeStore()
    const result = await runPinterestDiscovery(
      { boards: ["https://www.pinterest.com/user/board/"] },
      {
        runId: "run-1",
        fetchBoard: vi.fn(async () => [christianPin, offTopicPin]),
        artifactStore: store,
        siteIngest: null,
        now: () => new Date("2026-06-18T00:00:00Z"),
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    // both kept (trust the source) — off-topic is caught at human review
    expect(result.totals.qualified).toBe(2)
    expect(store.written).toHaveLength(1)
  })

  it("drops commentary pins even from a trusted board", async () => {
    const result = await runPinterestDiscovery(
      { boards: ["https://www.pinterest.com/user/board/"] },
      {
        runId: "run-comment",
        fetchBoard: vi.fn(async () => [christianPin, commentaryPin]),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.totals.qualified).toBe(1)
    expect(result.totals.excludedCommentary).toBe(1)
    expect(result.pins.some((p) => p.pinId === "3")).toBe(false)
  })

  it("dedupes the same pin across boards", async () => {
    const result = await runPinterestDiscovery(
      {
        boards: [
          "https://www.pinterest.com/a/board/",
          "https://www.pinterest.com/b/board/",
        ],
      },
      {
        runId: "run-dedupe",
        fetchBoard: vi.fn(async () => [christianPin]),
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.totals.candidates).toBe(2)
    expect(result.totals.deduped).toBe(1)
  })

  it("submits qualified pins with platform=pinterest and board attribution", async () => {
    const submitPins = vi.fn(async (_pins: DiscoveredVideo[]) => ({
      ok: true,
      inserted: 1,
      skipped: 0,
    }))
    const result = await runPinterestDiscovery(
      { boards: ["https://www.pinterest.com/user/jesus/"] },
      {
        runId: "run-submit",
        fetchBoard: vi.fn(async () => [christianPin]),
        artifactStore: fakeStore(),
        submitPins,
      },
    )
    expect(result.ok).toBe(true)
    expect(submitPins).toHaveBeenCalledTimes(1)
    const submitted = submitPins.mock.calls[0]![0]
    expect(submitted[0]!.platform).toBe("pinterest")
    expect(submitted[0]!.externalId).toBe("1")
    expect(submitted[0]!.authorUrl).toContain("pinterest.com")
    if (!result.ok) throw new Error("expected success")
    expect(result.reviewQueue).toEqual({
      status: "submitted",
      inserted: 1,
      skipped: 0,
    })
  })

  it("returns all_boards_failed when every board errors", async () => {
    const result = await runPinterestDiscovery(
      { boards: ["a", "b"] },
      {
        runId: "run-fail",
        fetchBoard: vi.fn(async () => {
          throw new PinterestSearchError("not_found", "private", false)
        }),
        artifactStore: fakeStore(),
      },
    )
    expect(result).toMatchObject({ ok: false, reason: "all_boards_failed" })
  })

  it("succeeds with partial board failures", async () => {
    const fetchBoard = vi.fn(async (board: string) => {
      if (board.includes("bad"))
        throw new PinterestSearchError("not_found", "private", false)
      return [christianPin]
    })
    const result = await runPinterestDiscovery(
      {
        boards: [
          "https://www.pinterest.com/bad/board/",
          "https://www.pinterest.com/good/board/",
        ],
      },
      {
        runId: "run-partial",
        fetchBoard,
        artifactStore: fakeStore(),
        siteIngest: null,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.boardFailures).toHaveLength(1)
    expect(result.pins).toHaveLength(1)
  })

  it("merges saved boards from the sources endpoint", async () => {
    const fetchBoard = vi.fn(async () => [christianPin])
    const sourcesJson = new Response(
      JSON.stringify({
        sources: [
          { value: "https://www.pinterest.com/u/saved/", label: "Saved" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
    const result = await runPinterestDiscovery(
      { boards: [] },
      {
        runId: "run-saved",
        fetchBoard,
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
    expect(fetchBoard).toHaveBeenCalledWith(
      "https://www.pinterest.com/u/saved/",
      expect.anything(),
    )
  })

  it("reports saved-source outages instead of a successful empty run", async () => {
    const result = await runPinterestDiscovery(
      { boards: [] },
      {
        runId: "run-sources-failed",
        artifactStore: fakeStore(),
        siteIngest: null,
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
    const result = await runPinterestDiscovery(
      { boards: ["x"], limitPerBoard: 0 },
      { runId: "run-bad", artifactStore: fakeStore() },
    )
    expect(result).toMatchObject({ ok: false, reason: "invalid_input" })
  })
})

describe("handlePinterestDiscoveryRouteRequest", () => {
  const okResult: PinterestDiscoveryWorkflowResult = {
    ok: true,
    mastraRunId: "r",
    totals: {
      candidates: 0,
      pins: 0,
      deduped: 0,
      excludedCommentary: 0,
      qualified: 0,
    },
    pins: [],
    boardFailures: [],
    reviewQueue: { status: "empty" },
  }

  it("rejects requests without a valid bearer", async () => {
    const launch = vi.fn()
    const outcome = await handlePinterestDiscoveryRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["right"],
      readJson: async () => ({}),
      launch: launch as never,
    })
    expect(outcome.status).toBe(401)
    expect(launch).not.toHaveBeenCalled()
  })

  it("launches the workflow for a valid bearer", async () => {
    const outcome = await handlePinterestDiscoveryRouteRequest({
      authHeader: "Bearer right",
      serviceKeys: ["right"],
      readJson: async () => ({ boards: ["x"] }),
      launch: async () => okResult,
    })
    expect(outcome.status).toBe(200)
    expect(outcome.body.result).toEqual(okResult)
  })

  it("maps all_boards_failed to 502", async () => {
    const outcome = await handlePinterestDiscoveryRouteRequest({
      authHeader: "Bearer right",
      serviceKeys: ["right"],
      readJson: async () => ({}),
      launch: async () => ({
        ok: false,
        reason: "all_boards_failed",
        retryable: true,
        mastraRunId: "r",
      }),
    })
    expect(outcome.status).toBe(502)
  })
})
