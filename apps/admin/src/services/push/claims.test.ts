import { describe, expect, it, vi } from "vitest"

import {
  PUSH_CLAIM_HOLDING_STATUSES,
  PUSH_CLAIM_MAX_CANDIDATES,
  PUSH_CLAIM_RECENT_GUARD_HOURS,
  claimPushDeliveryPage,
  nextPushDeliveryNonce,
  type PushClaimCandidate,
} from "./claims"
import { PushInputError } from "./errors"

/**
 * What these suites read back off a mocked Prisma call. Every field is
 * declared present because the assertions below name the ones they read.
 */
type PrismaCallArgs = {
  where: Record<string, unknown>
  data: Record<string, unknown>
  orderBy: unknown
  take: number
  select: unknown
}

function candidate(
  overrides: Partial<PushClaimCandidate> = {},
): PushClaimCandidate {
  return {
    registrationId: "reg_1",
    languageSlug: "english",
    country: "NZ",
    timeZone: "Pacific/Auckland",
    localDay: "2026-10-01",
    ...overrides,
  }
}

function clientWith(winners: Array<{ registration_id: string }> = []) {
  return {
    $queryRaw: vi.fn(async (_args: PrismaCallArgs) =>
      winners.map((winner, index) => ({
        id: `delivery_${index}`,
        nonce: `nonce_${index}`,
        registration_id: winner.registration_id,
      })),
    ),
    pushDelivery: { findMany: vi.fn(async (_args: PrismaCallArgs) => []) },
  }
}

describe("push delivery nonce", () => {
  it("mints a base64url nonce of 32 random bytes", () => {
    const nonce = nextPushDeliveryNonce()

    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(nonce).not.toBe(nextPushDeliveryNonce())
  })

  it("stays inside the column the migration declares", () => {
    expect(nextPushDeliveryNonce().length).toBeLessThanOrEqual(64)
  })
})

describe("push claim guards", () => {
  it("names the statuses under which a phone holds its day", () => {
    expect(PUSH_CLAIM_HOLDING_STATUSES).toEqual([
      "RESERVED",
      "SENDING",
      "ACCEPTED",
      "HANDED_OFF",
      "UNKNOWN",
    ])
  })

  it("guards the previous 20 hours", () => {
    expect(PUSH_CLAIM_RECENT_GUARD_HOURS).toBe(20)
  })

  it("claims nothing when the page is empty", async () => {
    const client = clientWith()

    const result = await claimPushDeliveryPage(client as never, {
      campaignId: "campaign_1",
      kind: "LIVE",
      candidates: [],
    })

    expect(result).toEqual({ claimed: [], suppressed: [], alreadyClaimed: [] })
    expect(client.$queryRaw).not.toHaveBeenCalled()
  })

  it("refuses a page larger than one statement may carry", async () => {
    const client = clientWith()
    const candidates = Array.from(
      { length: PUSH_CLAIM_MAX_CANDIDATES + 1 },
      (_, index) => candidate({ registrationId: `reg_${index}` }),
    )

    await expect(
      claimPushDeliveryPage(client as never, {
        campaignId: "campaign_1",
        kind: "LIVE",
        candidates,
      }),
    ).rejects.toThrowError(PushInputError)
  })

  it("reads the served-recently guard for a live claim", async () => {
    const client = clientWith([{ registration_id: "reg_1" }])

    await claimPushDeliveryPage(client as never, {
      campaignId: "campaign_1",
      kind: "LIVE",
      candidates: [candidate()],
      now: new Date("2026-10-01T00:00:00.000Z"),
    })

    const guard = client.pushDelivery.findMany.mock.calls[0][0]
    expect(guard.where.campaignId).toEqual({ not: "campaign_1" })
    expect(guard.where.createdAt).toEqual({
      gte: new Date("2026-09-30T04:00:00.000Z"),
    })
    expect(guard.take).toBeGreaterThan(0)
  })

  it("skips the daily claim entirely for a test send (KTD2)", async () => {
    const client = clientWith([{ registration_id: "reg_1" }])

    const result = await claimPushDeliveryPage(client as never, {
      campaignId: "campaign_1",
      kind: "TEST",
      candidates: [candidate()],
    })

    expect(client.pushDelivery.findMany).not.toHaveBeenCalled()
    expect(client.$queryRaw).toHaveBeenCalledOnce()
    expect(result.claimed).toHaveLength(1)
    expect(result.suppressed).toEqual([])
  })

  it("takes one candidate per phone", async () => {
    const client = clientWith([{ registration_id: "reg_1" }])

    const result = await claimPushDeliveryPage(client as never, {
      campaignId: "campaign_1",
      kind: "TEST",
      candidates: [candidate(), candidate({ languageSlug: "arabic" })],
    })

    expect(result.claimed).toHaveLength(1)
  })
})
