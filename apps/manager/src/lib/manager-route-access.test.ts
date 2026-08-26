import { describe, expect, it } from "vitest"

import { resolveRoleCompatibleManagerReturnToURL } from "./manager-route-access"

describe("role-compatible Manager return targets", () => {
  it("keeps reviewers out of operator routes", () => {
    expect(
      resolveRoleCompatibleManagerReturnToURL({
        returnTo: "/dashboard/jobs",
        role: "REVIEWER",
        managerBaseUrl: "http://localhost:3002",
      }),
    ).toBe("http://localhost:3002/subtitle-review")
  })

  it("keeps operators out of reviewer routes", () => {
    expect(
      resolveRoleCompatibleManagerReturnToURL({
        returnTo: "/subtitle-review/assignment-1",
        role: "OPERATOR",
        managerBaseUrl: "http://localhost:3002",
      }),
    ).toBe("http://localhost:3002/dashboard/coverage")
  })
})
