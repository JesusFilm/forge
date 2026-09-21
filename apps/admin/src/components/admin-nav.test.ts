import { describe, expect, it } from "vitest"

import { adminMessages } from "@/i18n/messages"
import type { Principal } from "@/auth/principal"

import { adminNavItems, getNavItem, isNavItemVisible } from "./admin-nav"

function principal(role: Principal["role"]): Principal {
  return { id: "user_1", role }
}

describe("admin nav registry", () => {
  it("gives every item a label and a description in both locales", () => {
    for (const item of adminNavItems) {
      expect(adminMessages.en.nav.items[item.id].label.length).toBeGreaterThan(
        0,
      )
      expect(adminMessages.es.nav.items[item.id].label.length).toBeGreaterThan(
        0,
      )
    }
  })

  it("registers the push-campaigns entry in the system section", () => {
    const item = adminNavItems.find((entry) => entry.id === "pushCampaigns")
    expect(item).toMatchObject({
      href: "/dashboard/push-campaigns",
      section: "system",
    })
  })
})

describe("isNavItemVisible", () => {
  const pushCampaigns = adminNavItems.find(
    (entry) => entry.id === "pushCampaigns",
  )

  it("shows push campaigns to a viewer, the tier R28 puts them at", () => {
    expect(isNavItemVisible(principal("VIEWER"), pushCampaigns!)).toBe(true)
    expect(isNavItemVisible(principal("EDITOR"), pushCampaigns!)).toBe(true)
    expect(isNavItemVisible(principal("ADMIN"), pushCampaigns!)).toBe(true)
  })

  it("hides push campaigns from a principal below the viewer tier", () => {
    expect(isNavItemVisible(principal("PUBLIC"), pushCampaigns!)).toBe(false)
  })

  it("keeps the ADMIN-only entries hidden from a viewer", () => {
    const users = adminNavItems.find((entry) => entry.id === "users")
    expect(isNavItemVisible(principal("VIEWER"), users!)).toBe(false)
  })
})

describe("getNavItem", () => {
  it("resolves a campaign editor path to the push-campaigns entry", () => {
    expect(getNavItem("/dashboard/push-campaigns/abc123")?.id).toBe(
      "pushCampaigns",
    )
    expect(getNavItem("/dashboard/push-campaigns/test-devices")?.id).toBe(
      "pushCampaigns",
    )
  })
})
