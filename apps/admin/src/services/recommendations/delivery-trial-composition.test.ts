import { describe, expect, it } from "vitest"
import { adaptSemanticCandidates, type CandidateNomination } from "./candidate"
import {
  mergeBoundedCowatchNominations,
  selectedCandidateGenerator,
} from "./delivery-candidate-mapping"
import { applyMmrComposition, runCandidatePlatform } from "./orchestration"
import { composeMmrSlate, MMR_SLATE_POLICY_VERSION } from "./composition/mmr"

const context = {
  surface: "watch-below-player-v1",
  purpose: "watch",
  locale: "en",
  audioLanguageSlug: "english",
} as const
function source(
  generator: string,
  count: number,
  offset: number,
): CandidateNomination[] {
  return adaptSemanticCandidates(
    Array.from({ length: count }, (_, index) => {
      const id = String(index + offset).padStart(8, "0")
      return {
        videoId: id,
        videoCoreId: id,
        videoSlug: id,
        videoTitle: `Video ${id}`,
        imageUrl: `https://images.example/${id}.jpg`,
        sceneIndex: 0,
        description: "",
        startSeconds: 0,
        endSeconds: 30,
        themes: [`theme-${index % 4}`],
        demographics: [],
        spiritualContext: [],
        playbackId: `playback-${id}`,
        similarity: 0.9,
      }
    }),
    context,
  ).nominations.map((row, index) => ({
    ...row,
    source: {
      ...row.source,
      generator,
      evidence: { interestOrdinal: index % 3, interestKind: "durable" },
    },
  }))
}

describe("controlled co-watch/MMR composition", () => {
  it("preserves 36 semantic candidates and a bounded graph reserve without exceeding 64", () => {
    const semantic = source("semantic", 40, 0),
      profile = source("multi-interest-profile", 40, 100),
      graph = source("directional-cowatch", 30, 200)
    const merged = mergeBoundedCowatchNominations(semantic, profile, graph)
    expect(merged).toHaveLength(64)
    expect(merged.filter((n) => n.source.generator === "semantic")).toEqual(
      semantic.slice(0, 36),
    )
    expect(
      merged.filter((n) => n.source.generator === "multi-interest-profile"),
    ).toEqual(profile.slice(0, 16))
    expect(
      merged.filter((n) => n.source.generator === "directional-cowatch"),
    ).toEqual(graph.slice(0, 12))
    expect(merged.slice(0, 3)).toEqual([semantic[0], profile[0], graph[0]])
    expect(
      mergeBoundedCowatchNominations(semantic, profile, []).filter(
        (n) => n.source.generator === "multi-interest-profile",
      ),
    ).toHaveLength(28)
  })

  it("persists the authorized MMR order and per-position reasons instead of the earlier minimal order", () => {
    const nominations = mergeBoundedCowatchNominations(
      source("semantic", 10, 0),
      source("multi-interest-profile", 10, 100),
      source("directional-cowatch", 10, 200),
    )
    const platform = runCandidatePlatform({
      nominations,
      context,
      limit: 6,
      generatorVersion: "trial",
    })
    const mmr = composeMmrSlate({
      ordered: platform.ordered,
      context,
      limit: 6,
      composition: { currentVideoId: "00000000", recentVideos: [] },
    })
    const composed = applyMmrComposition(platform, mmr)
    expect(composed.versions.composer).toBe(MMR_SLATE_POLICY_VERSION)
    expect(composed.composed).toEqual(mmr.composed)
    expect(composed.counts.composed).toBe(6)
    expect(
      composed.evidence
        .filter((entry) => entry.stage === "composed")
        .map((entry) => [entry.targetMediaId, entry.finalPosition])
        .sort(),
    ).toEqual(
      mmr.composed
        .map((entry) => [entry.targetMediaId, entry.composedPosition])
        .sort(),
    )
    expect(
      composed.composed.some((entry) => entry.targetMediaId === "00000000"),
    ).toBe(false)
    expect(
      composed.evidence.filter((entry) => entry.stage === "nominated"),
    ).toEqual(platform.evidence.filter((entry) => entry.stage === "nominated"))
    expect(
      selectedCandidateGenerator([
        {
          generator: "directional-cowatch",
          generatorVersion: "trial",
          rank: 1,
          score: 0.8,
          evidence: {},
          rejectionReason: null,
        },
      ]),
    ).toBe("directional-cowatch")
  })
})
