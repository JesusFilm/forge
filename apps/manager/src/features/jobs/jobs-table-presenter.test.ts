import { describe, expect, it } from "vitest"
import {
  getDisplayedJobStatus,
  getProgressSummary,
  getSourceTitle,
  getStepDotSymbol,
} from "@/features/jobs/jobs-table-presenter"
import type { JobRecord } from "@/types/job"

function buildJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "playback-1",
    languages: [],
    options: {},
    status: "pending",
    retries: 0,
    createdAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

describe("getSourceTitle", () => {
  it("combines collection and media titles when both are present", () => {
    expect(
      getSourceTitle(
        buildJobRecord({
          sourceCollectionTitle: "How Did We Get Here? (Episode 1)",
          sourceMediaTitle: "1.1 Has The Universe Always Existed?",
        }),
      ),
    ).toBe(
      "How Did We Get Here? (Episode 1) — 1.1 Has The Universe Always Existed?",
    )
  })

  it("falls back to the media title when there is no collection title", () => {
    expect(
      getSourceTitle(
        buildJobRecord({
          sourceMediaTitle: "Standalone clip",
        }),
      ),
    ).toBe("Standalone clip")
  })
})

describe("displayed job status", () => {
  it("treats a completed Mux fallback after ElevenLabs failure as failed", () => {
    const job = buildJobRecord({
      status: "completed",
      artifacts: {
        transcriptionRouting: {
          kind: "metadata",
          data: {
            finalProvider: "mux",
            fallbackReason: "scribe timeout",
            attempts: [
              {
                attemptId: "attempt-1",
                requestedProvider: "automatic",
                resolvedProvider: "elevenlabs",
                status: "failed",
                startedAt: "2026-04-11T10:00:00.000Z",
                finishedAt: "2026-04-11T10:00:08.000Z",
                fallbackReason: "scribe timeout",
              },
              {
                attemptId: "attempt-2",
                requestedProvider: "automatic",
                resolvedProvider: "mux",
                status: "fallback_completed",
                startedAt: "2026-04-11T10:00:08.000Z",
                finishedAt: "2026-04-11T10:00:20.000Z",
              },
            ],
          },
        },
      },
      steps: [
        {
          name: "transcription",
          status: "completed",
          retries: 0,
        },
      ],
    })

    expect(getDisplayedJobStatus(job)).toBe("failed")
    expect(getProgressSummary(job)).toBe("Failed at Transcription")
  })

  it("formats Shorts Studio progress from the current workflow step", () => {
    const job = buildJobRecord({
      status: "running",
      currentStep: "shorts_render",
      options: {
        shorts: {
          assetId: "mux-1-short-1234abcd",
          sourceMuxAssetId: "mux-1",
          sourcePlaybackId: "playback-1",
          clip: { startSec: 10, endSec: 40 },
          language: { bcp47: "en", whisper: "en" },
        },
      },
      steps: [
        { name: "shorts_prepare", status: "completed", retries: 0 },
        { name: "shorts_render", status: "running", retries: 0 },
        { name: "shorts_mux_output", status: "pending", retries: 0 },
      ],
    })

    expect(getProgressSummary(job)).toBe("In progress at Shorts Render")
  })
})

describe("getStepDotSymbol", () => {
  it("uses the skipped symbol for placeholder workflow steps", () => {
    expect(getStepDotSymbol("skipped")).toBe("−")
  })
})
