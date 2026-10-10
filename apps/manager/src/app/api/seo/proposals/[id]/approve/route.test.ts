import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  guardMock,
  createClientMock,
  getProposalMock,
  approveMock,
  assertionMock,
} = vi.hoisted(() => ({
  guardMock: vi.fn(),
  createClientMock: vi.fn(),
  getProposalMock: vi.fn(),
  approveMock: vi.fn(),
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
    `https://manager.example.test/api/seo/proposals/${proposal.id}/approve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

describe("POST /api/seo/proposals/[id]/approve", () => {
  beforeEach(() => {
    guardMock.mockReset()
    createClientMock.mockReset()
    getProposalMock.mockReset()
    approveMock.mockReset()
    assertionMock.mockReset()
    guardMock.mockResolvedValue({ actor: ACTOR })
    createClientMock.mockResolvedValue({
      getSeoProposal: getProposalMock,
      approveSeoProposal: approveMock,
    })
    getProposalMock.mockResolvedValue(proposal)
    assertionMock.mockResolvedValue("delegated-assertion")
    approveMock.mockResolvedValue({
      status: "APPROVED",
      proposalId: proposal.id,
      version: proposal.version,
      decisionId: "decision-1",
      draftRevisionId: "revision-1",
      editorPath: "/dashboard/videos/video-jesus-en/search-social",
    })
  })

  it("preserves the session-only guard response", async () => {
    guardMock.mockResolvedValue(
      NextResponse.json(
        { error: "Interactive session required" },
        { status: 401 },
      ),
    )
    const response = await POST(post({}), context)
    expect(response.status).toBe(401)
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it("signs and submits the exact visible immutable version with the session actor", async () => {
    const response = await POST(
      post({
        version: proposal.version,
        payloadDigest: proposal.payloadDigest,
        overlapAcknowledged: true,
      }),
      context,
    )
    expect(response.status).toBe(200)
    expect(assertionMock).toHaveBeenCalledWith({
      actorId: "manager-user-7",
      action: "approve",
      proposalId: proposal.id,
      version: proposal.version,
      payloadDigest: proposal.payloadDigest,
    })
    expect(approveMock).toHaveBeenCalledWith({
      proposalId: proposal.id,
      version: proposal.version,
      payloadDigest: proposal.payloadDigest,
      assertion: "delegated-assertion",
      overlapAcknowledged: true,
    })
    expect(await response.json()).toMatchObject({
      result: {
        status: "APPROVED",
        draftRevisionId: "revision-1",
      },
      nextCsrfToken: "next-token",
    })
  })

  it("rejects forged actor fields rather than trusting request identity", async () => {
    const response = await POST(
      post({
        version: proposal.version,
        payloadDigest: proposal.payloadDigest,
        overlapAcknowledged: false,
        actorId: "forged-user",
      }),
      context,
    )
    expect(response.status).toBe(400)
    expect(assertionMock).not.toHaveBeenCalled()
  })

  it("returns Admin stale state without creating a second interpretation", async () => {
    approveMock.mockResolvedValue({
      status: "STALE",
      proposalId: proposal.id,
      version: proposal.version,
      message: "Canonical content changed.",
    })
    const response = await POST(
      post({
        version: proposal.version,
        payloadDigest: proposal.payloadDigest,
        overlapAcknowledged: false,
      }),
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      result: { status: "STALE", message: "Canonical content changed." },
    })
  })
})
