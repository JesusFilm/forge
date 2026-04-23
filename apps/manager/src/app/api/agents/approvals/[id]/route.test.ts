import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateManagerSessionRequestMock,
  resolveSharedAgentApprovalMock,
} = vi.hoisted(() => ({
  authenticateManagerSessionRequestMock: vi.fn(),
  resolveSharedAgentApprovalMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateManagerSessionRequest: authenticateManagerSessionRequestMock,
}))

vi.mock("@/features/agents/shared-agent-runtime", () => ({
  SharedAgentAccessDeniedError: class SharedAgentAccessDeniedError extends Error {},
  SharedAgentApprovalAlreadyResolvedError: class SharedAgentApprovalAlreadyResolvedError extends Error {},
  resolveSharedAgentApproval: resolveSharedAgentApprovalMock,
  SharedAgentApprovalNotFoundError: class SharedAgentApprovalNotFoundError extends Error {},
}))

import { POST } from "@/app/api/agents/approvals/[id]/route"

describe("POST /api/agents/approvals/[id]", () => {
  beforeEach(() => {
    authenticateManagerSessionRequestMock.mockReset()
    resolveSharedAgentApprovalMock.mockReset()
    authenticateManagerSessionRequestMock.mockResolvedValue({
      kind: "session",
      user: { id: 1, email: "manager@forge.test", username: "manager" },
      approvedByUserId: "1",
    })
  })

  it("approves a pending action", async () => {
    resolveSharedAgentApprovalMock.mockResolvedValue({
      id: "session-1",
      latestRun: {
        pendingApproval: {
          id: "approval-1",
          status: "approved",
        },
      },
    })

    const response = await POST(
      new Request("http://example.test/api/agents/approvals/approval-1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
        },
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: Promise.resolve({ id: "approval-1" }) },
    )

    expect(response.status).toBe(200)
    expect(resolveSharedAgentApprovalMock).toHaveBeenCalledWith({
      approvalId: "approval-1",
      action: "approve",
      actor: {
        kind: "session",
        user: { id: 1, email: "manager@forge.test", username: "manager" },
        approvedByUserId: "1",
      },
      locale: "en-US",
    })
  })
})
