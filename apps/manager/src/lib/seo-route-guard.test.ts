import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { interactiveAuthMock } = vi.hoisted(() => ({
  interactiveAuthMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateInteractiveManagerRequest: interactiveAuthMock,
}))

import {
  guardSeoInteractiveMutation,
  seoMutationResponse,
} from "./seo-route-guard"
import { issueSeoCsrfToken, resetSeoCsrfStateForTests } from "./seo-csrf"

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

function request(
  headers: Record<string, string> = {},
  url = "https://manager.example.test/api/seo/proposals/p1/approve",
) {
  return new Request(url, {
    method: "POST",
    headers: {
      origin: "https://manager.example.test",
      "content-type": "application/json",
      ...headers,
    },
    body: "{}",
  })
}

describe("guardSeoInteractiveMutation", () => {
  beforeEach(() => {
    resetSeoCsrfStateForTests()
    interactiveAuthMock.mockReset()
    interactiveAuthMock.mockResolvedValue(ACTOR)
  })

  it("requires JSON and an exact same-origin value", async () => {
    const wrongContentType = await guardSeoInteractiveMutation(
      request({ "content-type": "text/plain" }),
    )
    expect(wrongContentType).toBeInstanceOf(NextResponse)
    expect((wrongContentType as NextResponse).status).toBe(415)

    const missingOrigin = await guardSeoInteractiveMutation(
      request({ origin: "" }),
    )
    expect((missingOrigin as NextResponse).status).toBe(403)

    const siblingOrigin = await guardSeoInteractiveMutation(
      request({ origin: "https://preview.manager.example.test" }),
    )
    expect((siblingOrigin as NextResponse).status).toBe(403)
    expect(interactiveAuthMock).not.toHaveBeenCalled()
  })

  it("preserves session-only authentication rejection", async () => {
    interactiveAuthMock.mockResolvedValue(
      NextResponse.json(
        { error: "Interactive Manager session required" },
        { status: 403 },
      ),
    )
    const result = await guardSeoInteractiveMutation(
      request({ authorization: "Bearer service-key" }),
    )
    expect((result as NextResponse).status).toBe(403)
  })

  it("requires an actor-bound one-time CSRF token", async () => {
    const missing = await guardSeoInteractiveMutation(request())
    expect((missing as NextResponse).status).toBe(403)
    expect(await (missing as NextResponse).json()).toMatchObject({
      code: "csrf_required",
    })

    const token = issueSeoCsrfToken(ACTOR.approvedByUserId)
    const accepted = await guardSeoInteractiveMutation(
      request({ "x-seo-csrf-token": token }),
    )
    expect(accepted).toEqual({ actor: ACTOR })
    const replay = await guardSeoInteractiveMutation(
      request({ "x-seo-csrf-token": token }),
    )
    expect((replay as NextResponse).status).toBe(403)
    expect(await (replay as NextResponse).json()).toMatchObject({
      code: "csrf_reused",
    })
  })

  it("issues a replacement CSRF token with every guarded response", async () => {
    const response = seoMutationResponse(ACTOR, { ok: true })
    expect(await response.json()).toMatchObject({
      ok: true,
      nextCsrfToken: expect.any(String),
    })
  })
})
