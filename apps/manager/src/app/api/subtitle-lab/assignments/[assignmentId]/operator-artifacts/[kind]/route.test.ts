import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  assignmentMock,
  locatorMock,
  readArtifactMock,
  videoContextMock,
  muxPlaybackMock,
  operatorAuthMock,
} = vi.hoisted(() => ({
  assignmentMock: vi.fn(),
  locatorMock: vi.fn(),
  readArtifactMock: vi.fn(),
  videoContextMock: vi.fn(),
  muxPlaybackMock: vi.fn(),
  operatorAuthMock: vi.fn(),
}))

vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({
      getOperatorAssignment: assignmentMock,
      getVideoPlaybackCandidate: videoContextMock,
      operatorTrackLocator: locatorMock,
    })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-lab-route", () => ({
  requireSubtitleLabOperator: operatorAuthMock,
  privateNoStoreJson: (value: unknown, init?: ResponseInit) =>
    Response.json(value, {
      ...init,
      headers: { "cache-control": "private, no-store", ...init?.headers },
    }),
  subtitleLabNotFound: () =>
    Response.json(
      { error: "Not found" },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    ),
}))
vi.mock("@/services/subtitle-eval-artifacts", () => ({
  readVerifiedSubtitleEvalArtifact: readArtifactMock,
}))
vi.mock("@/services/mux", () => ({
  getMuxAssetPlayback: muxPlaybackMock,
  getPlaybackUrl: (playbackId: string) =>
    `https://stream.mux.com/${playbackId}.m3u8`,
}))

import { NextResponse } from "next/server"

import { GET } from "./route"

const assignment = {
  id: "assignment-1",
  videoId: "video-1",
  editionIdentity: "edition-1",
  clipStartSeconds: 12,
  clipEndSeconds: 24,
  sourceTrack: {
    label: "SOURCE",
    contentId: "a".repeat(64),
    mediaType: "text/vtt",
  },
  referenceTrack: {
    label: "REFERENCE",
    contentId: "b".repeat(64),
    mediaType: "text/vtt",
  },
  candidateTrack: {
    label: "CANDIDATE",
    contentId: "c".repeat(64),
    mediaType: "text/vtt",
  },
}
const locator = {
  objectKey: `subtitle-eval/v1/candidate/${"c".repeat(64)}.vtt`,
  sha256: "c".repeat(64),
  byteLength: "7",
  mediaType: "text/vtt",
}

describe("operator assignment evidence BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operatorAuthMock.mockResolvedValue({ id: "operator-1" })
    assignmentMock.mockResolvedValue(assignment)
    locatorMock.mockResolvedValue(locator)
    readArtifactMock.mockResolvedValue(new TextEncoder().encode("WEBVTT\n"))
    videoContextMock.mockResolvedValue({
      muxAssetId: "mux-asset-1",
      playbackId: "public-playback-1",
      durationSeconds: 120,
    })
    muxPlaybackMock.mockResolvedValue({
      assetId: "mux-asset-1",
      status: "ready",
      duration: 120,
      publicPlaybackId: "public-playback-1",
    })
  })

  it("does not disclose assignment evidence to a non-operator", async () => {
    operatorAuthMock.mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    )

    const response = await GET(new Request("https://manager.example/api"), {
      params: Promise.resolve({
        assignmentId: "assignment-1",
        kind: "candidate",
      }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
    expect(assignmentMock).not.toHaveBeenCalled()
    expect(locatorMock).not.toHaveBeenCalled()
    expect(readArtifactMock).not.toHaveBeenCalled()
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("derives named human-reference bytes from fresh operator detail", async () => {
    const response = await GET(
      new Request(
        "https://manager.example/api?contentId=browser-controlled&objectKey=secret",
      ),
      {
        params: Promise.resolve({
          assignmentId: "assignment-1",
          kind: "reference",
        }),
      },
    )

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toBe("WEBVTT\n")
    expect(locatorMock).toHaveBeenCalledWith("assignment-1", "b".repeat(64))
    expect(response.headers.get("content-type")).toBe("text/vtt; charset=utf-8")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(body).not.toContain("objectKey")
  })

  it("derives ready public video from the frozen edition and exact Mux asset", async () => {
    const response = await GET(new Request("https://manager.example/api"), {
      params: Promise.resolve({
        assignmentId: "assignment-1",
        kind: "video-context",
      }),
    })

    expect(response.status).toBe(200)
    expect(videoContextMock).toHaveBeenCalledWith("video-1", "edition-1")
    expect(await response.json()).toEqual({
      status: "ready",
      playbackId: "public-playback-1",
      playbackUrl: "https://stream.mux.com/public-playback-1.m3u8",
      durationSeconds: 120,
      clip: { startSeconds: 12, endSeconds: 24 },
    })
  })

  it.each([
    ["preparing", { status: "preparing" }],
    ["errored", { status: "errored" }],
    ["signed only", { publicPlaybackId: null }],
    ["wrong playback", { publicPlaybackId: "other" }],
    ["wrong asset", { assetId: "other" }],
  ])("blocks video when Mux is %s", async (_label, override) => {
    muxPlaybackMock.mockResolvedValueOnce({
      assetId: "mux-asset-1",
      status: "ready",
      duration: 120,
      publicPlaybackId: "public-playback-1",
      ...override,
    })

    const response = await GET(new Request("https://manager.example/api"), {
      params: Promise.resolve({
        assignmentId: "assignment-1",
        kind: "video-context",
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: "blocked",
      reason: "PLAYBACK_UNAVAILABLE",
    })
  })

  it.each([
    [
      "missing assignment",
      async () => assignmentMock.mockResolvedValueOnce(null),
    ],
    ["missing locator", async () => locatorMock.mockResolvedValueOnce(null)],
    [
      "integrity failure",
      async () =>
        readArtifactMock.mockRejectedValueOnce(new Error("digest mismatch")),
    ],
  ])("uses the same private 404 for %s", async (_label, arrange) => {
    await arrange()
    const response = await GET(new Request("https://manager.example/api"), {
      params: Promise.resolve({
        assignmentId: "assignment-1",
        kind: "candidate",
      }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
})
