import { describe, expect, it } from "vitest"
import {
  conversionManifestDigest,
  validateConversionManifest,
  type ConversionManifest,
} from "./legacy-candidate-trace-conversion.service"

function testConversionHolds() {
  return {
    qualitySelectorSha256: "a".repeat(64),
    qualityRunIds: Array.from({ length: 64 }, (_, i) => `quality-${i}`),
    activeInvestigationRunIds: ["investigation"],
  }
}

function manifest(): ConversionManifest {
  const body = {
    version: 1 as const,
    targetDatabaseHash: "b".repeat(64),
    createdBefore: "2026-09-14T00:00:00Z",
    frozenAt: "2026-09-28T00:00:00Z",
    holds: testConversionHolds(),
    maxEncodedBytes: 4 * 1024 * 1024,
    candidates: [
      { runId: "pilot", fingerprint: "c".repeat(32), rows: 7, bytes: 2000 },
    ],
  }
  return { ...body, digest: conversionManifestDigest(body) }
}
function resign(m: ConversionManifest) {
  const { digest: previousDigest, ...body } = m
  expect(previousDigest).toMatch(/^[a-f0-9]{64}$/)
  m.digest = conversionManifestDigest(body)
  return m
}

describe("conversion manifest safety", () => {
  it("accepts a bounded frozen pilot", () => {
    expect(() => validateConversionManifest(manifest())).not.toThrow()
  })
  it("rejects digest changes, held runs, missing quality holds and excessive row/byte counts", () => {
    const changed = manifest()
    changed.candidates[0].bytes++
    expect(() => validateConversionManifest(changed)).toThrow()
    const held = manifest()
    held.candidates[0].runId = "quality-0"
    expect(() => validateConversionManifest(resign(held))).toThrow()
    const missing = manifest()
    missing.holds.qualityRunIds.pop()
    expect(() => validateConversionManifest(resign(missing))).toThrow()
    const bytes = manifest()
    bytes.maxEncodedBytes = 100
    expect(() => validateConversionManifest(resign(bytes))).toThrow()
    const rows = manifest()
    rows.candidates = Array.from({ length: 10 }, (_, i) => ({
      ...rows.candidates[0],
      runId: `r${i}`,
      rows: 448,
    }))
    expect(() => validateConversionManifest(resign(rows))).toThrow()
    const fresh = manifest()
    fresh.createdBefore = "2026-09-27T00:00:00Z"
    expect(() => validateConversionManifest(resign(fresh))).toThrow()
  })
})
