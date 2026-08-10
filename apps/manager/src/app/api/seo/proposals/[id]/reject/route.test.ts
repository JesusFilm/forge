import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  guardMock,
  createClientMock,
  getProposalMock,
  rejectMock,
  assertionMock,
} = vi.hoisted(() => ({
  guardMock: vi.fn(),
  createClientMock: vi.fn(),
  getProposalMock: vi.fn(),
  rejectMock: vi.fn(),
  assertionMock: vi.fn(),
}))

vi.mock("@/lib/seo-route-guard", () => ({
  guardSeoInteractiveMutation: guardMock,
  seoMutationResponse: (
    _actor: unknown,
    body: Record<string, unknown>,
    init?: ResponseInit,
  ) => NextResponse.json({ ...body, nextCsrfToken: "next-token" }, init),
}))

vi.mock("@/features/seo/seo-admin-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/seo/seo-admin-client")>()
  return { ...actual, createSeoAdminClient: createClientMock }
})

vi.mock("@/lib/seo-approval-assertion", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/seo-approval-assertion")>()
  return { ...actual, createSeoApprovalAssertion: assertionMock }
})

import { POST } from "./route"
import { buildSeoDemoWorkspace } from "@/features/seo/seo-contract"

const ACTOR = {
  kind: "session" as const,
  user: {
    id: "manager-user-7",
    username: "Operator",
    email: "operator@example.test",
    role: { name: "Manager" as const, type: "manager" as const },
  },
  approvedByUserId: "manager-user-7",
}
const proposal = buildSeoDemoWorkspace().proposals[1]
const context = { params: Promise.resolve({ id: proposal.id }) }

function post(body: unknown) {
  return new Request(
    `https://manager.example.test/api/seo/proposals/${proposal.id}/reject`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

describe("POST /api/seo/proposals/[id]/reject", () => {
  beforeEach(() => {
    guardMock.mockReset()
    createClientMock.mockReset()
    getProposalMock.mockReset()
    rejectMock.mockReset()
    assertionMock.mockReset()
    guardMock.mockResolvedValue({ actor: ACTOR })
    createClientMock.mockResolvedValue({
      getSeoProposal: getProposalMock,
      rejectSeoProposal: rejectMock,
    })
    getProposalMock.mockResolvedValue(proposal)
    assertionMock.mockResolvedValue("delegated-reject-assertion")
    rejectMock.mockResolvedValue({
      status: "REJECTED",
      proposalId: proposal.id,
      version: proposal.version,
      decisionId: "decision-reject-1",
    })
  })

  it("requires a durable rejection reason", async () => {
    const response = await POST(
      post({
        version: proposal.version,
        payloadDigest: proposal.payloadDigest,
        overlapAcknowledged: false,
        reason: "",
      }),
      context,
    )
    expect(response.status).toBe(400)
    expect(rejectMock).not.toHaveBeenCalled()
  })

  it("signs reject separately and preserves the exact reason", async () => {
    const response = await POST(
      post({
        version: proposal.version,
        payloadDigest: proposal.payloadDigest,
        overlapAcknowledged: false,
        reason: "The language promise is too broad for the retained evidence.",
      }),
      context,
    )
    expect(response.status).toBe(200)
    expect(assertionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "manager-user-7",
        action: "reject",
      }),
    )
    expect(rejectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "The language promise is too broad for the retained evidence.",
        assertion: "delegated-reject-assertion",
      }),
    )
    expect(await response.json()).toMatchObject({
      result: { status: "REJECTED" },
    })
  })
})
