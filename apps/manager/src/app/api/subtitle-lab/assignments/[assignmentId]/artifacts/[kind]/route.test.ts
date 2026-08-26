import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  reviewerDetailMock,
  locatorMock,
  videoContextMock,
  grantMock,
  readArtifactMock,
  muxPlaybackMock,
} = vi.hoisted(() => ({
  reviewerDetailMock: vi.fn(),
  locatorMock: vi.fn(),
  videoContextMock: vi.fn(),
  grantMock: vi.fn(),
  readArtifactMock: vi.fn(),
  muxPlaybackMock: vi.fn(),
}))

vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({
      reviewerDetail: reviewerDetailMock,
      reviewerTrackLocator: locatorMock,
      getVideoPlaybackCandidate: videoContextMock,
    })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-lab-route", () => ({
  requireSubtitleLabReviewer: vi.fn(async () => ({
    id: "reviewer-1",
    subject: "subject-1",
    email: "reviewer@example.com",
    managerRole: "REVIEWER",
    reviewerLanguageGrants: [],
  })),
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
vi.mock("@/lib/auth", () => ({ hasReviewerLanguageGrant: grantMock }))
vi.mock("@/services/subtitle-eval-artifacts", () => ({
  readVerifiedSubtitleEvalArtifact: readArtifactMock,
}))
vi.mock("@/services/mux", () => ({
  getMuxAssetPlayback: muxPlaybackMock,
  getPlaybackUrl: (playbackId: string) =>
    `https://stream.mux.com/${playbackId}.m3u8`,
}))

import { GET } from "./route"

const detail = {
  id: "assignment-1",
  targetLanguageId: "language-es",
  targetLanguageSlug: "spanish",
  videoId: "video-1",
  editionIdentity: "edition-1",
  clipStartSeconds: 10,
  clipEndSeconds: 20,
  sourceTrack: {
    label: "SOURCE",
    contentId: "opaque-source",
    mediaType: "text/vtt",
  },
  trackA: { label: "A", contentId: "opaque-a", mediaType: "text/vtt" },
  trackB: { label: "B", contentId: "opaque-b", mediaType: "text/vtt" },
}
const locator = {
  objectKey: `subtitle-eval/v1/candidate/${"a".repeat(64)}.vtt`,
  sha256: "a".repeat(64),
  byteLength: "7",
  mediaType: "text/vtt",
}

describe("reviewer assignment artifact BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reviewerDetailMock.mockResolvedValue(detail)
    locatorMock.mockResolvedValue(locator)
    videoContextMock.mockResolvedValue({
      muxAssetId: "mux-asset-1",
      playbackId: "public-playback-1",
      durationSeconds: 120,
    })
    grantMock.mockReturnValue(true)
    readArtifactMock.mockResolvedValue(new TextEncoder().encode("WEBVTT\n"))
    muxPlaybackMock.mockResolvedValue({
      assetId: "mux-asset-1",
      status: "ready",
      duration: 120,
      publicPlaybackId: "public-playback-1",
    })
  })

  it("derives public video playback from the assignment's frozen edition", async () => {
    const response = await GET(
      new Request(
        "https://manager.example/api?videoId=browser-video&playbackId=browser-playback",
      ),
      {
        params: Promise.resolve({
          assignmentId: "assignment-1",
          kind: "video-context",
        }),
      },
    )

    expect(response.status).toBe(200)
    expect(videoContextMock).toHaveBeenCalledWith("video-1", "edition-1")
    expect(muxPlaybackMock).toHaveBeenCalledWith("mux-asset-1")
    expect(await response.json()).toEqual({
      status: "ready",
      playbackId: "public-playback-1",
      playbackUrl: "https://stream.mux.com/public-playback-1.m3u8",
      durationSeconds: 120,
      clip: { startSeconds: 10, endSeconds: 20 },
    })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it.each([
    ["signed-only playback", { publicPlaybackId: null }],
    ["synced playback mismatch", { publicPlaybackId: "other-playback" }],
    ["preparing playback", { status: "preparing" }],
    ["errored playback", { status: "errored" }],
  ])("returns a typed block for %s", async (_label, playbackOverride) => {
    muxPlaybackMock.mockResolvedValueOnce({
      assetId: "mux-asset-1",
      status: "ready",
      duration: 120,
      ...playbackOverride,
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

  it("derives the opaque content identity from fresh assignment detail", async () => {
    const response = await GET(
      new Request("https://manager.example/api?contentId=browser-controlled"),
      {
        params: Promise.resolve({
          assignmentId: "assignment-1",
          kind: "track-a",
        }),
      },
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("WEBVTT\n")
    expect(locatorMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reviewer-1" }),
      "assignment-1",
      "opaque-a",
    )
    expect(response.headers.get("content-type")).toBe("text/vtt; charset=utf-8")
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="track-a.vtt"',
    )
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it.each([
    ["wrong language", async () => grantMock.mockReturnValueOnce(false)],
    [
      "wrong assignment",
      async () => reviewerDetailMock.mockResolvedValueOnce(null),
    ],
    ["invalid locator", async () => locatorMock.mockResolvedValueOnce(null)],
    [
      "integrity failure",
      async () =>
        readArtifactMock.mockRejectedValueOnce(new Error("collision")),
    ],
  ])("uses the same 404 for %s", async (_label, arrange) => {
    await arrange()
    const response = await GET(new Request("https://manager.example/api"), {
      params: Promise.resolve({
        assignmentId: "assignment-1",
        kind: "track-b",
      }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
  })
})
