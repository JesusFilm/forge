import { describe, expect, it } from "vitest"
import { retrieveAudioCandidates } from "./audio-retriever.js"
import { retrieveTextCandidates } from "./text-retriever.js"
import { retrieveVisualCandidates } from "./visual-retriever.js"

describe("retrievers", () => {
  it("searches seeded official media signatures by composite variant identity", () => {
    const officialSignatures = [
      storedSignature({
        coreId: "core-1",
        videoVariantId: "variant-1",
        value: "frame-a",
      }),
      storedSignature({
        coreId: "core-1",
        videoVariantId: "variant-1",
        value: "frame-b",
        offsetMilliseconds: 5_000,
      }),
      storedSignature({
        coreId: "core-2",
        videoVariantId: "variant-2",
        value: "frame-z",
      }),
    ]

    expect(
      retrieveVisualCandidates({
        uploadFrameHashes: ["frame-a", "frame-b"],
        officialFrameSignatures: officialSignatures.map(
          toTimecodedStringSignature,
        ),
      }),
    ).toEqual([
      {
        coreId: "core-1",
        videoVariantId: "variant-1",
        visualScore: 1,
      },
    ])
  })

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

  it("keeps retrieval keyed by coreId and videoVariantId together", () => {
    expect(
      retrieveVisualCandidates({
        uploadFrameHashes: ["a"],
        officialFrameSignatures: [
          signature("core-a", "shared-variant", "a"),
          signature("core-b", "shared-variant", "z"),
        ],
      }),
    ).toEqual([
      {
        coreId: "core-a",
        videoVariantId: "shared-variant",
        visualScore: 1,
      },
    ])
  })

  it("ranks v2 visual fingerprints by Hamming similarity", () => {
    expect(
      retrieveVisualCandidates({
        uploadFrameHashes: ["ffffffff00000000"],
        officialFrameSignatures: [
          signature("core-far", "variant-far", "0000000000000000"),
          signature("core-near", "variant-near", "f0ffffff00000000"),
          signature("core-exact", "variant-exact", "ffffffff00000000"),
        ],
        minimumScore: 0,
      }),
    ).toEqual([
      {
        coreId: "core-exact",
        videoVariantId: "variant-exact",
        visualScore: 1,
      },
      {
        coreId: "core-near",
        videoVariantId: "variant-near",
        visualScore: 0.9375,
      },
      {
        coreId: "core-far",
        videoVariantId: "variant-far",
        visualScore: 0.5,
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
    const officialTextSignatures = [
      storedSignature({
        coreId: "core-1",
        videoVariantId: "variant-en",
        signatureType: "TEXT_SEGMENT",
        value: "peace be with you",
      }),
      storedSignature({
        coreId: "core-2",
        videoVariantId: "variant-es",
        signatureType: "TEXT_SEGMENT",
        value: "different words entirely",
      }),
    ]

    expect(
      retrieveTextCandidates({
        uploadTranscriptText: "peace be with you",
        officialTextSignatures: officialTextSignatures.map(
          toTimecodedStringSignature,
        ),
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

type StoredMediaSignatureFixture = {
  coreId: string
  videoVariantId: string
  signatureType: "VISUAL_FRAME" | "TEXT_SEGMENT"
  algorithmVersion: string
  offsetMilliseconds: number
  signature: {
    kind: "visual_frame_v1" | "text_segment_v1"
    value: string
  }
}

function storedSignature({
  coreId,
  videoVariantId,
  signatureType = "VISUAL_FRAME",
  value,
  offsetMilliseconds = 0,
}: {
  coreId: string
  videoVariantId: string
  signatureType?: StoredMediaSignatureFixture["signatureType"]
  value: string
  offsetMilliseconds?: number
}): StoredMediaSignatureFixture {
  return {
    coreId,
    videoVariantId,
    signatureType,
    algorithmVersion: "official-media-signature-v1",
    offsetMilliseconds,
    signature: {
      kind:
        signatureType === "VISUAL_FRAME"
          ? "visual_frame_v1"
          : "text_segment_v1",
      value,
    },
  }
}

function toTimecodedStringSignature(signature: StoredMediaSignatureFixture) {
  return {
    coreId: signature.coreId,
    videoVariantId: signature.videoVariantId,
    offsetMilliseconds: signature.offsetMilliseconds,
    value: signature.signature.value,
  }
}
