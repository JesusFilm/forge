import { describe, expect, it } from "vitest"
import {
  getTranscriptionRoutingReport,
  setTranscriptionRoutingReport,
} from "@/lib/transcription-routing-report"

describe("transcription-routing-report", () => {
  it("round-trips persisted routing metadata", () => {
    const artifacts = setTranscriptionRoutingReport(
      {
        transcript: { kind: "downloadable" },
      },
      {
        finalProvider: "mux",
        finalSourceLanguageCode: "en",
        attempts: [
          {
            attemptId: "attempt-1",
            requestedProvider: "automatic",
            resolvedProvider: "mux",
            status: "completed",
            sourceLanguageCode: "en",
            decisionReason: "Automatic routing used Mux.",
            startedAt: "2026-04-11T10:00:00.000Z",
            finishedAt: "2026-04-11T10:00:02.000Z",
          },
        ],
      },
    )

    expect(getTranscriptionRoutingReport(artifacts)).toEqual({
      finalProvider: "mux",
      finalSourceLanguageCode: "en",
      attempts: [
        {
          attemptId: "attempt-1",
          requestedProvider: "automatic",
          resolvedProvider: "mux",
          status: "completed",
          sourceLanguageCode: "en",
          decisionReason: "Automatic routing used Mux.",
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

    expect(persistedRouting.data).not.toHaveProperty("sourceInputUrl")
    const persistedPayload = JSON.stringify(persistedRouting.data)
    expect(persistedPayload).not.toContain("secret")
    expect(persistedPayload).not.toContain("token=123")
    expect(persistedPayload).not.toContain("/video.mp4")
    expect(persistedRouting.data).toMatchObject({
      sourceInputHost: "cdn.example.com",
    })
    expect(getTranscriptionRoutingReport(artifacts)).toEqual({
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

  it("reads legacy raw source input urls as host-only provenance", () => {
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
})
