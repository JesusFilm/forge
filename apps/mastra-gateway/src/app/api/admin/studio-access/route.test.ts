import { beforeEach, describe, expect, it, vi } from "vitest"

const isValidGatewayAdminBearer = vi.fn()
const service = {
  listByEmails: vi.fn(),
  approveByEmail: vi.fn(),
  revokeByEmail: vi.fn(),
}

vi.mock("@/auth/admin-api-bearer", () => ({
  isValidGatewayAdminBearer: (...args: unknown[]) =>
    isValidGatewayAdminBearer(...args),
}))

vi.mock("@/services/studio-access.factory", () => ({
  createGatewayStudioAccessService: () => service,
}))

import { PATCH, POST } from "./route"

function request(method: string, body: unknown, bearer = "valid-key") {
  return new Request("http://gateway.test/api/admin/studio-access", {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

async function json(response: Response) {
  return (await response.json()) as unknown
}

describe("gateway Studio access admin API", () => {
  beforeEach(() => {
    isValidGatewayAdminBearer.mockReset()
    service.listByEmails.mockReset()
    service.approveByEmail.mockReset()
    service.revokeByEmail.mockReset()
    isValidGatewayAdminBearer.mockReturnValue(true)
  })

  it("rejects missing or invalid bearer credentials", async () => {
    isValidGatewayAdminBearer.mockReturnValue(false)

    const response = await POST(request("POST", { emails: ["a@example.com"] }))

    expect(response.status).toBe(401)
    expect(service.listByEmails).not.toHaveBeenCalled()
    expect(await json(response)).toEqual({ error: "unauthorized" })
  })

  it("looks up Studio access records by email", async () => {
    service.listByEmails.mockResolvedValueOnce([
      {
        id: "access-1",
        subject: null,
        email: "active@example.com",
        name: null,
        status: "approved",
        role: "editor",
      },
    ])

    const response = await POST(
      request("POST", { emails: ["active@example.com"] }),
    )

    expect(response.status).toBe(200)
    expect(service.listByEmails).toHaveBeenCalledWith(["active@example.com"])
    expect(await json(response)).toEqual({
      records: [
        {
          email: "active@example.com",
          status: "approved",
          role: "editor",
        },
      ],
    })
  })

  it("grants editor access by email", async () => {
    service.approveByEmail.mockResolvedValueOnce({
      id: "access-1",
      subject: null,
      email: "active@example.com",
      name: "Active User",
      status: "approved",
      role: "editor",
    })

    const response = await PATCH(
      request("PATCH", {
        email: "active@example.com",
        name: "Active User",
        role: "editor",
        approvedBy: "admin-user",
      }),
    )

    expect(response.status).toBe(200)
    expect(service.approveByEmail).toHaveBeenCalledWith({
      email: "active@example.com",
      name: "Active User",
      role: "editor",
      approvedBy: "admin-user",
    })
    expect(await json(response)).toEqual({
      record: {
        email: "active@example.com",
        status: "approved",
        role: "editor",
      },
    })
  })

  it("revokes access by email and no-ops absent rows", async () => {
    service.revokeByEmail.mockResolvedValueOnce(null)

    const response = await PATCH(
      request("PATCH", {
        email: "missing@example.com",
        role: "none",
      }),
    )

    expect(response.status).toBe(200)
    expect(service.revokeByEmail).toHaveBeenCalledWith({
      email: "missing@example.com",
    })
    expect(await json(response)).toEqual({ record: null })
  })

  it("returns a generic 400 for invalid payloads", async () => {
    const response = await PATCH(
      request("PATCH", {
        email: "",
        role: "admin",
      }),
    )

    expect(response.status).toBe(400)
    expect(service.approveByEmail).not.toHaveBeenCalled()
    expect(await json(response)).toEqual({ error: "invalid_request" })
  })
})
