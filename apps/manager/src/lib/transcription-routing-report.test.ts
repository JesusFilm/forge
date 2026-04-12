import { describe, expect, it } from "vitest"
import {
  buildInitialTranscriptionRoutingReport,
  getUnresolvedElevenLabsFailureReason,
  getTranscriptionRoutingReport,
  hasUnresolvedElevenLabsFailure,
  setTranscriptionRoutingReport,
} from "@/lib/transcription-routing-report"

describe("transcription routing report", () => {
  it("builds an initial report with source input metadata", () => {
    expect(
      buildInitialTranscriptionRoutingReport({
        sourceInputUrl:
          "https://cdn.example.com/video.mp4?token=123#operator-note",
      }),
    ).toEqual({
      sourceInputUrl: "https://cdn.example.com/video.mp4",
      attempts: [],
    })
  })

  it("round-trips a persisted routing report artifact", () => {
    const artifacts = setTranscriptionRoutingReport(
      {
        transcript: { kind: "downloadable" },
      },
      {
        sourceInputUrl: "https://cdn.example.com/video.mp4",
        finalProvider: "mux",
        finalSourceLanguageCode: "en",
        attempts: [
          {
            attemptId: "attempt-1",
            requestedProvider: "automatic",
            resolvedProvider: "mux",
            status: "completed",
            sourceLanguageCode: "auto",
            decisionReason:
              "Source language was unresolved, so automatic routing used Mux.",
            startedAt: "2026-04-11T10:00:00.000Z",
            finishedAt: "2026-04-11T10:00:02.000Z",
          },
        ],
      },
    )

    expect(getTranscriptionRoutingReport(artifacts)).toEqual({
      sourceInputUrl: "https://cdn.example.com/video.mp4",
      finalProvider: "mux",
      finalSourceLanguageCode: "en",
      attempts: [
        {
          attemptId: "attempt-1",
          requestedProvider: "automatic",
          resolvedProvider: "mux",
          status: "completed",
          sourceLanguageCode: "auto",
          decisionReason:
            "Source language was unresolved, so automatic routing used Mux.",
          startedAt: "2026-04-11T10:00:00.000Z",
          finishedAt: "2026-04-11T10:00:02.000Z",
        },
      ],
    })
  })

  it("redacts source input credentials when reading a persisted routing report artifact", () => {
    const artifacts = setTranscriptionRoutingReport(
      {
        transcript: { kind: "downloadable" },
      },
      {
        sourceInputUrl:
          "https://cdn.example.com/video.mp4?token=123&expires=456#fragment",
        attempts: [],
      },
    )

    expect(getTranscriptionRoutingReport(artifacts)).toEqual({
      sourceInputUrl: "https://cdn.example.com/video.mp4",
      attempts: [],
    })
  })

  it("flags a failed ElevenLabs attempt that never recovered with ElevenLabs", () => {
    const report = {
      finalProvider: "mux" as const,
      fallbackReason: "audio isolation failed",
      attempts: [
        {
          attemptId: "attempt-1",
          requestedProvider: "automatic" as const,
          resolvedProvider: "elevenlabs" as const,
          status: "failed" as const,
          startedAt: "2026-04-11T10:00:00.000Z",
          finishedAt: "2026-04-11T10:00:10.000Z",
          fallbackReason: "audio isolation failed",
        },
        {
          attemptId: "attempt-2",
          requestedProvider: "automatic" as const,
          resolvedProvider: "mux" as const,
          status: "fallback_completed" as const,
          startedAt: "2026-04-11T10:00:10.000Z",
          finishedAt: "2026-04-11T10:00:20.000Z",
        },
      ],
    }

    expect(hasUnresolvedElevenLabsFailure(report)).toBe(true)
    expect(getUnresolvedElevenLabsFailureReason(report)).toBe(
      "audio isolation failed",
    )
  })

  it("does not flag a report when ElevenLabs eventually succeeds", () => {
    const report = {
      finalProvider: "elevenlabs" as const,
      attempts: [
        {
          attemptId: "attempt-1",
          requestedProvider: "automatic" as const,
          resolvedProvider: "elevenlabs" as const,
          status: "failed" as const,
          startedAt: "2026-04-11T10:00:00.000Z",
          finishedAt: "2026-04-11T10:00:10.000Z",
          fallbackReason: "timeout",
        },
        {
          attemptId: "attempt-2",
          requestedProvider: "elevenlabs" as const,
          resolvedProvider: "elevenlabs" as const,
          status: "completed" as const,
          startedAt: "2026-04-11T10:01:00.000Z",
          finishedAt: "2026-04-11T10:01:12.000Z",
        },
      ],
    }

    expect(hasUnresolvedElevenLabsFailure(report)).toBe(false)
    expect(getUnresolvedElevenLabsFailureReason(report)).toBeUndefined()
  })
})
