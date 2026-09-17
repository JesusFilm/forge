import { describe, expect, it, vi } from "vitest"

import { loadOperatorAssignmentEvidence } from "./operator-assignment-data"

describe("operator assignment evidence loader", () => {
  it("loads only the fixed named evidence routes with bounded private requests", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/video-context")) {
          return Response.json({
            status: "ready",
            playbackId: "playback-1",
            playbackUrl: "https://stream.mux.com/playback-1.m3u8",
            durationSeconds: 120,
            clip: { startSeconds: 10, endSeconds: 20 },
          })
        }
        return new Response("WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nHello")
      },
    )

    const result = await loadOperatorAssignmentEvidence(
      "assignment-safe",
      fetchMock,
    )

    expect(result.status).toBe("ready")
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/subtitle-lab/assignments/assignment-safe/operator-artifacts/source",
      "/api/subtitle-lab/assignments/assignment-safe/operator-artifacts/reference",
      "/api/subtitle-lab/assignments/assignment-safe/operator-artifacts/candidate",
      "/api/subtitle-lab/assignments/assignment-safe/operator-artifacts/video-context",
    ])
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.cache === "no-store"),
    ).toBe(true)
  })

  it("does not fetch an invalid assignment identity", async () => {
    const fetchMock = vi.fn()
    const result = await loadOperatorAssignmentEvidence("bad/id", fetchMock)

    expect(result).toEqual({ status: "not-found" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a response larger than the evidence ceiling", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("too large", { headers: { "content-length": "2000000" } }),
    )
    const result = await loadOperatorAssignmentEvidence(
      "assignment-safe",
      fetchMock,
    )

    expect(result.status).toBe("error")
  })
})
