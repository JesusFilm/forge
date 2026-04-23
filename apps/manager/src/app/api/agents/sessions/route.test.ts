import { beforeEach, describe, expect, it, vi } from "vitest"

const { authenticateManagerActorRequestMock, createSharedAgentSessionMock } =
  vi.hoisted(() => ({
    authenticateManagerActorRequestMock: vi.fn(),
    createSharedAgentSessionMock: vi.fn(),
  }))

vi.mock("@/lib/auth", () => ({
  authenticateManagerActorRequest: authenticateManagerActorRequestMock,
}))

vi.mock("@/features/agents/shared-agent-runtime", () => ({
  createSharedAgentSessionRuntime: createSharedAgentSessionMock,
  SharedAgentNotFoundError: class SharedAgentNotFoundError extends Error {},
}))

import { POST } from "@/app/api/agents/sessions/route"

describe("POST /api/agents/sessions", () => {
  beforeEach(() => {
    authenticateManagerActorRequestMock.mockReset()
    createSharedAgentSessionMock.mockReset()
    authenticateManagerActorRequestMock.mockResolvedValue({
      kind: "session",
      user: { id: 1, email: "manager@forge.test", username: "manager" },
      approvedByUserId: "1",
    })
  })

  it("creates a shared agent session", async () => {
    createSharedAgentSessionMock.mockResolvedValue({
      id: "session-1",
      agent: { id: "seo", name: "SEO Agent" },
      video: null,
    })

    const response = await POST(
      new Request("http://example.test/api/agents/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "seo" }),
      }),
    )

    expect(response.status).toBe(200)
    expect(createSharedAgentSessionMock).toHaveBeenCalledWith({
      agentId: "seo",
      actor: {
        kind: "session",
        user: { id: 1, email: "manager@forge.test", username: "manager" },
        approvedByUserId: "1",
      },
    })
  })

  it("rejects invalid payloads", async () => {
    const response = await POST(
      new Request("http://example.test/api/agents/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    )

    expect(response.status).toBe(400)
    expect(createSharedAgentSessionMock).not.toHaveBeenCalled()
  })
})
