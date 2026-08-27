import { beforeEach, describe, expect, it, vi } from "vitest"

const { detailMock, locatorMock, grantMock, readMock, videoMock, muxMock } =
  vi.hoisted(() => ({
    detailMock: vi.fn(),
    locatorMock: vi.fn(),
    grantMock: vi.fn(),
    readMock: vi.fn(),
    videoMock: vi.fn(),
    muxMock: vi.fn(),
  }))

vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({
      reviewerDetail: detailMock,
      reviewerTrackLocator: locatorMock,
      getVideoPlaybackCandidate: videoMock,
    })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-lab-route", () => ({
  requireSubtitleLabReviewer: vi.fn(async () => ({ id: "reviewer-1" })),
  privateNoStoreJson: (value: unknown, init?: ResponseInit) =>
    Response.json(value, {
      ...init,
      headers: { "cache-control": "private, no-store" },
    }),
  subtitleLabNotFound: () =>
    Response.json(
      { error: "Not found" },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    ),
}))
vi.mock("@/lib/auth", () => ({ hasReviewerLanguageGrant: grantMock }))
vi.mock("@/services/subtitle-eval-artifacts", () => ({
  readVerifiedSubtitleEvalArtifact: readMock,
}))
vi.mock("@/services/mux", () => ({
  getMuxAssetPlayback: muxMock,
  getPlaybackUrl: (id: string) => `https://stream.mux.com/${id}.m3u8`,
}))

import { GET } from "./route"

describe("reviewer assignment evidence BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    detailMock.mockResolvedValue({
      id: "assignment-1",
      status: "ASSIGNED",
      kind: "STANDARD",
      round: 1,
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
      caseId: "case-1",
      collectionKey: "jesus-film",
      videoId: "video-1",
      editionIdentity: "edition-1",
      clipStartSeconds: 10,
      clipEndSeconds: 20,
      submitted: false,
      postSubmitReceipt: null,
      sourceTrack: {
        label: "SOURCE",
        contentId: "opaque-source",
        mediaType: "text/vtt",
      },
      trackA: { label: "A", contentId: "opaque-a", mediaType: "text/vtt" },
      trackB: { label: "B", contentId: "opaque-b", mediaType: "text/vtt" },
    })
    grantMock.mockReturnValue(true)
    locatorMock.mockImplementation(
      async (_session, _assignment, contentId) => ({
        objectKey: `private/${contentId}`,
        sha256: "a".repeat(64),
        byteLength: "7",
        mediaType: "text/vtt",
      }),
    )
    readMock.mockResolvedValue(new TextEncoder().encode("WEBVTT\n"))
    videoMock.mockResolvedValue({
      muxAssetId: "mux-1",
      playbackId: "playback-1",
      durationSeconds: 30,
    })
    muxMock.mockResolvedValue({
      assetId: "mux-1",
      status: "ready",
      publicPlaybackId: "playback-1",
      duration: 30,
    })
  })

  it("revalidates detail once and returns all bounded evidence without locators", async () => {
    const response = await GET(new Request("https://manager.example/api"), {
      params: Promise.resolve({ assignmentId: "assignment-1" }),
    })
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(detailMock).toHaveBeenCalledTimes(1)
    expect(locatorMock).toHaveBeenCalledTimes(3)
    expect(body).toContain("WEBVTT")
    expect(body).not.toContain("private/")
  })

  it("returns the same non-disclosing 404 after revocation", async () => {
    grantMock.mockReturnValueOnce(false)
    const response = await GET(new Request("https://manager.example/api"), {
      params: Promise.resolve({ assignmentId: "assignment-1" }),
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
    expect(locatorMock).not.toHaveBeenCalled()
  })
})
