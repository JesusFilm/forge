import { describe, expect, it } from "vitest"
import {
  DeterministicOfficialMediaSignatureExtractor,
  durationFromVariant,
  type OfficialMediaSignatureVariant,
} from "./media-signature-extraction.js"
import {
  OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
  OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION,
  VISUAL_FRAME_FINGERPRINT_KIND,
} from "./visual-fingerprint.js"

describe("DeterministicOfficialMediaSignatureExtractor", () => {
  it("emits deterministic structural hints from catalog metadata and media bytes", async () => {
    const extractor = new DeterministicOfficialMediaSignatureExtractor()
    const input = {
      variant: variant({
        lengthInMilliseconds: 123_456n,
        durationSeconds: 999,
      }),
      mediaSample: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: "video/mp4",
        sourceMediaHash: "sha256:full:sample",
        rangeStart: 0,
        rangeEnd: 3,
        complete: true,
      },
      algorithmVersion: "official-media-signature-v1",
    }

    const first = await extractor.extract(input)
    const second = await extractor.extract(input)

    expect(first).toEqual(second)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      coreId: "core-video-1",
      videoVariantId: "variant-en",
      signatureType: "STRUCTURAL_HINT",
      algorithmVersion: "official-media-signature-v1",
      offsetMilliseconds: 0,
      durationMilliseconds: 123_456,
      sourceMediaHash: "sha256:full:sample",
      signature: {
        kind: "structural_hint_v1",
        durationMilliseconds: 123_456,
        mediaSourceType: "DOWNLOAD",
        downloadQuality: "1080p",
        width: 1920,
        height: 1080,
        byteSample: {
          byteLength: 4,
          contentType: "video/mp4",
          rangeStart: 0,
          rangeEnd: 3,
          complete: true,
        },
      },
    })
    expect(first[0]?.signature.byteSample).toMatchObject({
      sha256:
        "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
    })
  })

  it.each([
    OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
    OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION,
  ])(
    "emits %s visual frame signatures from real official media frames",
    async (algorithmVersion) => {
      const calls: Array<{
        url: string
        durationMilliseconds?: number | null
      }> = []
      const extractor = new DeterministicOfficialMediaSignatureExtractor({
        visualFrameExtractor: {
          async extractFromUrl(input) {
            calls.push(input)
            return [
              {
                offsetMilliseconds: 5_000,
                durationMilliseconds: null,
                payload: {
                  kind: VISUAL_FRAME_FINGERPRINT_KIND,
                  phash: "ffffffff00000000",
                  frameWidth: 8,
                  frameHeight: 8,
                },
              },
            ]
          },
        },
      })

      const signatures = await extractor.extract({
        variant: variant(),
        sourceMediaUrl: "https://media.example.com/video.mp4",
        algorithmVersion,
      })

      expect(calls).toEqual([
        {
          url: "https://media.example.com/video.mp4",
          mediaSourceType: "DOWNLOAD",
          durationMilliseconds: 120_000,
        },
      ])
      expect(signatures).toEqual([
        expect.objectContaining({
          signatureType: "VISUAL_FRAME",
          algorithmVersion,
          offsetMilliseconds: 5_000,
          durationMilliseconds: null,
          sourceMediaHash: null,
          signature: {
            kind: VISUAL_FRAME_FINGERPRINT_KIND,
            phash: "ffffffff00000000",
            frameWidth: 8,
            frameHeight: 8,
          },
        }),
      ])
    },
  )

  it.each([
    OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
    OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION,
  ])(
    "does not emit v1 structural hints for %s when no visual frames exist",
    async (algorithmVersion) => {
      const signatures =
        await new DeterministicOfficialMediaSignatureExtractor().extract({
          variant: variant(),
          mediaSample: { bytes: new Uint8Array([9]) },
          algorithmVersion,
        })

      expect(signatures).toEqual([])
    },
  )

  it("does not emit audio or visual placeholders without real source data", async () => {
    const signatures =
      await new DeterministicOfficialMediaSignatureExtractor().extract({
        variant: variant(),
        mediaSample: { bytes: new Uint8Array([1, 2, 3]) },
      })

    expect(signatures.map((signature) => signature.signatureType)).toEqual([
      "STRUCTURAL_HINT",
    ])
  })

  it("emits text signatures only for supplied transcript or subtitle segments", async () => {
    const signatures =
      await new DeterministicOfficialMediaSignatureExtractor().extract({
        variant: variant(),
        textSegments: [
          {
            offsetMilliseconds: 10_000,
            durationMilliseconds: 2_500,
            text: "  Peace   be with you  ",
          },
          {
            offsetMilliseconds: 12_500,
            text: "   ",
          },
        ],
      })

    expect(signatures).toEqual([
      expect.objectContaining({
        signatureType: "STRUCTURAL_HINT",
      }),
      expect.objectContaining({
        signatureType: "TEXT_SEGMENT",
        offsetMilliseconds: 10_000,
        durationMilliseconds: 2_500,
        signature: {
          kind: "text_segment_v1",
          text: "Peace be with you",
          tokenCount: 4,
          languageSlug: "english",
        },
      }),
    ])
  })

  it("uses lengthInMilliseconds before durationSeconds for duration hints", () => {
    expect(
      durationFromVariant({
        lengthInMilliseconds: 45_001n,
        durationSeconds: 99,
      }),
    ).toBe(45_001)
    expect(
      durationFromVariant({
        lengthInMilliseconds: null,
        durationSeconds: 99,
      }),
    ).toBe(99_000)
  })

  it("ignores invalid duration metadata", () => {
    expect(
      durationFromVariant({
        lengthInMilliseconds: 0n,
        durationSeconds: 0,
      }),
    ).toBeNull()
    expect(
      durationFromVariant({
        lengthInMilliseconds: -1n,
        durationSeconds: -1,
      }),
    ).toBeNull()
    expect(
      durationFromVariant({
        lengthInMilliseconds: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        durationSeconds: null,
      }),
    ).toBeNull()
  })
})

function variant(
  overrides: Partial<OfficialMediaSignatureVariant> = {},
): OfficialMediaSignatureVariant {
  return {
    coreId: "core-video-1",
    videoVariantId: "variant-en",
    mediaSourceType: "DOWNLOAD",
    durationSeconds: 120,
    lengthInMilliseconds: null,
    downloadQuality: "1080p",
    downloadWidth: 1920,
    downloadHeight: 1080,
    languageSlug: "english",
    locale: "en",
    editionName: "Feature",
    ...overrides,
  }
}
