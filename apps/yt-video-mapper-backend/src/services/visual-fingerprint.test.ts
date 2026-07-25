import { describe, expect, it } from "vitest"
import {
  OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
  OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION,
  VISUAL_FRAME_FINGERPRINT_KIND,
  VisualFingerprintError,
  averageHashGrayscaleFrame,
  hammingDistance,
  isVisualMediaSignatureAlgorithmVersion,
  parseVisualFrameFingerprintPayload,
  visualFingerprintSimilarity,
} from "./visual-fingerprint.js"

describe("visual fingerprints", () => {
  it("recognizes only v2 and v3 as visual media signature versions", () => {
    expect(
      isVisualMediaSignatureAlgorithmVersion(
        OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
      ),
    ).toBe(true)
    expect(
      isVisualMediaSignatureAlgorithmVersion(
        OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION,
      ),
    ).toBe(true)
    expect(
      isVisualMediaSignatureAlgorithmVersion("official-media-signature-v1"),
    ).toBe(false)
  })

  it("hashes identical grayscale frames deterministically", () => {
    const frame = Buffer.alloc(64, 128)

    expect(averageHashGrayscaleFrame(frame, 8, 8)).toBe(
      averageHashGrayscaleFrame(frame, 8, 8),
    )
    expect(averageHashGrayscaleFrame(frame, 8, 8)).toBe("0000000000000000")
  })

  it("orders visual hashes by Hamming distance", () => {
    const dark = averageHashGrayscaleFrame(Buffer.alloc(64, 0), 8, 8)
    const split = averageHashGrayscaleFrame(
      Buffer.concat([Buffer.alloc(32, 255), Buffer.alloc(32, 0)]),
      8,
      8,
    )
    const close = "f0ffffff00000000"

    expect(split).toBe("ffffffff00000000")
    expect(hammingDistance(split, close)).toBeLessThan(
      hammingDistance(split, dark),
    )
    expect(visualFingerprintSimilarity(split, close)).toBeGreaterThan(
      visualFingerprintSimilarity(split, dark),
    )
  })

  it("rejects invalid frame dimensions and byte counts", () => {
    expect(() => averageHashGrayscaleFrame(Buffer.alloc(63), 8, 8)).toThrow(
      "Expected 64 grayscale bytes",
    )
    expect(() => averageHashGrayscaleFrame(Buffer.alloc(63), 8, 8)).toThrow(
      VisualFingerprintError,
    )
    try {
      averageHashGrayscaleFrame(Buffer.alloc(63), 8, 8)
      throw new Error("Expected visual fingerprint validation to fail")
    } catch (error) {
      expect(error).toMatchObject({
        code: "visual_fingerprint_invalid_frame_bytes",
      })
    }
    expect(() => averageHashGrayscaleFrame(Buffer.alloc(64), 0, 8)).toThrow(
      "Frame dimensions must be positive integers",
    )
  })

  it("parses only valid v2 visual payloads", () => {
    expect(
      parseVisualFrameFingerprintPayload({
        kind: VISUAL_FRAME_FINGERPRINT_KIND,
        phash: "FFFFFFFF00000000",
        frameWidth: 8,
        frameHeight: 8,
      }),
    ).toEqual({
      kind: VISUAL_FRAME_FINGERPRINT_KIND,
      phash: "ffffffff00000000",
      frameWidth: 8,
      frameHeight: 8,
    })

    expect(
      parseVisualFrameFingerprintPayload({
        kind: VISUAL_FRAME_FINGERPRINT_KIND,
        phash: "not-hex",
        frameWidth: 8,
        frameHeight: 8,
      }),
    ).toBeUndefined()
  })
})
