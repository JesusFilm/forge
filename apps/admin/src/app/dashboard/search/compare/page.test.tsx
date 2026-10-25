import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import type { WatchSearchComparisonView } from "./comparison-actions"

const requireCurrentAdminEvaluator = vi.fn()
const loadWatchSearchLanguageOptions = vi.fn()
const notFound = vi.fn(() => {
  throw new Error("not-found")
})
const mockEnv = vi.hoisted(() => ({
  WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED: true,
}))

vi.mock("@/config/env", () => ({
  env: mockEnv,
  resolveWatchSearchRuntimeEnv: () => ({
    candidateComparisonEnabled:
      mockEnv.WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED,
  }),
}))
vi.mock("./comparison-actions", () => ({
  requireCurrentAdminEvaluator,
  runWatchSearchComparison: vi.fn(),
}))
vi.mock("@/services/watch-search-language-options.service", () => ({
  loadWatchSearchLanguageOptions,
}))
vi.mock("next/navigation", () => ({ notFound }))

const { default: ComparePage } = await import("./page")
const {
  WatchSearchComparison,
  WatchSearchComparisonPanes,
  comparisonThumbnailUrl,
  rankingModeLabel,
} = await import("./watch-search-comparison")

const previousServerFormSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    languageSelection: z
      .union([z.literal(""), z.string().trim().min(1)])
      .optional(),
    page: z.coerce.number().int().min(1).max(1_000).default(1),
    perPage: z.coerce.number().int().min(1).max(50).default(10),
    contentType: z.enum(["all", "video", "experience"]).default("all"),
  })
  .strict()

function renderedFormValues(html: string) {
  const exampleValues: Record<string, string> = {
    query: "Jesus",
    languageSelection: "japanese",
    perPage: "10",
    page: "1",
    contentType: "video",
  }
  return Object.fromEntries(
    [...html.matchAll(/\bname="([^"]+)"/g)].map(([, name]) => [
      name,
      exampleValues[name!],
    ]),
  )
}

type SuccessfulComparisonSide = Extract<
  WatchSearchComparisonView["current"],
  { status: "success" }
>
type ComparisonResult = SuccessfulComparisonSide["response"]["results"][number]

function comparisonResult(
  overrides: Partial<ComparisonResult> = {},
): ComparisonResult {
  return {
    type: "video",
    id: "video-current",
    slug: "jesus",
    title: "JESUS",
    imageUrl: "https://images.example.com/jesus.jpg",
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
      kind: "exact_title",
      languageSlug: "japanese",
      label: "イエス",
    },
    action: { kind: "watch", hrefLanguageSlug: "japanese" },
    fallback: { kind: "none", message: null },
    ...overrides,
  }
}

