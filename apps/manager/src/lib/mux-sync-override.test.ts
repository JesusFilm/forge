import { describe, expect, it } from "vitest"
import {
  canRetryMuxSyncOverride,
  isStaleOverridePending,
  MUX_OVERRIDE_RESUME_AFTER_MS,
} from "@/lib/mux-sync-override"
import type { MuxSyncComparison } from "@/types/job"

function buildComparison(
  overrides: Partial<MuxSyncComparison> = {},
): MuxSyncComparison {
  return {
    artifactKey: "subtitles-fr",
    targetLanguage: "fr",
    muxTargetType: "text_track",
    muxTargetKey: "fr",
    status: "skipped_existing_mux_data",
    explanation: "Mux already has fr subtitles",
    canOverride: true,
    updatedAt: "2026-04-10T12:00:00.000Z",
    ...overrides,
  }
}

describe("mux-sync-override helpers", () => {
  it("treats fresh override_pending entries as non-retryable", () => {
    const comparison = buildComparison({
      status: "override_pending",
      canOverride: false,
    })

    expect(
      isStaleOverridePending(
        comparison,
        Date.parse("2026-04-10T12:00:00.000Z") +
          MUX_OVERRIDE_RESUME_AFTER_MS -
          1,
      ),
    ).toBe(false)
    expect(
      canRetryMuxSyncOverride(
        comparison,
        Date.parse("2026-04-10T12:00:00.000Z") +
          MUX_OVERRIDE_RESUME_AFTER_MS -
          1,
      ),
    ).toBe(false)
  })

  it("allows retrying stale override_pending entries", () => {
    const comparison = buildComparison({
      status: "override_pending",
      canOverride: false,
    })

    expect(
      isStaleOverridePending(
        comparison,
        Date.parse("2026-04-10T12:00:00.000Z") + MUX_OVERRIDE_RESUME_AFTER_MS,
      ),
    ).toBe(true)
    expect(
      canRetryMuxSyncOverride(
        comparison,
        Date.parse("2026-04-10T12:00:00.000Z") + MUX_OVERRIDE_RESUME_AFTER_MS,
      ),
    ).toBe(true)
  })
})
