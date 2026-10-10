import { describe, expect, it } from "vitest"

import {
  assertActiveMembership,
  canUseFirstPartyApps,
  shouldPreserveExistingMembership,
} from "./membership.service"

describe("membership policy", () => {
  it("allows only active members into first-party apps", () => {
    expect(canUseFirstPartyApps("active")).toBe(true)
    expect(canUseFirstPartyApps("invited")).toBe(false)
    expect(canUseFirstPartyApps("suspended")).toBe(false)
    expect(canUseFirstPartyApps("disabled")).toBe(false)
  })

  it("throws for non-active memberships", () => {
    expect(() => assertActiveMembership("suspended")).toThrow(
      "Membership status 'suspended' cannot use first-party apps.",
    )
  })

  it("does not downgrade stronger existing membership decisions", () => {
    expect(shouldPreserveExistingMembership("disabled", "active")).toBe(true)
    expect(shouldPreserveExistingMembership("suspended", "active")).toBe(true)
    expect(shouldPreserveExistingMembership("active", "invited")).toBe(true)
    expect(shouldPreserveExistingMembership("invited", "active")).toBe(false)
  })
})
