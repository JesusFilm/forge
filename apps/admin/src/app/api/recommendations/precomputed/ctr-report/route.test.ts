import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  permission: vi.fn(),
  read: vi.fn(),
}))
vi.mock("@/auth/session", () => ({
  resolveAdminSessionFromRequest: mocks.session,
}))
vi.mock("@/auth/permissions", () => ({ hasPermission: mocks.permission }))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/services/recommendations/precomputed/ctr-report", () => ({
  loadPrivatePrecomputedCtrReport: mocks.read,
}))

import { GET } from "./route"

describe("private precomputed CTR report read", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ principal: { id: "reviewer" } })
    mocks.permission.mockReturnValue(true)
    mocks.read.mockResolvedValue({
      status: "available",
      report: { revision: 2, outcome: "inconclusive" },
    })
  })

  it("returns the exact stored report at an addressable revision", async () => {
    const response = await GET(
      new Request(
        "https://admin.example/api/recommendations/precomputed/ctr-report?experimentId=private-test&revision=2",
      ),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      status: "available",
      report: { revision: 2, outcome: "inconclusive" },
    })
    expect(mocks.read).toHaveBeenCalledWith(
      {},
      {
        experimentId: "private-test",
        revision: 2,
        reviewer: { id: "reviewer" },
      },
    )
  })

  it("does not read a report without aggregate permission", async () => {
    mocks.permission.mockReturnValue(false)
    const response = await GET(
      new Request(
        "https://admin.example/api/recommendations/precomputed/ctr-report?experimentId=private-test",
      ),
    )
    expect(response.status).toBe(403)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it("rejects duplicate and malformed query parameters", async () => {
    for (const query of [
      "experimentId=a&experimentId=b",
      "experimentId=a&revision=0",
      "experimentId=a&revision=34",
      "experimentId=a&extra=b",
    ]) {
      const response = await GET(
        new Request(
          `https://admin.example/api/recommendations/precomputed/ctr-report?${query}`,
        ),
      )
      expect(response.status).toBe(400)
    }
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
