import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateManagerActorRequestMock,
  sendSharedAgentSessionMessageMock,
} = vi.hoisted(() => ({
  authenticateManagerActorRequestMock: vi.fn(),
  sendSharedAgentSessionMessageMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateManagerActorRequest: authenticateManagerActorRequestMock,
}))

vi.mock("@/features/agents/shared-agent-runtime", () => ({
  sendSharedAgentSessionMessage: sendSharedAgentSessionMessageMock,
  SharedAgentAccessDeniedError: class SharedAgentAccessDeniedError extends Error {},
  SharedAgentSessionNotFoundError: class SharedAgentSessionNotFoundError extends Error {},
  SharedAgentValidationError: class SharedAgentValidationError extends Error {
    details = ["bad input"]
  },
}))

import { POST } from "@/app/api/agents/sessions/[id]/messages/route"

describe("POST /api/agents/sessions/[id]/messages", () => {
  beforeEach(() => {
    authenticateManagerActorRequestMock.mockReset()
    sendSharedAgentSessionMessageMock.mockReset()
    authenticateManagerActorRequestMock.mockResolvedValue({
      kind: "session",
      user: { id: 1, email: "manager@forge.test", username: "manager" },
      approvedByUserId: "1",
    })
  })

  it("runs a session message with a draft payload", async () => {
    sendSharedAgentSessionMessageMock.mockResolvedValue({
      id: "session-1",
      latestRun: { output: "Hola mundo" },
    })

    const response = await POST(
      new Request(
        "http://example.test/api/agents/sessions/session-1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
          },
          body: JSON.stringify({
            draft: {
              goal: "Translate the metadata",
              fields: {
                source_text: "Hello world",
                target_language: "Spanish",
              },
            },
          }),
        },
      ),
      { params: Promise.resolve({ id: "session-1" }) },
    )

    expect(response.status).toBe(200)
    expect(sendSharedAgentSessionMessageMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      actor: {
        kind: "session",
        user: { id: 1, email: "manager@forge.test", username: "manager" },
        approvedByUserId: "1",
      },
      locale: "en-US",
      message: undefined,
      draft: {
        goal: "Translate the metadata",
        fields: {
          source_text: "Hello world",
          target_language: "Spanish",
        },
      },
    })
  })
})
