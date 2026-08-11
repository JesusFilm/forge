import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  guardMock,
  createClientMock,
  getWorkspaceMock,
  getProposalMock,
  reviewMock,
  assertionMock,
} = vi.hoisted(() => ({
  guardMock: vi.fn(),
  createClientMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  getProposalMock: vi.fn(),
  reviewMock: vi.fn(),
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
const lesson = workspace.lessons[1]
const proposal = {
  ...workspace.proposals[1],
  id: lesson.proposalId,
  version: lesson.proposalVersion,
  payloadDigest: "sha256:lesson-source",
}
const context = { params: Promise.resolve({ id: lesson.id }) }

function post(body: unknown) {
  return new Request(
    `https://manager.example.test/api/seo/lessons/${lesson.id}/review`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

describe("POST /api/seo/lessons/[id]/review", () => {
  beforeEach(() => {
    guardMock.mockReset()
    createClientMock.mockReset()
    getWorkspaceMock.mockReset()
    getProposalMock.mockReset()
    reviewMock.mockReset()
    assertionMock.mockReset()
    guardMock.mockResolvedValue({ actor: ACTOR })
    createClientMock.mockResolvedValue({
      getSeoWorkspace: getWorkspaceMock,
      getSeoProposal: getProposalMock,
      reviewSeoLesson: reviewMock,
    })
    getWorkspaceMock.mockResolvedValue(workspace)
    getProposalMock.mockResolvedValue(proposal)
    assertionMock.mockResolvedValue("lesson-assertion")
    reviewMock.mockResolvedValue({ ...lesson, status: "ACTIVE" })
  })

  it("binds lesson review to the guarded session actor and exact source version", async () => {
    const response = await POST(post({ status: "ACTIVE" }), context)

    expect(response.status).toBe(200)
    expect(assertionMock).toHaveBeenCalledWith({
      actorId: "manager-user-7",
      action: "review_lesson",
      proposalId: lesson.proposalId,
      version: lesson.proposalVersion,
      payloadDigest: proposal.payloadDigest,
    })
    expect(reviewMock).toHaveBeenCalledWith({
      lessonId: lesson.id,
      status: "ACTIVE",
      assertion: "lesson-assertion",
    })
  })

  it("does not trust a forged actor or call Admin when the payload is invalid", async () => {
    const response = await POST(
      post({ status: "ACTIVE", actorId: "forged-user" }),
      context,
    )

    expect(response.status).toBe(400)
    expect(assertionMock).not.toHaveBeenCalled()
    expect(reviewMock).not.toHaveBeenCalled()
  })

  it("maps upstream failures to an actor-safe generic response", async () => {
    reviewMock.mockRejectedValue(new Error("upstream token leaked"))

    const response = await POST(post({ status: "RETIRED" }), context)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: "Admin did not complete the learning review.",
      code: "admin_unavailable",
      retryable: true,
      nextCsrfToken: "next-token",
    })
  })
})
