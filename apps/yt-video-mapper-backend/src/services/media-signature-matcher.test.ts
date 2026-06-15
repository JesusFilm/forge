import { describe, expect, it } from "vitest"
import {
  InMemoryMediaSignatureMatchRepository,
  MediaSignatureMatcher,
  type MatchableMediaSignature,
} from "./media-signature-matcher.js"
import type { UploadSignals } from "./upload-signal-extraction.js"

const matchingSampleHash =
  "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a"
const otherSampleHash =
  "55e5509f8052998294266ee5b50cb592938191fb5d67f73cac2e60b0276b1bdd"

describe("MediaSignatureMatcher", () => {
  it("retrieves candidates from seeded structural MediaSignature rows", async () => {
    const matcher = createMatcher([
      structuralSignature({
        coreId: "core-jesus-film",
        videoVariantId: "variant-en",
        sha256: matchingSampleHash,
      }),
      structuralSignature({
        coreId: "core-other",
        videoVariantId: "variant-other",
        sha256: otherSampleHash,
      }),
    ])

    await expect(
      matcher.match(
        uploadSignals({ sampledByteHashes: [matchingSampleHash] }),
        {
          limit: 3,
        },
      ),
    ).resolves.toEqual([
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-en",
        confidence: 1,
        matchStrength: "high",
      },
    ])
  })

  it("uses source-anchor evidence to rank the correct variant under the same coreId", async () => {
    const matcher = createMatcher([
      structuralSignature({
        coreId: "core-jesus-film",
        videoVariantId: "variant-en",
        sha256: matchingSampleHash,
      }),
      textSignature({
        coreId: "core-jesus-film",
        videoVariantId: "variant-es",
        text: "paz sea contigo",
      }),
    ])

    await expect(
      matcher.match(
        uploadSignals({
          sampledByteHashes: [matchingSampleHash],
          transcriptText: "paz sea contigo",
        }),
        { limit: 3 },
      ),
    ).resolves.toEqual([
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-es",
        confidence: 1,
        matchStrength: "high",
      },
    ])
  })

  it("keeps visual or structural source evidence ahead when text points elsewhere", async () => {
    const matcher = createMatcher([
      structuralSignature({
        coreId: "core-visual",
        videoVariantId: "variant-visual",
        sha256: matchingSampleHash,
      }),
      textSignature({
        coreId: "core-text-only",
        videoVariantId: "variant-text-only",
        text: "peace be with you",
      }),
    ])

    await expect(
      matcher.match(
        uploadSignals({
          sampledByteHashes: [matchingSampleHash],
          transcriptText: "peace be with you",
        }),
        { limit: 3 },
      ),
    ).resolves.toEqual([
      {
        coreId: "core-visual",
        videoVariantId: "variant-visual",
        confidence: 1,
        matchStrength: "high",
      },
    ])
  })

  it("does not let weak variant evidence replace an exact source fallback", async () => {
    const matcher = createMatcher([
      structuralSignature({
        coreId: "core-jesus-film",
        videoVariantId: "variant-en",
        sha256: matchingSampleHash,
      }),
      textSignature({
        coreId: "core-jesus-film",
        videoVariantId: "variant-es",
        text: "peace be with you amen",
      }),
    ])

    await expect(
      matcher.match(
        uploadSignals({
          sampledByteHashes: [matchingSampleHash],
          transcriptText: "peace unrelated words",
        }),
        { limit: 2 },
      ),
    ).resolves.toEqual([
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-en",
        confidence: 1,
        matchStrength: "high",
      },
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-es",
        confidence: 0.802,
        matchStrength: "medium",
      },
    ])
  })

  it("does not merge shared videoVariantId values across different coreIds", async () => {
    const matcher = createMatcher([
      structuralSignature({
        coreId: "core-a",
        videoVariantId: "shared-variant",
        sha256: matchingSampleHash,
      }),
      structuralSignature({
        coreId: "core-b",
        videoVariantId: "shared-variant",
        sha256: otherSampleHash,
      }),
    ])

    await expect(
      matcher.match(
        uploadSignals({ sampledByteHashes: [matchingSampleHash] }),
        {
          limit: 3,
        },
      ),
    ).resolves.toEqual([
      {
        coreId: "core-a",
        videoVariantId: "shared-variant",
        confidence: 1,
        matchStrength: "high",
      },
    ])
  })

  it("caps text-only evidence below high strength without source-anchor evidence", async () => {
    const matcher = createMatcher([
      textSignature({
        coreId: "core-text",
        videoVariantId: "variant-text",
        text: "peace be with you",
      }),
    ])

    await expect(
      matcher.match(
        uploadSignals({
          sampledByteHashes: [],
          transcriptText: "peace be with you",
        }),
        { limit: 3 },
      ),
    ).resolves.toEqual([
      {
        coreId: "core-text",
        videoVariantId: "variant-text",
        confidence: 0.84,
        matchStrength: "medium",
      },
    ])
  })

  it("uses audio evidence only when uploaded audio fingerprints exist", async () => {
    const matcher = createMatcher([
      audioSignature({
        coreId: "core-audio",
        videoVariantId: "variant-audio",
        fingerprint: "voice-a",
      }),
    ])

    await expect(
      matcher.match(uploadSignals({ audioFingerprints: [] }), { limit: 3 }),
    ).resolves.toEqual([])
    await expect(
      matcher.match(uploadSignals({ audioFingerprints: ["voice-a"] }), {
        limit: 3,
      }),
    ).resolves.toEqual([
      {
        coreId: "core-audio",
        videoVariantId: "variant-audio",
        confidence: 0.84,
        matchStrength: "medium",
      },
    ])
  })
})

