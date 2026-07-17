import { describe, expect, it } from "vitest"
import {
  buildShortsMetadataArtifact,
  getShortsReport,
  mergeShortsReport,
  readShortsReport,
  SHORTS_ARTIFACT_KEY,
} from "@/lib/shorts-report"
import type { ShortsJobReport } from "@/types/job"

const NOW = () => new Date("2026-06-11T12:00:00.000Z")

function buildReport(
  overrides: Partial<ShortsJobReport> = {},
): ShortsJobReport {
  return {
    domain: "shorts",
    phase: "ready_for_review",
    annotation: null,
    hasAudio: true,
    clipDurationSec: 42.5,
    captionsCount: 87,
    draftVersion: 1,
    lastRenderedDraftVersion: null,
    lastRenderedPropsHash: null,
    output: { muxAssetId: null, playbackId: null, ready: false },
    updatedAt: "2026-06-11T11:00:00.000Z",
    ...overrides,
  }
}

describe("buildShortsMetadataArtifact / getShortsReport", () => {
  it("round-trips a report through the metadata artifact entry", () => {
    const report = buildReport()
    const manifest = buildShortsMetadataArtifact(report)

    expect(manifest[SHORTS_ARTIFACT_KEY]).toMatchObject({ kind: "metadata" })
    expect(getShortsReport(manifest)).toEqual(report)
  })

  it("returns null for a missing or non-metadata entry", () => {
    expect(getShortsReport({})).toBeNull()
    expect(
      getShortsReport({ [SHORTS_ARTIFACT_KEY]: { kind: "downloadable" } }),
    ).toBeNull()
  })

  it("returns null for a wrong domain or unknown phase", () => {
    expect(
      getShortsReport({
        [SHORTS_ARTIFACT_KEY]: {
          kind: "metadata",
          data: { domain: "smart_crop", phase: "completed" },
        },
      }),
    ).toBeNull()
    expect(
      getShortsReport({
        [SHORTS_ARTIFACT_KEY]: {
          kind: "metadata",
          data: { domain: "shorts", phase: "exploded" },
        },
      }),
    ).toBeNull()
  })

  it("normalizes malformed optional fields instead of failing", () => {
    const parsed = getShortsReport({
      [SHORTS_ARTIFACT_KEY]: {
        kind: "metadata",
        data: {
          domain: "shorts",
          phase: "preparing",
          hasAudio: "yes",
          clipDurationSec: "42",
          draftVersion: -3,
          output: { muxAssetId: 7, ready: "true" },
        },
      },
    })

    expect(parsed).toEqual({
      domain: "shorts",
      phase: "preparing",
      annotation: null,
      hasAudio: null,
      clipDurationSec: null,
      captionsCount: null,
      draftVersion: 0,
      lastRenderedDraftVersion: null,
      lastRenderedPropsHash: null,
      output: { muxAssetId: null, playbackId: null, ready: false },
      updatedAt: new Date(0).toISOString(),
    })
  })

  it("readShortsReport reads from a job record's artifacts", () => {
    const report = buildReport()
    expect(
      readShortsReport({ artifacts: buildShortsMetadataArtifact(report) }),
    ).toEqual(report)
    expect(readShortsReport({ artifacts: {} })).toBeNull()
  })
})

describe("mergeShortsReport", () => {
  it("builds a defaulted report from null", () => {
    expect(mergeShortsReport(null, { phase: "preparing" }, NOW)).toEqual({
      domain: "shorts",
      phase: "preparing",
      annotation: null,
      hasAudio: null,
      clipDurationSec: null,
      captionsCount: null,
      draftVersion: 0,
      lastRenderedDraftVersion: null,
      lastRenderedPropsHash: null,
      output: { muxAssetId: null, playbackId: null, ready: false },
      updatedAt: "2026-06-11T12:00:00.000Z",
    })
  })

  it("preserves prepare-written fields when the render phase patches", () => {
    const afterPrepare = mergeShortsReport(
      null,
      {
        phase: "ready_for_review",
        hasAudio: true,
        clipDurationSec: 30,
        captionsCount: 55,
        annotation: null,
        draftVersion: 1,
      },
      NOW,
    )

    const rendering = mergeShortsReport(
      afterPrepare,
      { phase: "rendering" },
      NOW,
    )
    expect(rendering.hasAudio).toBe(true)
    expect(rendering.clipDurationSec).toBe(30)
    expect(rendering.captionsCount).toBe(55)
    expect(rendering.draftVersion).toBe(1)
    expect(rendering.phase).toBe("rendering")
  })

  it("replaces output atomically and stamps updatedAt", () => {
    const base = buildReport({
      output: { muxAssetId: "old", playbackId: "old-pb", ready: false },
    })
    const merged = mergeShortsReport(
      base,
      {
        phase: "completed",
        output: { muxAssetId: "mux-1", playbackId: "pb-1", ready: true },
        lastRenderedDraftVersion: 3,
        lastRenderedPropsHash: "a".repeat(64),
      },
      NOW,
    )

    expect(merged.output).toEqual({
      muxAssetId: "mux-1",
      playbackId: "pb-1",
      ready: true,
    })
    expect(merged.lastRenderedDraftVersion).toBe(3)
    expect(merged.updatedAt).toBe("2026-06-11T12:00:00.000Z")
  })

  it("never lets a patch change the domain", () => {
    const merged = mergeShortsReport(
      buildReport(),
      { phase: "completed" } as never,
      NOW,
    )
    expect(merged.domain).toBe("shorts")
  })

  it("does not mutate the existing report", () => {
    const base = buildReport()
    const snapshot = structuredClone(base)
    mergeShortsReport(base, {
      phase: "completed",
      output: { muxAssetId: "m", playbackId: "p", ready: true },
    })
    expect(base).toEqual(snapshot)
  })
})
