import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { evaluateShadowProjection } from "../shadow-evaluation/projection"
import type { ShadowGeneratorContext } from "../shadow-evaluation/service"
import { createDatabaseCowatchShadowGenerator } from "./candidate.service"
import { COWATCH_FEATURE_VERSION } from "./graph"
import {
  loadCowatchInspection,
  loadValidatedCowatchProfileInterests,
} from "./inspection.service"

vi.mock("./inspection.service", () => ({
  loadCowatchInspection: vi.fn(),
  loadValidatedCowatchProfileInterests: vi.fn(),
}))

const NOW = new Date("2026-09-28T00:00:00.000Z")
const presentation = {
  videoSlug: "live",
  videoTitle: "Live",
  imageUrl: null,
  sceneIndex: 0,
  description: "",
  startSeconds: 0,
  endSeconds: null,
  durationSeconds: 120,
  themes: [],
  demographics: [],
  spiritualContext: [],
  playbackId: "live-playback",
  locale: "en",
  audioLanguageSlug: "english",
  watchPlayable: true,
  localePublished: true,
}

const context: ShadowGeneratorContext = {
  surface: "watch-below-player-v1",
  purpose: "watch",
  locale: "en",
  audioLanguageSlug: "english",
  seedMediaId: "source",
  manifestId: "hybrid-manifest",
  contextProjection: {
    ref: null,
    version: "none",
    digest: null,
    privacyGeneration: null,
  },
  liveItems: [{ targetMediaId: "live", position: 1, presentation }],
}

describe("co-watch shadow candidate adapter", () => {
  it("carries exact graph evidence into an eligible ranked shadow nomination", async () => {
    vi.mocked(loadValidatedCowatchProfileInterests).mockResolvedValue([])
    vi.mocked(loadCowatchInspection).mockResolvedValue({
      generation: "g".repeat(64),
      shadowEvaluation: null,
      state: "current",
      publishedAt: NOW,
      sourceCount: 6,
      contributionCount: 3,
      edgeCount: 1,
      distinctViewerCount: 3,
      staleReasons: [],
      terminalDecision: "no_promotion",
      decisionReason: "controlled_evaluation_required_feat_505",
      anchors: [
        { mediaId: "source", kind: "seed", interestOrdinal: null, weight: 1 },
      ],
      candidates: [
        {
          contractVersion: COWATCH_FEATURE_VERSION,
          generation: "g".repeat(64),
          sourceMediaId: "source",
          targetMediaId: "target",
          sessionSupport: 3,
          distinctViewerSupport: 3,
          confidence: 0.55,
          popularityCorrectedLift: 1.4,
          recencyWeight: 0.9,
          qualityWeight: 0.8,
          effectiveWeight: 2.1,
          contamination: 1 / 3,
          eligible: true,
        },
      ],
      selectedEdges: [],
      reverseEdges: [],
      overlapMediaIds: [],
      candidateDecision: "shadow_candidates_available",
    } as Awaited<ReturnType<typeof loadCowatchInspection>>)
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          videoId: "target",
          videoCoreId: "target-core",
          videoSlug: "target",
          videoTitle: "Target",
          playbackId: "target-playback",
          durationSeconds: 120,
          imageUrl: null,
        },
      ]),
    } as unknown as PrismaClient
    const generated = await createDatabaseCowatchShadowGenerator(
      prisma,
      () => NOW,
    )(context)
    expect(generated.nominations.map((row) => row.source.generator)).toEqual([
      "live-baseline",
      "directional-cowatch",
    ])
    const projection = evaluateShadowProjection({
      context,
      liveOrder: ["live"],
      nominations: generated.nominations,
      limit: 2,
      projectionCapturedAt: NOW,
      evaluatedAt: NOW,
      latencyMs: 100,
      cohortQuality: generated.cohortQuality,
      rankingMode: "hybrid",
      currentVideoId: "source",
    })
    const edge = projection.nominations.find(
      (row) => row.generator === "directional-cowatch",
    )
    expect(edge).toMatchObject({
      targetMediaId: "target",
      eligible: true,
      provenance: {
        featureVersion: COWATCH_FEATURE_VERSION,
        generation: "g".repeat(64),
        support: 3,
        confidence: 0.55,
        lift: 1.4,
      },
    })
    expect(edge?.shadowPosition).not.toBeNull()
    expect(projection.liveOrder).toEqual(["live"])
  })
})
