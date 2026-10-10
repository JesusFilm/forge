import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/services/changelog-preapprovals.service", () => ({
  manageChangelogPreapprovals: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/services/changelog-contributors.service", () => ({
  ContributorManagementError: class extends Error {},
}))

import { manageChangelogPreapprovals } from "@/services/changelog-preapprovals.service"
import { POST } from "./route"

describe("preapproval email validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    "person@example.test",
    " Person+tag@sub.example.test ",
    "a@b..c",
    "a@..b",
    "a@b..",
    `${"a".repeat(250)}@b.c`,
  ])("passes accepted email %s to management", async (email) => {
    const response = await POST(request(email))
    expect(response.status).toBe(200)
    expect(manageChangelogPreapprovals).toHaveBeenCalledWith(
      null,
      "jfp_changelog_local",
      { action: "create", id: "approval-1", email },
    )
  })

  it.each([
    "",
    "a@b",
    "@b.c",
    "a@.b",
    "a@b.",
    "a@@b.c",
    "a b@example.test",
    "a@b. c",
    `${"a".repeat(251)}@b.c`,
    `!@!.${"!.".repeat(123)} !`,
  ])("rejects invalid email before management: %s", async (email) => {
    const response = await POST(request(email))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "invalid-request" })
    expect(manageChangelogPreapprovals).not.toHaveBeenCalled()
  })
})

function request(email: string) {
  return new Request("http://localhost/api/changelog/preapprovals", {
    method: "POST",
    body: JSON.stringify({
      clientId: "jfp_changelog_local",
      action: "create",
      id: "approval-1",
      email,
    }),
  })
}
