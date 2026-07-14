import { describe, expect, it } from "vitest"
import { fuseRankedCandidates } from "./fusion-scorer.js"

describe("fuseRankedCandidates", () => {
  it("returns a high-strength candidate when visual and audio agree", () => {
    expect(
      fuseRankedCandidates([
        {
          coreId: "core-jesus-film",
          videoVariantId: "variant-en",
          visualScore: 0.98,
          audioScore: 0.96,
          textScore: 0.92,
          durationScore: 0.9,
        },
      ]),
    ).toEqual([
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-en",
        confidence: 0.958,
        matchStrength: "high",
      },
    ])
  })

  it("returns multiple likely variants under the same coreId when audio is weak", () => {
    const candidates = fuseRankedCandidates([
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-en",
        visualScore: 0.92,
        audioScore: 0.2,
      },
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-es",
        visualScore: 0.9,
        audioScore: 0.18,
      },
    ])

    expect(candidates).toEqual([
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-en",
        confidence: 0.68,
        matchStrength: "medium",
      },
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-es",
        confidence: 0.66,
        matchStrength: "medium",
      },
    ])
  })

  it("lets visual source evidence anchor ranking when audio points elsewhere", () => {
    expect(
      fuseRankedCandidates([
        {
          coreId: "core-visual",
          videoVariantId: "variant-visual",
          visualScore: 0.95,
          audioScore: 0.15,
        },
        {
          coreId: "core-audio-only",
          videoVariantId: "variant-audio-only",
          audioScore: 0.99,
        },
      ]),
    ).toEqual([
      {
        coreId: "core-visual",
        videoVariantId: "variant-visual",
        confidence: 0.683,
        matchStrength: "medium",
      },
    ])
  })

  it("merges separate signal rows for the same variant using best signal scores", () => {
    expect(
      fuseRankedCandidates([
        {
          coreId: "core-1",
          videoVariantId: "variant-1",
          visualScore: 0.8,
        },
        {
          coreId: "core-1",
          videoVariantId: "variant-1",
          audioScore: 0.6,
          textScore: 0.5,
        },
        {
          coreId: "core-1",
          videoVariantId: "variant-1",
          audioScore: 0.9,
        },
      ]),
    ).toEqual([
      {
        coreId: "core-1",
        videoVariantId: "variant-1",
        confidence: 0.778,
        matchStrength: "medium",
      },
    ])
  })

  it("does not merge signals for the same variant id under different coreIds", () => {
    expect(
      fuseRankedCandidates([
        {
          coreId: "core-visual",
          videoVariantId: "shared-variant-id",
          visualScore: 0.9,
        },
        {
          coreId: "core-audio",
          videoVariantId: "shared-variant-id",
          audioScore: 0.9,
        },
      ]),
    ).toEqual([
      {
        coreId: "core-visual",
        videoVariantId: "shared-variant-id",
        confidence: 0.9,
        matchStrength: "high",
      },
    ])
  })

  it("keeps visual-only source evidence from overclaiming variant confidence", () => {
    expect(
      fuseRankedCandidates(
        [
          {
            coreId: "core-jesus-film",
            videoVariantId: "variant-en",
            visualScore: 1,
          },
          {
            coreId: "core-jesus-film",
            videoVariantId: "variant-es",
            visualScore: 0.96,
          },
        ],
        { capVisualOnlyVariantConfidence: true },
      ),
    ).toEqual([
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-en",
        confidence: 0.84,
        matchStrength: "medium",
      },
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-es",
        confidence: 0.84,
        matchStrength: "medium",
      },
    ])
  })

  it("preserves visual similarity order when visual-only confidence is capped", () => {
    expect(
      fuseRankedCandidates(
        [
          {
            coreId: "z-exact-source",
            videoVariantId: "z-exact-variant",
            visualScore: 1,
          },
          {
            coreId: "a-near-source",
            videoVariantId: "a-near-variant",
            visualScore: 0.96,
          },
        ],
        { capVisualOnlyVariantConfidence: true },
      ),
    ).toEqual([
      {
        coreId: "z-exact-source",
        videoVariantId: "z-exact-variant",
        confidence: 0.84,
        matchStrength: "medium",
      },
      {
        coreId: "a-near-source",
        videoVariantId: "a-near-variant",
        confidence: 0.84,
        matchStrength: "medium",
      },
    ])
  })

  it("can return high confidence from visual and audio without text or duration", () => {
    expect(
      fuseRankedCandidates([
        {
          coreId: "core-jesus-film",
          videoVariantId: "variant-en",
          visualScore: 0.92,
          audioScore: 0.9,
        },
      ]),
    ).toEqual([
      {
        coreId: "core-jesus-film",
        videoVariantId: "variant-en",
        confidence: 0.913,
        matchStrength: "high",
      },
    ])
  })

  it("does not expose internal evidence fields in public candidates", () => {
    const [candidate] = fuseRankedCandidates([
      {
        coreId: "core-1",
        videoVariantId: "variant-1",
        visualScore: 0.9,
        audioScore: 0.9,
      },
    ])

    expect(Object.keys(candidate).sort()).toEqual([
      "confidence",
      "coreId",
      "matchStrength",
      "videoVariantId",
    ])
  })

  it("caps single-modality evidence below high confidence without visual anchor agreement", () => {
    expect(
      fuseRankedCandidates([
        {
          coreId: "core-audio",
          videoVariantId: "variant-audio",
          audioScore: 0.99,
        },
      ]),
    ).toEqual([
      {
        coreId: "core-audio",
        videoVariantId: "variant-audio",
        confidence: 0.84,
        matchStrength: "medium",
      },
    ])
  })
})
