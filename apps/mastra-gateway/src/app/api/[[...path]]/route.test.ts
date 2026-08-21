import { beforeEach, describe, expect, it, vi } from "vitest"

import type { GatewaySession } from "@/lib/gateway-session"

const proxyMastraRequest = vi.fn()
const revalidateDevotionalSession = vi.fn()

vi.mock("@/lib/mastra-proxy", () => ({
  proxyMastraRequest: (...args: unknown[]) => proxyMastraRequest(...args),
}))

vi.mock("@/lib/devotional-access", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/devotional-access")>()
  return {
    ...original,
    revalidateDevotionalSession: (...args: unknown[]) =>
      revalidateDevotionalSession(...args),
  }
})

import { POST } from "./route"

const session: GatewaySession = {
  subject: "operator-1",
  email: "operator@example.com",
  role: "admin",
}

function launchRequest(inputData: Record<string, unknown>) {
  return new Request("https://gateway.test/api/workflows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputData }),
  })
}

describe("native API proxy support-research authorization", () => {
  beforeEach(() => {
    proxyMastraRequest.mockReset()
    revalidateDevotionalSession.mockReset()
    proxyMastraRequest.mockResolvedValue(new Response(null, { status: 204 }))
    revalidateDevotionalSession.mockResolvedValue(session)
  })

  it("freshly revalidates and requires admin for a direct workflow launch", async () => {
    await POST(
      launchRequest({
        dryRun: true,
        maxConversations: 5,
        idempotencyKey: "operator-check",
      }),
      {
        params: Promise.resolve({
          path: ["workflows", "daily-support-research", "start-async"],
        }),
      },
    )

    expect(proxyMastraRequest).toHaveBeenCalledOnce()
    const [, upstreamPath, options] = proxyMastraRequest.mock.calls[0] as [
      Request,
      string,
      {
        allowedRoles: string[]
        revalidateSession: (
          currentSession: GatewaySession,
        ) => Promise<GatewaySession | null>
      },
    ]
    expect(upstreamPath).toBe(
      "/api/workflows/daily-support-research/start-async",
    )
    expect(options.allowedRoles).toEqual(["admin"])

    await expect(options.revalidateSession(session)).resolves.toEqual(session)
    expect(revalidateDevotionalSession).toHaveBeenCalledWith(session, {
      recordAccess: false,
    })
  })

  it.each([
    [
      "a live run",
      { dryRun: false, maxConversations: 5, idempotencyKey: "live" },
    ],
    ["an omitted limit", { dryRun: true, idempotencyKey: "no-limit" }],
    [
      "an excessive limit",
      { dryRun: true, maxConversations: 6, idempotencyKey: "too-wide" },
    ],
    ["an omitted key", { dryRun: true, maxConversations: 5 }],
  ])("rejects %s before proxying", async (_, inputData) => {
    const response = await POST(launchRequest(inputData), {
      params: Promise.resolve({
        path: ["workflows", "daily-support-research", "start-async"],
      }),
    })

    expect(response.status).toBe(400)
    expect(proxyMastraRequest).not.toHaveBeenCalled()
  })

  it("preserves devotional editor access behavior", async () => {
    await POST(new Request("https://gateway.test/api/workflows"), {
      params: Promise.resolve({
        path: ["workflows", "daily-devotional", "runs", "run-1"],
      }),
    })

    const options = proxyMastraRequest.mock.calls[0]?.[2] as {
      allowedRoles: string[]
    }
    expect(options.allowedRoles).toEqual(["admin", "editor"])
  })
})
