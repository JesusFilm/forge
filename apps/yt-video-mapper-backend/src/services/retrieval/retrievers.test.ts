import { describe, expect, it } from "vitest"
import { retrieveAudioCandidates } from "./audio-retriever.js"
import { retrieveTextCandidates } from "./text-retriever.js"
import { retrieveVisualCandidates } from "./visual-retriever.js"

describe("retrievers", () => {
  it("scores visual frame hash overlap by variant", () => {
    expect(
      retrieveVisualCandidates({
        uploadFrameHashes: ["a", "b", "c"],
        officialFrameSignatures: [
          signature("core-1", "variant-1", "a"),
          signature("core-1", "variant-1", "b"),
          signature("core-2", "variant-2", "z"),
        ],
      }),
    ).toEqual([
      {
        coreId: "core-1",
        videoVariantId: "variant-1",
        visualScore: 2 / 3,
      },
    ])
  })

  it("scores audio fingerprint overlap by variant", () => {
    expect(
      retrieveAudioCandidates({
        uploadAudioFingerprints: ["voice-a", "voice-b"],
        officialAudioSignatures: [
          signature("core-1", "variant-en", "voice-a"),
          signature("core-1", "variant-es", "voice-z"),
        ],
      }),
    ).toEqual([
      {
        coreId: "core-1",
        videoVariantId: "variant-en",
        audioScore: 0.5,
      },
    ])
  })

  it("scores transcript token overlap by variant", () => {
    expect(
      retrieveTextCandidates({
        uploadTranscriptText: "peace be with you",
        officialTextSignatures: [
          signature("core-1", "variant-en", "peace be with you"),
          signature("core-2", "variant-es", "different words entirely"),
        ],
      }),
    ).toEqual([
      {
        coreId: "core-1",
        videoVariantId: "variant-en",
        textScore: 1,
      },
    ])
  })
})

function signature(coreId: string, videoVariantId: string, value: string) {
  return {
    coreId,
    videoVariantId,
    offsetMilliseconds: 0,
    value,
  }
}
