import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  bootstrapReviewSession,
  exchangeLaunchCode,
  saveReviewedVtt,
} from "@/lib/manager-client"

beforeEach(() => {
  process.env.NEXT_PUBLIC_MANAGER_BASE_URL = "http://localhost:3002"
})

describe("exchangeLaunchCode", () => {
  it("posts the launch code and returns an edit session token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          editToken: "edit-token",
          expiresAt: "2026-04-13T22:00:00.000Z",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    )

    await expect(
      exchangeLaunchCode({
        jobId: "job-123",
        launchCode: "launch-abc",
        fetchImpl,
      }),
    ).resolves.toEqual({
      editSessionToken: "edit-token",
      expiresAt: "2026-04-13T22:00:00.000Z",
    })
  })

  it("maps a forbidden exchange to a typed error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
        },
      }),
    )

    await expect(
      exchangeLaunchCode({
        jobId: "job-123",
        launchCode: "launch-abc",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
      message: "nope",
    })
  })

  it("maps transport failures to a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"))

    await expect(
      exchangeLaunchCode({
        jobId: "job-123",
        launchCode: "launch-abc",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      kind: "network",
      message: "Manager request failed",
    })
  })
})

describe("bootstrapReviewSession", () => {
  it("maps the Manager bootstrap payload into editor-ready media fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: "job-123",
          sourceArtifactKey: "subtitles-fr",
          baseArtifactKey: "subtitles-fr",
          targetLanguage: "fr",
          media: {
            muxPlaybackId: "playback-123",
            muxAssetId: "asset-123",
          },
          vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBonjour\n",
          baseFingerprint: "sha256:base",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    )

    await expect(
      bootstrapReviewSession({
        jobId: "job-123",
        editSessionToken: "edit-token",
        fetchImpl,
      }),
    ).resolves.toEqual({
      jobId: "job-123",
      sourceArtifactKey: "subtitles-fr",
      baseArtifactKey: "subtitles-fr",
      targetLanguage: "fr",
      muxPlaybackId: "playback-123",
      mediaUrl: "https://player.mux.com/playback-123",
      vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBonjour\n",
      baseArtifactFingerprint: "sha256:base",
    })
  })

  it("surfaces missing media as a not found error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "missing" }), {
        status: 404,
        headers: {
          "content-type": "application/json",
        },
      }),
    )

    await expect(
      bootstrapReviewSession({
        jobId: "job-123",
        editSessionToken: "edit-token",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      kind: "not_found",
      status: 404,
      message: "missing",
    })
  })
})

describe("saveReviewedVtt", () => {
  it("maps validation failures to a typed error and preserves the draft", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid VTT" }), {
        status: 422,
        headers: {
          "content-type": "application/json",
        },
      }),
    )

    await expect(
      saveReviewedVtt({
        jobId: "job-123",
        editSessionToken: "edit-token",
        vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n",
        baseArtifactFingerprint: "sha256:base",
        clientSaveId: "save-1",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      kind: "validation",
      status: 422,
      message: "invalid VTT",
    })
  })

  it("passes the idempotency key with the save body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: "job-123",
          status: "saved",
          revision: 2,
          artifactKey: "subtitles-ru-reviewed-r0002",
          reviewedArtifactKey: "subtitles-ru-reviewed-r0002",
          contentFingerprint: "sha256:content",
          baseArtifactFingerprint: "sha256:base",
          savedAt: "2026-04-13T19:00:00.000Z",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    )

    await saveReviewedVtt({
      jobId: "job-123",
      editSessionToken: "edit-token",
      vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n",
      baseArtifactFingerprint: "sha256:base",
      clientSaveId: "save-1",
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3002/api/jobs/job-123/subtitle-reviews/revisions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n",
          baseArtifactFingerprint: "sha256:base",
          clientSaveId: "save-1",
        }),
      }),
    )
  })
})
