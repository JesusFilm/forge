import { describe, expect, it } from "vitest"
import {
  coverageBlockers,
  recommendationCoverageQuery,
  type RecommendationCoverageInventory,
} from "./coverage-diagnostics"

const inventory: RecommendationCoverageInventory = {
  observedAt: "2026-09-10T00:00:00Z",
  seedExists: true,
  seedTranscripts: 1,
  seedCompatibleTranscripts: 1,
  seedEmbeddedTranscripts: 1,
  candidateTranscripts: 20,
  candidateCompatibleTranscripts: 19,
  candidateEmbeddedVideos: 18,
  watchableVideos: 17,
  publishedLocaleVideos: 16,
  exactAudioVideos: 15,
  eligibleInventoryVideos: 14,
  publishedLocalesOnExactAudioVideos: [],
}

describe("recommendation coverage diagnostics", () => {
  it("reports seed and candidate failures independently", () => {
    expect(
      coverageBlockers({
        ...inventory,
        seedTranscripts: 0,
        seedCompatibleTranscripts: 0,
        seedEmbeddedTranscripts: 0,
        publishedLocaleVideos: 0,
        eligibleInventoryVideos: 0,
      }),
    ).toEqual(["seed_transcript_missing", "published_metadata_missing"])
  })

  it("distinguishes absent metadata from missing exact audio and no overlap", () => {
    expect(
      coverageBlockers({
        ...inventory,
        exactAudioVideos: 0,
        eligibleInventoryVideos: 0,
      }),
    ).toEqual(["exact_audio_unavailable"])
    expect(
      coverageBlockers({ ...inventory, eligibleInventoryVideos: 0 }),
    ).toEqual(["publication_audio_no_overlap"])
    expect(coverageBlockers(inventory)).toEqual([])
  })

  it("distinguishes incompatible provenance from absent sources", () => {
    expect(
      coverageBlockers({
        ...inventory,
        seedCompatibleTranscripts: 0,
        seedEmbeddedTranscripts: 0,
      }),
    ).toEqual(["seed_contract_incompatible"])
    expect(
      coverageBlockers({
        ...inventory,
        candidateCompatibleTranscripts: 0,
        candidateEmbeddedVideos: 0,
      }),
    ).toEqual(["candidate_contract_incompatible"])
  })

  it("parameterizes all input without substituting audio identity", () => {
    const query = recommendationCoverageQuery({
      seedMediaId: "seed'",
      locale: "zh'",
      audioLanguageSlug: "mandarin-china",
    })
    expect(query.text).not.toContain("seed'")
    expect(query.text).not.toContain("zh'")
    expect(query.values).toContain("seed'")
    expect(query.values).toContain("zh'")
    expect(query.values).toContain("mandarin-china")
  })
})
