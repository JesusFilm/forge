import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateRequestMock,
  hydrateSharedAgentVideoDraftMock,
  SharedAgentVideoNotFoundErrorMock,
  getSharedAgentDefinitionMock,
} = vi.hoisted(() => {
  class SharedAgentVideoNotFoundError extends Error {
    constructor(documentId: string) {
      super(`Library video "${documentId}" was not found.`)
      this.name = "SharedAgentVideoNotFoundError"
    }
  }

  return {
    authenticateRequestMock: vi.fn(),
    hydrateSharedAgentVideoDraftMock: vi.fn(),
    SharedAgentVideoNotFoundErrorMock: SharedAgentVideoNotFoundError,
    getSharedAgentDefinitionMock: vi.fn(),
  }
})

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@forge/agents", () => ({
  getSharedAgentDefinition: getSharedAgentDefinitionMock,
}))

vi.mock("@/features/agents/shared-agent-video-library", () => ({
  hydrateSharedAgentVideoDraft: hydrateSharedAgentVideoDraftMock,
  SharedAgentVideoNotFoundError: SharedAgentVideoNotFoundErrorMock,
}))

import { GET } from "@/app/api/agents/videos/[id]/hydrate/route"

describe("GET /api/agents/videos/[id]/hydrate", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    hydrateSharedAgentVideoDraftMock.mockReset()
    getSharedAgentDefinitionMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
    getSharedAgentDefinitionMock.mockReturnValue({ id: "translation" })
  })

  it("hydrates a library video into the selected agent draft", async () => {
    hydrateSharedAgentVideoDraftMock.mockResolvedValue({
      video: { documentId: "video-1", title: "Easter Week" },
      subtitleContextStatus: "included",
      draft: {
        goal: "Translate this library video's metadata for the target language.",
        supportingContext: "Source: Forge library video.",
        fields: {
          source_text: "Title: Easter Week",
          target_language: "",
          tone_notes: "",
        },
      },
    })

    const response = await GET(
      new Request(
        "http://example.test/api/agents/videos/video-1/hydrate?agentId=translation",
      ),
      { params: Promise.resolve({ id: "video-1" }) },
    )

    expect(response.status).toBe(200)
    expect(hydrateSharedAgentVideoDraftMock).toHaveBeenCalledWith({
      agentId: "translation",
      videoDocumentId: "video-1",
    })
  })

  it("requires an agent id", async () => {
    const response = await GET(
      new Request("http://example.test/api/agents/videos/video-1/hydrate"),
      { params: Promise.resolve({ id: "video-1" }) },
    )

    expect(response.status).toBe(400)
    expect(hydrateSharedAgentVideoDraftMock).not.toHaveBeenCalled()
  })

  it("returns 404 for unknown shared agents", async () => {
    getSharedAgentDefinitionMock.mockReturnValue(null)

    const response = await GET(
      new Request(
        "http://example.test/api/agents/videos/video-1/hydrate?agentId=missing",
      ),
      { params: Promise.resolve({ id: "video-1" }) },
    )

    expect(response.status).toBe(404)
    expect(hydrateSharedAgentVideoDraftMock).not.toHaveBeenCalled()
  })

  it("returns 404 for missing library videos", async () => {
    hydrateSharedAgentVideoDraftMock.mockRejectedValue(
      new SharedAgentVideoNotFoundErrorMock("video-404"),
    )

    const response = await GET(
      new Request(
        "http://example.test/api/agents/videos/video-404/hydrate?agentId=translation",
      ),
      { params: Promise.resolve({ id: "video-404" }) },
    )

    expect(response.status).toBe(404)
  })
})
