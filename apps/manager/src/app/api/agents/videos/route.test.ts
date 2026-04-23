import { beforeEach, describe, expect, it, vi } from "vitest"

const { authenticateRequestMock, searchSharedAgentLibraryVideosMock } =
  vi.hoisted(() => ({
    authenticateRequestMock: vi.fn(),
    searchSharedAgentLibraryVideosMock: vi.fn(),
  }))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/features/agents/shared-agent-video-library", () => ({
  searchSharedAgentLibraryVideos: searchSharedAgentLibraryVideosMock,
}))

import { GET } from "@/app/api/agents/videos/route"

describe("GET /api/agents/videos", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    searchSharedAgentLibraryVideosMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
  })

  it("lists matching library videos for authenticated callers", async () => {
    searchSharedAgentLibraryVideosMock.mockResolvedValue([
      { documentId: "video-1", title: "Easter Week" },
    ])

    const response = await GET(
      new Request("http://example.test/api/agents/videos?query=easter"),
    )

    expect(response.status).toBe(200)
    expect(searchSharedAgentLibraryVideosMock).toHaveBeenCalledWith("easter")
    await expect(response.json()).resolves.toEqual({
      videos: [{ documentId: "video-1", title: "Easter Week" }],
    })
  })

  it("returns the authentication error for unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      new Response("nope", { status: 401 }),
    )

    const response = await GET(
      new Request("http://example.test/api/agents/videos?query=easter"),
    )

    expect(response.status).toBe(401)
    expect(searchSharedAgentLibraryVideosMock).not.toHaveBeenCalled()
  })
})
