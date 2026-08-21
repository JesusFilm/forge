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

describe("Studio API proxy support-research authorization", () => {
  beforeEach(() => {
    proxyMastraRequest.mockReset()
    revalidateDevotionalSession.mockReset()
    proxyMastraRequest.mockResolvedValue(new Response(null, { status: 204 }))
    revalidateDevotionalSession.mockResolvedValue(session)
  })

  it("freshly revalidates and requires admin for a support-research launch", async () => {
    await POST(new Request("https://gateway.test/api/studio/workflows"), {
      params: Promise.resolve({
        path: ["workflows", "daily-support-research", "start-async"],
      }),
    })

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

  it("preserves devotional editor access behavior", async () => {
    await POST(new Request("https://gateway.test/api/studio/workflows"), {
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