function createMatcher(signatures: MatchableMediaSignature[]) {
  return new MediaSignatureMatcher(
    new InMemoryMediaSignatureMatchRepository(signatures),
  )
}

function uploadSignals(overrides: Partial<UploadSignals> = {}): UploadSignals {
  const sampledByteHashes = overrides.sampledByteHashes ?? []

  return {
    visualHashes: sampledByteHashes,
    audioFingerprints: [],
    sampledByteHashes,
    byteSamples: [],
    byteLength: 4,
    contentType: "video/mp4",
    algorithmVersion: "official-media-signature-v1",
    ...overrides,
  }
}

function structuralSignature({
  coreId,
  videoVariantId,
  sha256,
  durationMilliseconds = 120_000,
}: {
  coreId: string
  videoVariantId: string
  sha256: string
  durationMilliseconds?: number
}): MatchableMediaSignature {
  return signature({
    coreId,
    videoVariantId,
    signatureType: "STRUCTURAL_HINT",
    durationMilliseconds,
    signature: {
      kind: "structural_hint_v1",
      durationMilliseconds,
      byteSample: {
        sha256,
        byteLength: 4,
        rangeStart: 0,
        rangeEnd: 3,
        complete: false,
      },
    },
  })
}

function textSignature({
  coreId,
  videoVariantId,
  text,
}: {
  coreId: string
  videoVariantId: string
  text: string
}): MatchableMediaSignature {
  return signature({
    coreId,
    videoVariantId,
    signatureType: "TEXT_SEGMENT",
    signature: {
      kind: "text_segment_v1",
      text,
      tokenCount: text.split(/\s+/).length,
    },
  })
}

function audioSignature({
  coreId,
  videoVariantId,
  fingerprint,
}: {
  coreId: string
  videoVariantId: string
  fingerprint: string
}): MatchableMediaSignature {
  return signature({
    coreId,
    videoVariantId,
    signatureType: "AUDIO_FINGERPRINT",
    signature: {
      kind: "audio_fingerprint_v1",
      fingerprint,
    },
  })
}

function signature({
  coreId,
  videoVariantId,
  signatureType,
  durationMilliseconds = null,
  signature,
}: {
  coreId: string
  videoVariantId: string
  signatureType: MatchableMediaSignature["signatureType"]
  durationMilliseconds?: number | null
  signature: unknown
}): MatchableMediaSignature {
  return {
    coreId,
    videoVariantId,
    signatureType,
    offsetMilliseconds: 0,
    durationMilliseconds,
    signature,
    catalogVariant: {
      durationSeconds: 120,
      lengthInMilliseconds: null,
      languageSlug: null,
      locale: null,
    },
  }
}
