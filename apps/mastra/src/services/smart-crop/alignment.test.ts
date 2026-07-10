import { describe, expect, it } from "vitest"

import {
  SMART_CROP_GATE_DEFAULTS,
  _internals,
  alignFingerprints,
  type SmartCropFingerprintForAlignment,
} from "./alignment"

const HASH_A = "0000000000000000"
const HASH_B = "ffffffffffffffff"
const HASH_C = "00000000ffffffff"
const HASH_D = "ffffffff00000000"
const HASH_TITLE_CARD = "f0f0f0f0f0f0f0f0"

type ShotSpec = {
  id: string
  start: number
  end: number
  hashes?: string[]
}

function fingerprint(
  durationSeconds: number,
  shots: ShotSpec[],
): SmartCropFingerprintForAlignment {
  return {
    source: { durationSeconds },
    shots: shots.map((shot) => ({
      shotId: shot.id,
      start: shot.start,
      end: shot.end,
      representativeHashes: (shot.hashes ?? []).map((dhash, index) => ({
        time: shot.start + index,
        dhash,
      })),
    })),
  }
}

describe("smart crop alignment", () => {
  it("computes 64-bit hamming distance from dhash hex strings", () => {
    expect(_internals.hammingDistance64(HASH_A, HASH_A)).toBe(0)
    expect(_internals.hammingDistance64(HASH_A, HASH_B)).toBe(64)
    expect(_internals.hammingDistance64(HASH_A, HASH_C)).toBe(32)
  })

  it("treats missing representative hashes as neutral similarity", () => {
    const withHash = {
      shotId: "shot_00001",
      start: 0,
      end: 10,
      representativeHashes: [{ time: 5, dhash: HASH_A }],
    }
    const withoutHash = { shotId: "shot_00002", start: 0, end: 10 }

    expect(_internals.hashSimilarity(withoutHash, withHash)).toBe(0.5)
    expect(_internals.hashSimilarity(withHash, withHash)).toBe(1)
  })

  it("uses tier 1 identical-duration mapping for near-identical durations", () => {
    const canonical = fingerprint(100, [
      { id: "shot_00001", start: 0, end: 50, hashes: [HASH_A] },
      { id: "shot_00002", start: 50, end: 100, hashes: [HASH_B] },
    ])
    const localized = fingerprint(100.3, [
      { id: "shot_00001", start: 0, end: 50.1, hashes: [HASH_A] },
      { id: "shot_00002", start: 50.1, end: 100.3, hashes: [HASH_B] },
    ])

    const map = alignFingerprints({ canonical, localized })

    expect(map.mappingMethod).toBe("identical-duration")
    expect(map.segments).toEqual([
      {
        canonicalShotId: "shot_00001",
        canonicalStart: 0,
        canonicalEnd: 50,
        localizedStart: 0,
        localizedEnd: 50.1,
        confidence: 0.99,
      },
      {
        canonicalShotId: "shot_00002",
        canonicalStart: 50,
        canonicalEnd: 100,
        localizedStart: 50.1,
        localizedEnd: 100.3,
        confidence: 0.99,
      },
    ])
    expect(map.overallConfidence).toBe(0.99)
    expect(map.unmappedDurationPercent).toBe(0)
    expect(map.maxConsecutiveUnmappedSeconds).toBe(0)
    expect(map.gate).toEqual({
      passed: true,
      failures: [],
      config: { ...SMART_CROP_GATE_DEFAULTS },
    })
    expect(map.warnings).toEqual([])
  })

  it("maps cleanly stretched localizations through tier 2 shot-sequence", () => {
    const canonical = fingerprint(22, [
      { id: "shot_00001", start: 0, end: 10, hashes: [HASH_A] },
      { id: "shot_00002", start: 10, end: 22, hashes: [HASH_B] },
    ])
    const localized = fingerprint(23, [
      { id: "shot_00001", start: 0, end: 10.5, hashes: [HASH_A] },
      { id: "shot_00002", start: 10.5, end: 23, hashes: [HASH_B] },
    ])

    const map = alignFingerprints({ canonical, localized })

    expect(map.mappingMethod).toBe("shot-sequence")
    expect(map.segments).toHaveLength(2)
    expect(map.segments[0]!.confidence).toBeCloseTo(0.97619, 4)
    expect(map.segments[1]!.confidence).toBeCloseTo(0.98, 4)
    expect(map.overallConfidence).toBeGreaterThan(0.92)
    expect(map.unmappedDurationPercent).toBe(0)
    expect(map.gate.passed).toBe(true)
  })

  it("drops a replaced title-card shot to unmapped and fails the gates", () => {
    const canonical = fingerprint(60, [
      { id: "shot_00001", start: 0, end: 10, hashes: [HASH_A] },
      { id: "shot_00002", start: 10, end: 40, hashes: [HASH_B] },
      { id: "shot_00003", start: 40, end: 50, hashes: [HASH_C] },
      { id: "shot_00004", start: 50, end: 60, hashes: [HASH_D] },
    ])
    // Localized version replaced the long middle shot with a title card of a
    // different duration and visually distinct hashes.
    const localized = fingerprint(61, [
      { id: "shot_00001", start: 0, end: 10, hashes: [HASH_A] },
      { id: "shot_00002", start: 10, end: 41, hashes: [HASH_TITLE_CARD] },
      { id: "shot_00003", start: 41, end: 51, hashes: [HASH_C] },
      { id: "shot_00004", start: 51, end: 61, hashes: [HASH_D] },
    ])

    const map = alignFingerprints({
      canonical,
      localized,
      planShotIds: ["shot_00002", "shot_00003"],
    })

    expect(map.mappingMethod).toBe("shot-sequence")
    expect(map.segments.map((segment) => segment.canonicalShotId)).toEqual([
      "shot_00001",
      "shot_00003",
      "shot_00004",
    ])
    expect(map.unmappedDurationPercent).toBe(50)
    expect(map.maxConsecutiveUnmappedSeconds).toBe(30)
    expect(map.gate.passed).toBe(false)
    expect(map.gate.failures).toEqual([
      "unmapped_duration_above_max",
      "consecutive_unmapped_above_max",
    ])
    expect(map.warnings).toEqual(["plan_shot_unmapped:shot_00002"])
  })

  it("fails the drift gate when per-shot offsets jump above the maximum", () => {
    const canonical = fingerprint(30, [
      { id: "shot_00001", start: 0, end: 10, hashes: [HASH_A] },
      { id: "shot_00002", start: 10, end: 20, hashes: [HASH_B] },
      { id: "shot_00003", start: 20, end: 30, hashes: [HASH_C] },
    ])
    const localized = fingerprint(42, [
      { id: "shot_00001", start: 0, end: 10, hashes: [HASH_A] },
      { id: "shot_00002", start: 16, end: 26, hashes: [HASH_B] },
      { id: "shot_00003", start: 32, end: 42, hashes: [HASH_C] },
    ])

    const map = alignFingerprints({ canonical, localized })

    expect(map.mappingMethod).toBe("shot-sequence")
    expect(map.segments).toHaveLength(3)
    expect(map.overallConfidence).toBe(1)
    expect(map.gate.passed).toBe(false)
    expect(map.gate.failures).toEqual(["timing_drift_above_max"])
  })

  it("lets hash distance decide whether a pair survives the shot gate", () => {
    const canonical = fingerprint(10, [
      { id: "shot_00001", start: 0, end: 10, hashes: [HASH_A] },
    ])
    const farLocalized = fingerprint(12, [
      { id: "shot_00001", start: 0, end: 10, hashes: [HASH_C] },
    ])
    const nearLocalized = fingerprint(12, [
      { id: "shot_00001", start: 0, end: 10, hashes: [HASH_A] },
    ])

    // Same durations, hamming distance 32 -> pair score 0.75 < 0.85 default.
    const farMap = alignFingerprints({ canonical, localized: farLocalized })
    expect(farMap.segments).toEqual([])
    expect(farMap.unmappedDurationPercent).toBe(100)
    expect(farMap.gate.passed).toBe(false)

    const nearMap = alignFingerprints({ canonical, localized: nearLocalized })
    expect(nearMap.segments).toHaveLength(1)
    expect(nearMap.segments[0]!.confidence).toBe(1)
    expect(nearMap.gate.passed).toBe(true)
  })

  it("merges gate overrides over the defaults", () => {
    const canonical = fingerprint(100, [
      { id: "shot_00001", start: 0, end: 100, hashes: [HASH_A] },
    ])
    const localized = fingerprint(100, [
      { id: "shot_00001", start: 0, end: 100, hashes: [HASH_A] },
    ])

    const map = alignFingerprints({
      canonical,
      localized,
      gates: { minOverallConfidence: 0.995 },
    })

    expect(map.mappingMethod).toBe("identical-duration")
    expect(map.gate.config).toEqual({
      ...SMART_CROP_GATE_DEFAULTS,
      minOverallConfidence: 0.995,
    })
    expect(map.gate.failures).toEqual(["overall_confidence_below_min"])
    expect(map.gate.passed).toBe(false)
  })
})
