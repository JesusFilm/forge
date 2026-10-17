import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AdminSeoProposalConfirmation } from "@/services/seo-experiment.service"
import { ForbiddenError } from "@/services/errors"

class RedirectSignal extends Error {
  constructor(readonly path: string) {
    super(`redirect:${path}`)
  }
}

const DIGEST = "a".repeat(64)

const state: {
  session: () => Promise<{ actorId: string }>
  read: ReturnType<typeof vi.fn>
} = {
  session: async () => ({ actorId: "admin-user" }),
  read: vi.fn(),
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new RedirectSignal(path)
  }),
}))

vi.mock("@/auth/live-admin-session", () => ({
  requireLiveAdminSession: vi.fn(() => state.session()),
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("./actions", () => ({
  confirmSeoProposalDecision: vi.fn(),
}))

vi.mock("@/services/seo-experiment.service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/services/seo-experiment.service")>()
  return {
    ...original,
    SeoExperimentService: class {
      readProposalForAdminConfirmation(...args: unknown[]) {
        return state.read(...args)
      }
    },
  }
})

import SeoProposalConfirmPage from "./page"

function proposal(
  overrides: Partial<AdminSeoProposalConfirmation> = {},
): AdminSeoProposalConfirmation {
  return {
    proposalId: "proposal-1",
    version: 2,
    payloadDigest: DIGEST,
    currentVersion: 2,
    proposalStatus: "PROPOSED",
    lane: "EDITORIAL",
    targetType: "VideoLocale",
    canonicalUrl: "https://www.jesusfilm.org/watch/jesus.html/english.html",
    locale: "en",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    createdAt: "2026-10-15T00:00:00.000Z",
    intent: "Clarify the title for searchers",
    expectedOutcome: "Higher click-through from search",
    risk: "low",
    verificationPlan: "Compare CTR over 28 days",
    rollbackPlan: "Discard the draft",
    affectedFields: ["title"],
    caveats: [],
    applyCreates: "editorial_draft",
    overlapCount: 0,
    decision: null,
    materialization: null,
    ...overrides,
  }
}

function params(overrides: Record<string, string | undefined> = {}) {
  return Promise.resolve({
    proposalId: "proposal-1",
    version: "2",
    payloadDigest: DIGEST,
    decision: "apply",
    ...overrides,
  })
}

async function render(searchParams = params()) {
  return renderToStaticMarkup(
    (await SeoProposalConfirmPage({ searchParams })) as ReactNode,
  )
}

beforeEach(() => {
  state.session = async () => ({ actorId: "admin-user" })
  state.read = vi.fn(async () => proposal())
})

describe("SEO proposal confirmation page", () => {
  it("denies a session whose live role is no longer ADMIN before reading", async () => {
    state.session = async () => {
      throw new RedirectSignal("/dashboard")
    }
    await expect(render()).rejects.toMatchObject({ path: "/dashboard" })
    expect(state.read).not.toHaveBeenCalled()
  })

  it("redirects when the service-level live role check denies", async () => {
    state.read = vi.fn(async () => {
      throw new ForbiddenError()
    })
    await expect(render()).rejects.toMatchObject({ path: "/dashboard" })
  })

  it("reads the bound version with the session actor", async () => {
    await render()
    expect(state.read).toHaveBeenCalledWith({
      actorId: "admin-user",
      proposalId: "proposal-1",
      version: 2,
    })
  })

  it("shows immutable details, what Apply creates, and that nothing publishes", async () => {
    const html = await render()
    expect(html).toContain("Clarify the title for searchers")
    expect(html).toContain("Editorial draft (not published)")
    expect(html).toContain("never publishes or deploys")
    expect(html).toContain("Apply — create draft")
    expect(html).toContain(`name="payloadDigest" value="${DIGEST}"`)
    expect(html).toContain('name="version" value="2"')
    expect(html).toContain('name="decision" value="apply"')
    expect(html).not.toMatch(/name="(actorId|nonce|expiresAt|keyId)"/)
    expect(html).toContain("Decline instead")
  })

  it("describes an engineering ticket for engineering proposals", async () => {
    state.read = vi.fn(async () =>
      proposal({
        applyCreates: "engineering_ticket",
        targetType: "Engineering",
      }),
    )
    const html = await render()
    expect(html).toContain("Engineering ticket (not deployed)")
    expect(html).toContain("Apply — queue ticket")
  })

  it("requires a decline reason of at least three characters", async () => {
    const html = await render(params({ decision: "decline" }))
    expect(html).toMatch(/<textarea[^>]*name="reason"[^>]*required/)
    expect(html).toMatch(
      /<textarea[^>]*minLength="3"|<textarea[^>]*minlength="3"/,
    )
    expect(html).toContain("Decline proposal")
  })

  it("offers an explicit overlap acknowledgement only when overlap exists", async () => {
    expect(await render()).not.toContain("overlapAcknowledged")
    state.read = vi.fn(async () => proposal({ overlapCount: 2 }))
    const html = await render()
    expect(html).toContain('name="overlapAcknowledged" value="yes"')
    expect(html).not.toMatch(/name="overlapAcknowledged"[^>]*checked/)
  })

  it("offers the acknowledgement after a CONFLICT result", async () => {
    const html = await render(params({ result: "CONFLICT" }))
    expect(html).toContain('name="overlapAcknowledged"')
    expect(html).toContain("Overlapping work or an existing draft")
  })

  it.each([
    ["a digest mismatch", proposal({ payloadDigest: "f".repeat(64) })],
    ["an unknown version", null],
  ])("shows a mismatch and no form for %s", async (_label, row) => {
    state.read = vi.fn(async () => row)
    const html = await render()
    expect(html).toContain("does not match the current proposal version")
    expect(html).not.toContain("<form")
    expect(html).not.toContain("Clarify the title")
  })

  it("shows an invalid notice without reading for malformed params", async () => {
    const html = await render(params({ payloadDigest: "nope" }))
    expect(html).toContain("incomplete or invalid")
    expect(state.read).not.toHaveBeenCalled()
  })

  it.each([
    [
      "already decided",
      proposal({
        proposalStatus: "REJECTED",
        decision: {
          action: "REJECT",
          decidedAt: "2026-10-16T00:00:00.000Z",
          overlapAcknowledged: false,
        },
      }),
      "already declined",
    ],
    ["superseded", proposal({ currentVersion: 3 }), "newer version"],
    ["stale", proposal({ proposalStatus: "STALE" }), "is stale"],
    [
      "expired",
      proposal({ expiresAt: new Date(Date.now() - 1_000).toISOString() }),
      "expired",
    ],
  ])(
    "blocks the decision when the proposal is %s",
    async (_label, row, copy) => {
      state.read = vi.fn(async () => row)
      const html = await render()
      expect(html).toContain(copy)
      expect(html).not.toContain("<form")
    },
  )

  it("shows a closed result notice and ignores unknown result values", async () => {
    expect(await render(params({ result: "REPLAY" }))).toContain("already used")
    const html = await render(params({ result: "<script>" }))
    expect(html).not.toContain("&lt;script&gt;")
    expect(html).not.toContain('role="status"')
  })
})
