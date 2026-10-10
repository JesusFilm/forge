import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    env: {
      MASTRA_GATEWAY_BASE_URL: undefined as string | undefined,
      MASTRA_GATEWAY_ADMIN_API_KEY: undefined as string | undefined,
    },
  },
}))

vi.mock("@/config/env", () => mockEnv)

import {
  loadMastraStudioAccessByEmail,
  updateMastraStudioAccessByEmail,
} from "./mastra-studio-access.service"

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

describe("Mastra Studio access client", () => {
  beforeEach(() => {
    mockEnv.env.MASTRA_GATEWAY_BASE_URL = undefined
    mockEnv.env.MASTRA_GATEWAY_ADMIN_API_KEY = undefined
    vi.unstubAllGlobals()
  })

  it("returns a disabled fallback when gateway config is missing", async () => {
    const lookup = await loadMastraStudioAccessByEmail(["user@example.com"])

    expect(lookup.disabled).toBe(true)
    expect(lookup.helperText).toBe("Configure")
    expect(lookup.accessByEmail.size).toBe(0)
  })

  it("dedupes lookup emails and maps approved rows to Studio access", async () => {
    mockEnv.env.MASTRA_GATEWAY_BASE_URL = "https://gateway.example"
    mockEnv.env.MASTRA_GATEWAY_ADMIN_API_KEY = "gateway-key"
    const fetchMock = vi.fn(async () =>
      response({
        records: [
          {
            email: "active@example.com",
            status: "approved",
            role: "editor",
          },
          {
            email: "pending@example.com",
            status: "pending",
            role: "editor",
          },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const lookup = await loadMastraStudioAccessByEmail([
      " Active@Example.com ",
      "active@example.com",
      "pending@example.com",
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example/api/admin/studio-access",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer gateway-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          emails: ["active@example.com", "pending@example.com"],
        }),
      }),
    )
    expect(lookup).toMatchObject({
      disabled: false,
      helperText: "Backed",
    })
    expect(lookup.accessByEmail.get("active@example.com")).toBe("STUDIO_ACCESS")
    expect(lookup.accessByEmail.get("pending@example.com")).toBe("NO_ACCESS")
  })

  it("disables the control when lookup transport fails", async () => {
    mockEnv.env.MASTRA_GATEWAY_BASE_URL = "https://gateway.example"
    mockEnv.env.MASTRA_GATEWAY_ADMIN_API_KEY = "gateway-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ error: "nope" }, { status: 503 })),
    )

    const lookup = await loadMastraStudioAccessByEmail(["user@example.com"])

    expect(lookup.disabled).toBe(true)
    expect(lookup.helperText).toBe("Unavailable")
  })

  it("sends grant and revoke updates through the gateway API", async () => {
    mockEnv.env.MASTRA_GATEWAY_BASE_URL = "https://gateway.example"
    mockEnv.env.MASTRA_GATEWAY_ADMIN_API_KEY = "gateway-key"
    const fetchMock = vi.fn(async () => response({ record: null }))
    vi.stubGlobal("fetch", fetchMock)

    await updateMastraStudioAccessByEmail({
      email: "User@Example.com",
      name: "User",
      role: "STUDIO_ACCESS",
      approvedBy: "admin-1",
    })
    await updateMastraStudioAccessByEmail({
      email: "User@Example.com",
      role: "NO_ACCESS",
      approvedBy: "admin-1",
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://gateway.example/api/admin/studio-access",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          email: "user@example.com",
          name: "User",
          role: "editor",
          approvedBy: "admin-1",
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://gateway.example/api/admin/studio-access",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          email: "user@example.com",
          role: "none",
          approvedBy: "admin-1",
        }),
      }),
    )
  })

  it("throws on update when gateway rejects the mutation", async () => {
    mockEnv.env.MASTRA_GATEWAY_BASE_URL = "https://gateway.example"
    mockEnv.env.MASTRA_GATEWAY_ADMIN_API_KEY = "gateway-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ error: "unauthorized" }, { status: 401 })),
    )

    await expect(
      updateMastraStudioAccessByEmail({
        email: "user@example.com",
        role: "STUDIO_ACCESS",
        approvedBy: "admin-1",
      }),
    ).rejects.toThrow("status 401")
  })
})