describe("search comparison page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.WATCH_SEARCH_CANDIDATE_COMPARISON_ENABLED = true
    requireCurrentAdminEvaluator.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
    })
    loadWatchSearchLanguageOptions.mockResolvedValue([
      {
        label: "Japanese — ja-JP",
        value: "japanese",
      },
    ])
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
    expect(html).toContain('name="languageSelection"')
    expect(html).toContain(
      '<option value="" selected="">Auto-detect from query</option>',
    )
    expect(html).toContain('<option value="japanese">Japanese — ja-JP</option>')
    expect(html).toContain("Japanese — ja-JP")
    expect(html).not.toContain('name="targetLanguageSlug"')
    expect(html).not.toContain('name="locale"')
    expect(loadWatchSearchLanguageOptions).toHaveBeenCalledOnce()
  })

  it("keeps auto-detect available when the language catalog fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    loadWatchSearchLanguageOptions.mockRejectedValueOnce(
      new Error("database details must not be logged"),
    )

    const html = renderToStaticMarkup(await ComparePage())

    expect(html).toContain('name="languageSelection"')
    expect(html).toContain("Auto-detect from query")
    expect(html).not.toContain("Japanese — ja-JP")
    expect(warn).toHaveBeenCalledWith(
      "[watch-search] event=language_options_load_failed error_class=Error",
    )
    expect(warn.mock.calls.flat().join(" ")).not.toContain("database details")
  })

  it("keeps this deployment's form compatible with the previous strict action", async () => {
    const html = renderToStaticMarkup(await ComparePage())

    expect(
      previousServerFormSchema.safeParse(renderedFormValues(html)).success,
    ).toBe(true)
  })

  it("keeps a representative full language catalog within its markup budget", () => {
    const languageOptions = Array.from({ length: 2_300 }, (_, index) => ({
      label: `Language ${index} — lng-${index}`,
      value: `language-${index}`,
    }))

    const html = renderToStaticMarkup(
      <WatchSearchComparison languageOptions={languageOptions} />,
    )
    const markupBytes = Buffer.byteLength(html, "utf8")

    expect(markupBytes).toBeLessThan(300_000)
  })

  it("uses curated thumbnails before a Mux playback fallback", () => {
    expect(
      comparisonThumbnailUrl({
        type: "video",
        imageUrl: "https://images.example.com/curated.jpg",
        playbackId: "playback-1",
        startSeconds: 12,
      }),
    ).toBe("https://images.example.com/curated.jpg")
    expect(
      comparisonThumbnailUrl({
        type: "video",
        imageUrl: null,
        playbackId: "playback-1",
        startSeconds: 12,
      }),
    ).toBe(
      "https://image.mux.com/playback-1/thumbnail.jpg?width=640&height=360&fit_mode=smartcrop&time=12",
    )
    expect(
      comparisonThumbnailUrl({
        type: "experience",
        imageUrl: null,
        playbackId: null,
        startSeconds: null,
      }),
    ).toBeNull()
  })

  it("labels the automatic ranking mode for operators", () => {
    expect(rankingModeLabel("SEMANTIC")).toBe("Semantic")
    expect(rankingModeLabel("TITLE_AND_BRAND")).toBe("Title / brand")
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
                  comparisonResult(),
                  comparisonResult({
                    id: "video-fallback",
                    title: "Hope",
                    imageUrl: null,
                    playbackId: "playback-fallback",
                  }),
                  comparisonResult({
                    id: "video-placeholder",
                    title: "Hope",
                    imageUrl: null,
                    playbackId: null,
                  }),
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
                indexContractRevision: null,
                contentEmbeddingContractId: null,
                transcriptChunkingVersion: null,
                transcriptProjectionRevision: null,
                activeTranscriptProjectionRevision: null,
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
                rankingImplementation: "legacy-rrf",
                rankingMode: "SEMANTIC",
                rankingAnchor: null,
                rankingTrace: [
                  {
                    canonicalVideoId: "core:jesus",
                    retrievalSources: [
                      "global_exact_title",
                      "localized_title",
                      "metadata",
                      "semantic",
                    ],
                    evidenceTier: "NORMALIZED_WHOLE_TITLE",
                    fusedScore: 1,
                    wholeTitleMatch: true,
                    titleRank: 1,
                    titleContribution: 1,
                    metadataRank: null,
                    metadataContribution: 0,
                    semanticRank: null,
                    semanticContribution: 0,
                    selectedVideoId: "video-current",
                    watchabilityOutcome: "target_audio",
                    finalRank: 1,
                  },
                  {
                    canonicalVideoId: "core:compatibility",
                    retrievalSources: [],
                    evidenceTier: "SEMANTIC_FILL",
                    fusedScore: 0.5,
                    wholeTitleMatch: false,
                    titleRank: 2,
                    titleContribution: 0.5,
                    metadataRank: null,
                    metadataContribution: 0,
                    semanticRank: null,
                    semanticContribution: 0,
                    selectedVideoId: "video-fallback",
                    watchabilityOutcome: "target_audio",
                    finalRank: 2,
                  },
                ],
                rankingTraceTotal: 3,
                rankingTraceTruncated: true,
              },
            },
            candidate: {
              status: "error",
              error: { code: "search_failed", errorClass: "Error" },
            },
          } satisfies WatchSearchComparisonView
        }
      />,
    )
    expect(html).toContain("Current")
    expect(html).toContain("Candidate")
    expect(html).toContain("JESUS")
    expect(html).toContain("video-current")
    expect(html).toContain('src="https://images.example.com/jesus.jpg"')
    expect(html).toContain(
      'src="https://image.mux.com/playback-fallback/thumbnail.jpg?width=640&amp;height=360&amp;fit_mode=smartcrop"',
    )
    expect(html.match(/<img/g)).toHaveLength(2)
    expect(html).toContain(">H</div>")
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
    expect(html).toContain("Japanese")
    expect(html).toContain("target audio")
    expect(html).toContain("Ranking mode")
    expect(html).toContain("Semantic")
    expect(html).toContain("Found by")
    expect(html).toContain("Global exact title")
    expect(html).toContain("Localized title")
    expect(html).toContain(">Metadata</span>")
    expect(html).toContain(">Semantic</span>")
    expect(html).toContain("Winning evidence")
    expect(html).toContain(">Not captured</span>")
    expect(html).toContain("Not captured — trace truncated")
    expect(html).toContain("Candidate search failed")
  })
})
