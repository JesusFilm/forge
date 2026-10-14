import { afterEach, describe, expect, it, vi } from "vitest"

import { parseManualCatalogCommand } from "./run-manual-subscription-catalog"

afterEach(() => vi.unstubAllEnvs())

const digest = "a".repeat(64)
const cutoff = "2026-10-01T00:00:00.000Z"
function config() {
  return {
    input: {
      invocation: "resume",
      generationId: "generation-one",
      generationInputDigest: digest,
      attemptId: "11111111-1111-4111-8111-111111111111",
      inputCutoff: cutoff,
      initiatingAccountRef: "operator-account-123",
      reviewed: {
        sourceVideoIds: ["video-one"],
        sourceSetDigest: digest,
        selectedCorpusDigest: digest,
        candidatePoolDigest: digest,
      },
      destination: {
        generationId: "generation-one",
        generationInputDigest: digest,
        inputCutoff: cutoff,
        sourceSetDigest: digest,
        selectedCorpusDigest: digest,
        candidatePoolDigest: digest,
        routeMappingDigest: digest,
        sourcePatternTableDigest: digest,
        querySpecDigest: digest,
        propertyId: "320198532",
        propertyTimeZone: "America/New_York",
        qualificationPolicy: "referrer_navigation_v1",
        requestedStart: "2022-08-08",
        requestedEnd: "2026-09-30",
        usableStart: "2022-08-08",
        usableEnd: "2026-09-30",
        requestedCoverageDigest: digest,
        usableCoverageDigest: digest,
      },
      originGenerationId: "origin-one",
      work: { mode: "full" },
    },
    concurrency: 4,
    codexExecutable: "/tmp/codex",
    stagingDirectory: "/tmp/staging",
    capacityProbe: { executable: "/tmp/capacity", args: [] },
  }
}

function parse(value: unknown) {
  vi.stubEnv("CI", "")
  return parseManualCatalogCommand(value, [
    "--config",
    "/tmp/reviewed.json",
    "--execute",
  ])
}

describe("manual subscription catalog command", () => {
  it("accepts an explicit pacing interval and preserves configurations without it", () => {
    expect(parse(config()).minCallStartIntervalMs).toBeUndefined()
    expect(
      parse({ ...config(), minCallStartIntervalMs: 6000 })
        .minCallStartIntervalMs,
    ).toBe(6000)
  })
  it.each([-1, 0.5, 30_001, NaN, Infinity])(
    "rejects invalid pacing interval %s",
    (interval) => {
      expect(() =>
        parse({ ...config(), minCallStartIntervalMs: interval }),
      ).toThrow()
    },
  )
  it("requires an explicit local execution flag before parsing operator input", () => {
    expect(() =>
      parseManualCatalogCommand({}, ["--config", "/tmp/reviewed.json"]),
    ).toThrow("manual_operator_only")
    expect(() =>
      parseManualCatalogCommand({}, ["--config", "reviewed.json", "--execute"]),
    ).toThrow("manual_operator_only")
  })
})
