import { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SeoAssertionReplayError } from "@/auth/seo-assertion-ledger"
import { ForbiddenError } from "@/services/errors"

class RedirectSignal extends Error {
  constructor(readonly path: string) {
    super(`redirect:${path}`)
  }
}

const state: {
  session: () => Promise<{ actorId: string }>
  decide: ReturnType<typeof vi.fn>
} = {
  session: async () => ({ actorId: "admin-user" }),
  decide: vi.fn(),
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

vi.mock("@/services/seo-experiment.service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/services/seo-experiment.service")>()
  return {
    ...original,
    SeoExperimentService: class {
      decideProposalAsAdmin(...args: unknown[]) {
        return state.decide(...args)
      }
    },
  }
})

import { SeoLedgerConflictError } from "@/services/seo-experiment.service"
import { confirmSeoProposalDecision } from "./actions"

const DIGEST = "a".repeat(64)

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

function applyForm(extra: Record<string, string> = {}) {
  return form({
    proposalId: "proposal-1",
    version: "2",
    payloadDigest: DIGEST,
    decision: "apply",
    ...extra,
  })
}

async function redirectOf(data: FormData): Promise<string> {
  try {
    await confirmSeoProposalDecision(data)
  } catch (error) {
    if (error instanceof RedirectSignal) return error.path
    throw error
  }
  throw new Error("expected a redirect")
}

function resultOf(path: string) {
  return new URL(path, "https://admin.test").searchParams.get("result")
}

beforeEach(() => {
  state.session = async () => ({ actorId: "admin-user" })
  state.decide = vi.fn(async () => ({ status: "APPROVED" }))
})

describe("confirmSeoProposalDecision", () => {
  it("decides with the session actor and the bound identity, ignoring browser-supplied authority", async () => {
    const path = await redirectOf(
      applyForm({
        actorId: "attacker",
        nonce: "browser-nonce-value-0000000",
        expiresAt: "2099-01-01T00:00:00.000Z",
        keyId: "forged",
      }),
    )

    expect(state.decide).toHaveBeenCalledTimes(1)
    expect(state.decide).toHaveBeenCalledWith({
      actorId: "admin-user",
      proposalId: "proposal-1",
      version: 2,
      payloadDigest: DIGEST,
      expectedAction: "approve",
      overlapAcknowledged: false,
      reason: null,
    })
    expect(state.decide.mock.calls[0]).toHaveLength(1)
    expect(path).toBe(
      `/dashboard/seo/proposals/confirm?proposalId=proposal-1&version=2&payloadDigest=${DIGEST}&decision=apply&result=APPROVED`,
    )
  })

  it("does not decide when the live Admin check denies the session", async () => {
    state.session = async () => {
      throw new RedirectSignal("/dashboard")
    }
    await expect(redirectOf(applyForm())).resolves.toBe("/dashboard")
    expect(state.decide).not.toHaveBeenCalled()
  })

  it("passes overlap acknowledgement only for an explicit Apply checkbox", async () => {
    await redirectOf(applyForm({ overlapAcknowledged: "yes" }))
    expect(state.decide).toHaveBeenLastCalledWith(
      expect.objectContaining({ overlapAcknowledged: true }),
    )
    await redirectOf(applyForm({ overlapAcknowledged: "true" }))
    expect(state.decide).toHaveBeenLastCalledWith(
      expect.objectContaining({ overlapAcknowledged: false }),
    )
  })

  it("declines with a trimmed reason", async () => {
    state.decide = vi.fn(async () => ({ status: "REJECTED" }))
    const path = await redirectOf(
      applyForm({ decision: "decline", reason: "  Wrong audience  " }),
    )
    expect(state.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAction: "reject",
        reason: "Wrong audience",
        overlapAcknowledged: false,
      }),
    )
    expect(resultOf(path)).toBe("REJECTED")
  })

  it.each([[""], ["  "], ["no"]])(
    "refuses a decline reason shorter than three characters (%j)",
    async (reason) => {
      const path = await redirectOf(applyForm({ decision: "decline", reason }))
      expect(resultOf(path)).toBe("REASON_REQUIRED")
      expect(state.decide).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["missing digest", { payloadDigest: "" }],
    ["malformed digest", { payloadDigest: "ABC" }],
    ["zero version", { version: "0" }],
    ["non-numeric version", { version: "2a" }],
    ["unknown decision", { decision: "publish" }],
  ])("refuses a %s without deciding", async (_label, overrides) => {
    const path = await redirectOf(applyForm(overrides))
    expect(path).toBe("/dashboard/seo/proposals/confirm?result=INVALID")
    expect(state.decide).not.toHaveBeenCalled()
  })

  it.each([["STALE"], ["CONFLICT"], ["ALREADY_DECIDED"], ["EXPIRED"]])(
    "reports the %s ledger outcome",
    async (status) => {
      state.decide = vi.fn(async () => ({ status }))
      expect(resultOf(await redirectOf(applyForm()))).toBe(status)
    },
  )

  it.each([
    ["MISMATCH", new SeoLedgerConflictError("assertion_mismatch")],
    ["REASON_REQUIRED", new SeoLedgerConflictError("reason_required")],
    ["INVALID", new SeoLedgerConflictError("invalid_decision")],
    ["REPLAY", new SeoAssertionReplayError()],
    [
      "RETRY",
      new Prisma.PrismaClientKnownRequestError("serialization", {
        code: "P2034",
        clientVersion: "test",
      }),
    ],
    ["ERROR", new Error("secret internal detail")],
  ])(
    "maps a failure to the closed %s outcome without leaking detail",
    async (expected, error) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {})
      state.decide = vi.fn(async () => {
        throw error
      })
      const path = await redirectOf(applyForm())
      expect(resultOf(path)).toBe(expected)
      expect(path).not.toContain("secret")
      for (const call of consoleError.mock.calls) {
        expect(String(call[0])).not.toContain("secret")
      }
      consoleError.mockRestore()
    },
  )

  it("sends a role downgrade detected inside the decision back to the dashboard", async () => {
    state.decide = vi.fn(async () => {
      throw new ForbiddenError()
    })
    await expect(redirectOf(applyForm())).resolves.toBe("/dashboard")
  })
})
