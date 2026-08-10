import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const requireCurrentAdminEvaluator = vi.fn()
const notFound = vi.fn(() => {
  throw new Error("not-found")
})
const mockEnv = vi.hoisted(() => ({
  WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED: true,
}))

vi.mock("@/config/env", () => ({ env: mockEnv }))
vi.mock("./comparison-actions", () => ({
  requireCurrentAdminEvaluator,
  runWatchSearchComparison: vi.fn(),
}))
vi.mock("next/navigation", () => ({ notFound }))

const { default: ComparePage } = await import("./page")
const { WatchSearchComparisonPanes } = await import("./watch-search-comparison")

describe("search comparison page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED = true
    requireCurrentAdminEvaluator.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
    })
  })

  it("requires a live Admin and hides the route while disabled", async () => {
    mockEnv.WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED = false
    await expect(ComparePage()).rejects.toThrow("not-found")
    expect(requireCurrentAdminEvaluator).toHaveBeenCalledOnce()
  })

  it("propagates authorization rejection before rendering", async () => {
    requireCurrentAdminEvaluator.mockRejectedValueOnce(
      new Error("redirect:/dashboard"),
    )
    await expect(ComparePage()).rejects.toThrow("redirect:/dashboard")
  })

  it("renders the private comparison form when enabled", async () => {
    const html = renderToStaticMarkup(await ComparePage())
    expect(html).toContain("Compare Watch search")
    expect(html).toContain("Current and candidate")
    expect(html).toContain('name="query"')
    expect(html).toContain('name="targetLanguageSlug"')
  })

  it("keeps the successful pane visible beside an independently failed pane", () => {
    const html = renderToStaticMarkup(
      <WatchSearchComparisonPanes
        result={
          {
            comparisonId: "comparison-1",
            input: { query: "Jesus" },
            current: {
              status: "success",
              response: {
                query: "Jesus",
                results: [
                  {
                    type: "video",
                    id: "video-current",
                    slug: "jesus",
                    title: "JESUS",
                    playbackId: "playback-current",
                    startSeconds: null,
                    score: 1,
                    label: "FEATURE_FILM",
                    durationSeconds: 120,
                    childCount: null,
                    languageSlug: "japanese",
                    languageEnglishName: "Japanese",
                    availability: {
                      kind: "target_audio",
                      languageSlug: "japanese",
                      languageEnglishName: "Japanese",
                      audio: true,
                      subtitles: false,
                    },
                    evidence: {
                      kind: "exact",
                      languageSlug: "japanese",
                      label: "イエス",
                    },
                    action: { kind: "watch", hrefLanguageSlug: "japanese" },
                    fallback: { kind: "none", message: null },
                  },
                ],
                hasMore: false,
                nextOffset: 10,
                searchMode: "watch-search-typesense",
                requestId: "request-current",
                degraded: false,
                latencyMs: 20,
                laneStatuses: [],
                languageInterpretation: {
                  targetLanguageSlug: "japanese",
                  targetLanguageSource: "explicit_target",
                  queryLanguageSlug: "japanese",
                  queryNamedLanguageSlug: null,
                  displayLanguageSlug: "japanese",
                  routeLanguageSlug: null,
                  currentWatchLanguageSlug: null,
                  acceptLanguage: "ja",
                  acceptLanguageSlug: "japanese",
                },
              },
              diagnostics: {
                profile: "CURRENT",
                generationId: null,
                applicationRevision: null,
                transcriptProjectionRevision: null,
                binding: {
                  catalog: "current-catalog",
                  availability: "current-availability",
                  lexical: "current-lexical",
                  transcript: "current-transcript",
                },
                retrievalCalls: 2,
                logicalSubsearches: 5,
                queryFieldCount: 6,
                queryByBytes: 100,
                requestBytes: 200,
                parsedResponseBytes: 300,
                typesenseSearchTimeMs: 10,
                typesenseWallTimeMs: 12,
                retryCount: 0,
                groupedHits: 2,
                candidates: 4,
                hydratedRecords: 1,
              },
            },
            candidate: {
              status: "error",
              error: { code: "search_failed", errorClass: "Error" },
            },
          } as never
        }
      />,
    )
    expect(html).toContain("Current")
    expect(html).toContain("Candidate")
    expect(html).toContain("JESUS")
    expect(html).toContain("video-current")
    expect(html).toContain("Japanese")
    expect(html).toContain("target audio")
    expect(html).toContain("Candidate search failed")
  })
})
