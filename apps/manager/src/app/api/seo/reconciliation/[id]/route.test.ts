import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  guardMock,
  createClientMock,
  getWorkspaceMock,
  getProposalMock,
  reconcileMock,
  assertionMock,
} = vi.hoisted(() => ({
  guardMock: vi.fn(),
  createClientMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  getProposalMock: vi.fn(),
  reconcileMock: vi.fn(),
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
const workspace = buildSeoDemoWorkspace()
const reconciliation = workspace.ticketReconciliations[0]
const candidate = reconciliation.candidateTickets[0]
const proposal = {
  ...workspace.proposals[2],
  id: reconciliation.proposalId,
  version: reconciliation.proposalVersion,
  payloadDigest: reconciliation.payloadDigest,
}
const context = { params: Promise.resolve({ id: reconciliation.outboxId }) }

function post(body: unknown) {
  return new Request(
    `https://manager.example.test/api/seo/reconciliation/${reconciliation.outboxId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

describe("POST /api/seo/reconciliation/[id]", () => {
  beforeEach(() => {
    guardMock.mockReset()
    createClientMock.mockReset()
    getWorkspaceMock.mockReset()
    getProposalMock.mockReset()
    reconcileMock.mockReset()
    assertionMock.mockReset()
    guardMock.mockResolvedValue({ actor: ACTOR })
    createClientMock.mockResolvedValue({
      getSeoWorkspace: getWorkspaceMock,
      getSeoProposal: getProposalMock,
      reconcileSeoTicket: reconcileMock,
    })
    getWorkspaceMock.mockResolvedValue(workspace)
    getProposalMock.mockResolvedValue(proposal)
    assertionMock.mockResolvedValue("reconcile-assertion")
    reconcileMock.mockResolvedValue({
      ...reconciliation,
      status: "CREATED",
      remoteId: candidate.remoteId,
      remoteUrl: candidate.remoteUrl,
    })
  })

  it("binds only the exact verified candidate using the guarded session actor", async () => {
    const response = await POST(
      post({
        action: "BIND_EXISTING",
        remoteId: candidate.remoteId,
        remoteUrl: candidate.remoteUrl,
      }),
      context,
    )

    expect(response.status).toBe(200)
    expect(assertionMock).toHaveBeenCalledWith({
      actorId: "manager-user-7",
      action: "reconcile_ticket",
      proposalId: reconciliation.proposalId,
      version: reconciliation.proposalVersion,
      payloadDigest: reconciliation.payloadDigest,
    })
    expect(reconcileMock).toHaveBeenCalledWith({
      outboxId: reconciliation.outboxId,
      action: "BIND_EXISTING",
      remoteId: candidate.remoteId,
      remoteUrl: candidate.remoteUrl,
      assertion: "reconcile-assertion",
    })
  })

  it("rejects a candidate whose ticket identity is present but payload digest differs", async () => {
    const mismatchedCandidate = reconciliation.candidateTickets[1]
    const response = await POST(
      post({
        action: "BIND_EXISTING",
        remoteId: mismatchedCandidate.remoteId,
        remoteUrl: mismatchedCandidate.remoteUrl,
      }),
      context,
    )

    expect(response.status).toBe(409)
    expect(assertionMock).not.toHaveBeenCalled()
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it("maps upstream reconciliation failure without exposing private error data", async () => {
    reconcileMock.mockRejectedValue(new Error("remote API credential failed"))

    const response = await POST(post({ action: "MARK_FAILED" }), context)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: "Admin did not complete ticket reconciliation.",
      code: "admin_unavailable",
      retryable: true,
      nextCsrfToken: "next-token",
    })
  })
})
