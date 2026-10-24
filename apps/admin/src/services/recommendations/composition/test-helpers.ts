import { adaptSemanticCandidates, type CandidateNomination } from "../candidate"
import { runCandidatePlatform } from "../orchestration"
export const context = {
  surface: "watch-below-player-v1",
  purpose: "watch",
  locale: "en",
  audioLanguageSlug: "english",
} as const
export function nominations(): CandidateNomination[] {
  return adaptSemanticCandidates(
    ["a", "b", "c"].map((id, index) => ({
      videoId: id,
      videoCoreId: `core-${id}`,
      videoSlug: id,
      videoTitle: `Video ${id}`,
      imageUrl: `https://images.example/${id}.jpg`,
      sceneIndex: 0,
      description: "",
      startSeconds: 0,
      endSeconds: 30,
      themes: index === 2 ? ["faith"] : ["hope"],
      demographics: [],
      spiritualContext: [],
      playbackId: `playback-${id}`,
      similarity: 0.9,
    })),
    context,
  ).nominations.map((row, index) => ({
    ...row,
    source: {
      ...row.source,
      generator: "multi-interest-profile",
      evidence: { interestOrdinal: index, interestKind: "durable" },
    },
  }))
}
export function slate() {
  return {
    ordered: runCandidatePlatform({
      nominations: nominations(),
      context,
      limit: 2,
      generatorVersion: "test",
    }).ordered,
    context,
    limit: 2,
  }
}
export const thresholds = {
  minimumRuns: 1,
  maxFallbackRate: 0,
  maxMissingInputRate: 0,
  maxLatencyMs: 200,
  minimumFillRate: 1,
}
