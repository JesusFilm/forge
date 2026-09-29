import { describe, expect, it, vi } from "vitest"

const permission = vi.hoisted(() => vi.fn())
vi.mock("@/services/changelog-current-permission.service", () => ({
  currentChangelogPermission: permission,
  CurrentPermissionError: class extends Error {
    constructor(public readonly status: number) {
      super("access-denied")
    }
  },
}))

import { GET } from "./route"

describe("current permission response", () => {
  it("returns temporary unavailability without leaking an Auth failure", async () => {
    permission.mockRejectedValueOnce(new Error("database connection secret"))
    const response = await GET(
      new Request(
        "http://localhost:3004/api/changelog/current-permission?clientId=jfp_changelog_local",
        { headers: { authorization: "Bearer issued-token" } },
      ),
    )
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ error: "permission-unavailable" })
  })
})
