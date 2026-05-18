import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { adminMessages } from "@/i18n/messages"
import type { PartnerApiKeySummary } from "@/services/partner-api-key.service"

const uiMessages = {
  common: adminMessages.en.common,
  pages: adminMessages.en.pages,
}

// State the mocks can read out of and tests can reassign per case.
const state: {
  rows: PartnerApiKeySummary[]
  users: Array<{ id: string; email: string; name: string }>
  requireAdminSessionImpl: () => Promise<unknown>
  listPartnerKeysCalls: Array<{ includeRevoked?: boolean }>
} = {
  rows: [],
  users: [],
  requireAdminSessionImpl: async () => ({ id: "admin-1", role: "ADMIN" }),
  listPartnerKeysCalls: [],
}

vi.mock("@/i18n/server", () => ({
  getAdminMessages: vi.fn(async () => uiMessages as never),
}))

vi.mock("@/auth/session", () => ({
  requireAdminSession: vi.fn(() => state.requireAdminSessionImpl()),
}))

vi.mock("@/services/partner-api-key.service", () => ({
  listPartnerKeys: vi.fn(async (options: { includeRevoked?: boolean } = {}) => {
    state.listPartnerKeysCalls.push(options)
    return state.rows
  }),
}))

vi.mock("@/db/client", () => ({
  prisma: {
    user: {
      findMany: vi.fn(async () => state.users),
    },
  },
}))

import PartnerKeysPage from "./page"

async function htmlFrom(component: Promise<ReactNode>): Promise<string> {
  return renderToStaticMarkup(await component)
}

function makeRow(
  overrides: Partial<PartnerApiKeySummary>,
): PartnerApiKeySummary {
  return {
    id: overrides.id ?? "row-1",
    keyId: overrides.keyId ?? "jfp_key_abc",
    name: overrides.name ?? "Acme Search Partner",
    ownerEmail: overrides.ownerEmail ?? "ops@acme.example",
    note: overrides.note ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-05-01T12:00:00Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-05-01T12:00:00Z"),
    lastUsedAt: overrides.lastUsedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    createdById: overrides.createdById ?? null,
    revokedById: overrides.revokedById ?? null,
  }
}

describe("dashboard / partner-keys page", () => {
  beforeEach(() => {
    state.rows = []
    state.users = []
    state.listPartnerKeysCalls = []
    state.requireAdminSessionImpl = async () => ({
      id: "admin-1",
      role: "ADMIN",
    })
  })

  it("propagates a non-admin redirect from requireAdminSession", async () => {
    class FakeRedirect extends Error {
      readonly digest = "NEXT_REDIRECT"
    }
    state.requireAdminSessionImpl = async () => {
      throw new FakeRedirect("redirect")
    }
    await expect(htmlFrom(PartnerKeysPage())).rejects.toThrow(/redirect/)
  })

  it("calls listPartnerKeys with includeRevoked: true so the audit trail is complete", async () => {
    state.rows = [
      makeRow({
        id: "r1",
        keyId: "jfp_key_visible",
        name: "Acme",
        ownerEmail: "ops@acme.example",
      }),
    ]
    await htmlFrom(PartnerKeysPage())
    expect(state.listPartnerKeysCalls).toEqual([{ includeRevoked: true }])
  })

  it("renders the table with operator-visible keyId and distinguishes Active vs Revoked", async () => {
    state.users = [
      { id: "user-admin", email: "admin@forge.example", name: "Admin Op" },
      { id: "user-rev", email: "rev@forge.example", name: "Revoker Op" },
    ]
    state.rows = [
      makeRow({
        id: "row-active",
        keyId: "jfp_key_active_001",
        name: "Active Partner",
        ownerEmail: "active@partner.example",
        createdById: "user-admin",
      }),
      makeRow({
        id: "row-revoked",
        keyId: "jfp_key_revoked_002",
        name: "Revoked Partner",
        ownerEmail: "revoked@partner.example",
        createdById: "user-admin",
        revokedById: "user-rev",
        revokedAt: new Date("2026-05-15T09:30:00Z"),
        lastUsedAt: new Date("2026-05-14T08:00:00Z"),
      }),
    ]

    const html = await htmlFrom(PartnerKeysPage())

    // keyId column surfaces the operator-visible identifier verbatim
    expect(html).toContain("jfp_key_active_001")
    expect(html).toContain("jfp_key_revoked_002")
    // names + emails appear
    expect(html).toContain("Active Partner")
    expect(html).toContain("revoked@partner.example")
    // StatusPill differentiates Active vs Revoked via the message dict
    expect(html).toContain(uiMessages.pages.partnerKeys.statusActive)
    expect(html).toContain(uiMessages.pages.partnerKeys.statusRevoked)
    // creator email resolved
    expect(html).toContain("admin@forge.example")
    expect(html).toContain("rev@forge.example")
    // never-used sentinel surfaces for the active row that has no lastUsedAt
    expect(html).toContain(uiMessages.pages.partnerKeys.neverUsed)
  })

  it("renders an empty-state pointing at the CLI command when zero rows exist", async () => {
    state.rows = []
    const html = await htmlFrom(PartnerKeysPage())
    expect(html).toContain(uiMessages.pages.partnerKeys.emptyTitle)
    expect(html).toContain(uiMessages.pages.partnerKeys.emptyDescription)
    expect(html).toContain("partner-keys create")
  })
})
