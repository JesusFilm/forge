import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateManagerActorRequestMock,
  getSharedAgentSessionRuntimeMock,
} = vi.hoisted(() => ({
  authenticateManagerActorRequestMock: vi.fn(),
  getSharedAgentSessionRuntimeMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateManagerActorRequest: authenticateManagerActorRequestMock,
}))

vi.mock("@/features/agents/shared-agent-runtime", () => ({
  getSharedAgentSessionRuntime: getSharedAgentSessionRuntimeMock,
  SharedAgentAccessDeniedError: class SharedAgentAccessDeniedError extends Error {},
  SharedAgentSessionNotFoundError: class SharedAgentSessionNotFoundError extends Error {},
}))

import { GET } from "@/app/api/agents/sessions/[id]/route"

describe("GET /api/agents/sessions/[id]", () => {
  beforeEach(() => {
    authenticateManagerActorRequestMock.mockReset()
    getSharedAgentSessionRuntimeMock.mockReset()
    authenticateManagerActorRequestMock.mockResolvedValue({
      kind: "session",
      user: { id: 1, email: "manager@forge.test", username: "manager" },
      approvedByUserId: "1",
    })
  })

  it("returns the requested session", async () => {
    getSharedAgentSessionRuntimeMock.mockReturnValue({
      id: "session-1",
      agent: { id: "translation", name: "Translation Agent" },
    })

    const response = await GET(
      new Request("http://example.test/api/agents/sessions/session-1"),
      { params: Promise.resolve({ id: "session-1" }) },
    )

    expect(response.status).toBe(200)
    expect(getSharedAgentSessionRuntimeMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      actor: {
        kind: "session",
        user: { id: 1, email: "manager@forge.test", username: "manager" },
        approvedByUserId: "1",
      },
    })
    await expect(response.json()).resolves.toEqual({
      session: {
        id: "session-1",
        agent: { id: "translation", name: "Translation Agent" },
      },
    })
  })
})
