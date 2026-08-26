import { describe, expect, it, vi } from "vitest"

import {
  loadReviewerAssignment,
  loadReviewerQueue,
  reviewerAssignmentSchema,
} from "./subtitle-review-data"

describe("subtitle review BFF data", () => {
  it("distinguishes an upstream queue outage from an empty queue", async () => {
    const unavailable = await loadReviewerQueue(
      null,
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Temporarily unavailable", retryable: true },
            { status: 503 },
          ),
        ),
    )
    const empty = await loadReviewerQueue(
      null,
      vi.fn().mockResolvedValue(Response.json({ nodes: [], nextCursor: null })),
    )

    expect(unavailable).toMatchObject({ status: "error", retryable: true })
    expect(empty).toEqual({ status: "empty" })
  })

  it("requests a bounded cursor without exposing it outside the queue route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        nodes: [],
        nextCursor: null,
      }),
    )

    const result = await loadReviewerQueue("cursor / next", fetchMock)

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/subtitle-lab/assignments?limit=25&after=cursor+%2F+next",
      expect.objectContaining({ cache: "no-store" }),
    )
    expect(result).toEqual({ status: "ready", items: [], nextCursor: null })
  })

  it("loads assignment-derived detail, tracks, and video in one bounded BFF request", async () => {
    const requested: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requested.push(url)
      if (url.endsWith("/assignment-safe/evidence")) {
        return Response.json({
          detail: {
            id: "assignment-safe",
            status: "ASSIGNED",
            kind: "STANDARD",
            round: 1,
            targetLanguageId: "language-private",
            targetLanguageSlug: "spanish-latin-america",
            caseId: "case-private",
            collectionKey: "JESUS_FILM",
            videoId: "video-private",
            editionIdentity: "edition-private",
            clipStartSeconds: 10,
            clipEndSeconds: 20,
            submitted: false,
            postSubmitReceipt: null,
            sourceTrack: {
              label: "SOURCE",
              contentId: "content-private-source",
              mediaType: "text/vtt",
            },
            trackA: {
              label: "A",
              contentId: "content-private-a",
              mediaType: "text/vtt",
            },
            trackB: {
              label: "B",
              contentId: "content-private-b",
              mediaType: "text/vtt",
            },
          },
          sourceVtt: "WEBVTT\n",
          trackAVtt: "WEBVTT\n",
          trackBVtt: "WEBVTT\n",
          video: {
            status: "ready",
            playbackId: "public-playback",
            playbackUrl: "https://stream.mux.com/public-playback.m3u8",
            durationSeconds: 100,
            clip: { startSeconds: 10, endSeconds: 20 },
          },
        })
      }
      return Response.json({ error: "Not found" }, { status: 404 })
    })

    const result = await loadReviewerAssignment("assignment-safe", fetchMock)

    expect(result.status).toBe("ready")
    expect(requested).toEqual([
      "/api/subtitle-lab/assignments/assignment-safe/evidence",
    ])
    expect(requested.join(" ")).not.toContain("content-private")
    expect(requested.join(" ")).not.toContain("video-private")
  })

  it("turns revoked assignment access into a non-specific unavailable state", async () => {
    const result = await loadReviewerAssignment(
      "revoked",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Not found" }, { status: 404 }),
        ),
    )

    expect(result).toEqual({ status: "not-found" })
  })

  it.each(["A", "B"] as const)(
    "rejects a Track %s provenance receipt before the assignment is submitted",
    (referenceTrackLabel) => {
      const candidateTrackLabel = referenceTrackLabel === "A" ? "B" : "A"
      const result = reviewerAssignmentSchema.safeParse({
        id: "assignment-safe",
        status: "ASSIGNED",
        kind: "STANDARD",
        round: 1,
        targetLanguageId: "language-private",
        targetLanguageSlug: "spanish-latin-america",
        caseId: "case-private",
        collectionKey: "JESUS_FILM",
        videoId: "video-private",
        editionIdentity: "edition-private",
        clipStartSeconds: 10,
        clipEndSeconds: 20,
        submitted: false,
        postSubmitReceipt: {
          reviewId: "review-private",
          submittedAt: "2026-08-20T12:00:00.000Z",
          referenceTrackLabel,
          candidateTrackLabel,
          machineAdvisoryRiskFlags: [],
          resolvedModel: "private-model",
          assessmentDigest: "a".repeat(64),
        },
        sourceTrack: {
          label: "SOURCE",
          contentId: "content-private-source",
          mediaType: "text/vtt",
        },
        trackA: {
          label: "A",
          contentId: "content-private-a",
          mediaType: "text/vtt",
        },
        trackB: {
          label: "B",
          contentId: "content-private-b",
          mediaType: "text/vtt",
        },
      })

      expect(result.success).toBe(false)
    },
  )
})
