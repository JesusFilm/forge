import { describe, expect, it } from "vitest"
import {
  buildInitialTranscriptionRoutingReport,
  getTranscriptionRoutingReport,
  getUnresolvedElevenLabsFailureReason,
  hasUnresolvedElevenLabsFailure,
  setTranscriptionRoutingReport,
} from "@/lib/transcription-routing-report"

describe("transcription routing report", () => {
  it("builds an initial report with source input metadata", () => {
    expect(
      buildInitialTranscriptionRoutingReport({
        sourceInputUrl:
          "https://user:secret@cdn.example.com/video.mp4?token=123#operator-note",
      }),
    ).toEqual({
      sourceInputUrl: "https://cdn.example.com/video.mp4",
      sourceInputHost: "cdn.example.com",
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
      sourceInputHost: "cdn.example.com",
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

  it("does not persist raw source input urls", () => {
    const artifacts = setTranscriptionRoutingReport(
      {},
      {
        sourceInputUrl:
          "https://user:secret@cdn.example.com/video.mp4?token=123#note",
        attempts: [],
      },
    )
    const persistedRouting = artifacts.transcriptionRouting

    expect(persistedRouting.kind).toBe("metadata")
    if (persistedRouting.kind !== "metadata") return

    const persistedPayload = JSON.stringify(persistedRouting.data)
    expect(persistedPayload).not.toContain("user:secret")
    expect(persistedPayload).not.toContain("token=123")
    expect(persistedPayload).not.toContain("#note")
    expect(persistedRouting.data).toMatchObject({
      sourceInputUrl: "https://cdn.example.com/video.mp4",
      sourceInputHost: "cdn.example.com",
    })
    expect(getTranscriptionRoutingReport(artifacts)).toEqual({
      sourceInputUrl: "https://cdn.example.com/video.mp4",
      sourceInputHost: "cdn.example.com",
      attempts: [],
    })
  })

  it("does not persist raw source input hosts", () => {
    const artifacts = setTranscriptionRoutingReport(
      {},
      {
        sourceInputHost:
          "https://user:secret@host.example.com/private/video.mp4?token=123#note",
        attempts: [],
      },
    )
    const persistedRouting = artifacts.transcriptionRouting

    expect(persistedRouting.kind).toBe("metadata")
    if (persistedRouting.kind !== "metadata") return

    const persistedPayload = JSON.stringify(persistedRouting.data)
    expect(persistedPayload).not.toContain("secret")
    expect(persistedPayload).not.toContain("token=123")
    expect(persistedPayload).not.toContain("/private/video.mp4")
    expect(persistedRouting.data).toMatchObject({
      sourceInputHost: "host.example.com",
    })
    expect(persistedRouting.data).not.toHaveProperty("sourceInputUrl")
    expect(getTranscriptionRoutingReport(artifacts)).toEqual({
      sourceInputHost: "host.example.com",
      attempts: [],
    })
  })

  it("falls back to source input url when source input host is malformed", () => {
    const artifacts = setTranscriptionRoutingReport(
      {},
      {
        sourceInputHost: "internal/path?token=123",
        sourceInputUrl:
          "https://user:secret@cdn.example.com/video.mp4?token=123#note",
        attempts: [],
      },
    )

    expect(getTranscriptionRoutingReport(artifacts)).toEqual({
      sourceInputUrl: "https://cdn.example.com/video.mp4",
      sourceInputHost: "cdn.example.com",
      attempts: [],
    })
  })

  it("keeps bare source input hosts with ports", () => {
    const artifacts = setTranscriptionRoutingReport(
      {},
      {
        sourceInputHost: "cdn.example.com:8443",
        attempts: [],
      },
    )

    expect(getTranscriptionRoutingReport(artifacts)).toEqual({
      sourceInputHost: "cdn.example.com:8443",
      attempts: [],
    })
  })

  it("reads legacy raw source input urls as sanitized url and host-only provenance", () => {
    expect(
      getTranscriptionRoutingReport({
        transcriptionRouting: {
          kind: "metadata",
          data: {
            sourceInputUrl:
              "https://user:secret@cdn.example.com/video.mp4?token=123#note",
            attempts: [],
          },
        },
      }),
    ).toEqual({
      sourceInputUrl: "https://cdn.example.com/video.mp4",
      sourceInputHost: "cdn.example.com",
      attempts: [],
    })
  })

  it("reads legacy raw source input hosts as host-only provenance", () => {
    expect(
      getTranscriptionRoutingReport({
        transcriptionRouting: {
          kind: "metadata",
          data: {
            sourceInputHost:
              "https://user:secret@host.example.com/private/video.mp4?token=123#note",
            attempts: [],
          },
        },
      }),
    ).toEqual({
      sourceInputHost: "host.example.com",
      attempts: [],
    })
  })

  it("ignores legacy malformed source input hosts", () => {
    expect(
      getTranscriptionRoutingReport({
        transcriptionRouting: {
          kind: "metadata",
          data: {
            sourceInputHost: "internal/path?token=123",
            attempts: [],
          },
        },
      }),
    ).toBeUndefined()
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
