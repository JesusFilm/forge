import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEVICE_USER_CODE_FORMAT,
  DeviceGrantError,
  MAX_USER_CODE_ATTEMPTS,
  approveDeviceCode,
  denyDeviceCode,
  findPendingByUserCode,
  generateUserCode,
  hashDeviceSecret,
  issueDeviceCode,
  pollDeviceCode,
  purgeExpiredDeviceCodes,
  recordUserCodeAttempt,
  resetDeviceCodePurgeState,
} from "./device-grant.service"

const now = new Date("2026-08-06T12:00:00.000Z")

function createPrismaMock(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    deviceCode: {
      create: vi.fn(async () => ({ id: "dc_1" })),
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      ...(overrides.deviceCode as object | undefined),
    },
  }
}

function pendingRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "dc_1",
    clientId: "jfp_tv_production",
    scopes: ["openid", "web:watch-events:write"],
    codeChallenge: "c".repeat(43),
    codeChallengeMethod: "S256",
    status: "PENDING" as const,
    userId: null,
    sessionId: null,
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
    lastPolledAt: null,
    pollingIntervalMs: 5000,
    attemptCount: 0,
    ...overrides,
  }
}

describe("device code generation", () => {
  it("issues a ten-digit numeric user code", () => {
    // The format is a cross-platform contract: the TV only displays what the
    // server issues, so a change here changes every screen at once.
    expect(DEVICE_USER_CODE_FORMAT).toBe("numbers")
    const code = generateUserCode()
    expect(code).toMatch(/^[0-9]{10}$/)
  })

  it("issues letter codes without vowels or lookalike glyphs", () => {
    // Consonants only, so a random code can never spell a word aloud, and
    // without I/O which read as 1/0. L stays: it is only ambiguous alongside
    // digits, and this charset has none.
    const code = generateUserCode("letters")
    expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/)
    expect(code).not.toMatch(/[AEIOU]/)
    expect(code).not.toMatch(/[01IO]/)
  })

  it("keeps the code space large enough for the rate limit to bound guessing", () => {
    // Guessing is bounded by entropy against the per-IP limit on /device/status
    // (20/min), NOT by the per-code attempt cap — a wrong guess matches no row,
    // so there is nothing to count against. Even with a thousand codes live at
    // once, one guess has ~1e-7 odds of naming a real one.
    const codeSpace = 10 ** 10
    const generouslyManyLiveCodes = 1000
    expect(generouslyManyLiveCodes / codeSpace).toBeLessThan(1e-6)
  })

  it("stores codes hashed, never in plaintext", async () => {
    const prisma = createPrismaMock()
    const issued = await issueDeviceCode(prisma as never, {
      clientId: "jfp_tv_production",
      scopes: ["openid"],
      codeChallenge: "c".repeat(43),
      codeChallengeMethod: "S256",
      expiresInMs: 900_000,
      pollingIntervalMs: 5000,
      now,
    })

    const create = (prisma.deviceCode as { create: ReturnType<typeof vi.fn> })
      .create
    const written = create.mock.calls[0][0].data as Record<string, string>

    expect(written.deviceCodeHash).toBe(hashDeviceSecret(issued.deviceCode))
    expect(written.userCodeHash).toBe(hashDeviceSecret(issued.userCode))
    // The raw values must appear nowhere in the row.
    const serialized = JSON.stringify(written)
    expect(serialized).not.toContain(issued.deviceCode)
    expect(serialized).not.toContain(issued.userCode)
  })

  it("retries a colliding user code instead of failing the request", async () => {
    let call = 0
    const create = vi.fn(async () => {
      call += 1
      if (call === 1)
        throw Object.assign(new Error("unique"), { code: "P2002" })
      return { id: "dc_1" }
    })
    const prisma = createPrismaMock({ deviceCode: { create } })

    const issued = await issueDeviceCode(prisma as never, {
      clientId: "jfp_tv_production",
      scopes: ["openid"],
      codeChallenge: "c".repeat(43),
      codeChallengeMethod: "S256",
      expiresInMs: 900_000,
      pollingIntervalMs: 5000,
      now,
    })

    expect(create).toHaveBeenCalledTimes(2)
    expect(issued.userCode).toMatch(/^[0-9]{10}$/)
  })

  it("rethrows a non-collision write failure rather than retrying blindly", async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error("connection lost"), { code: "P1001" })
    })
    const prisma = createPrismaMock({ deviceCode: { create } })

    await expect(
      issueDeviceCode(prisma as never, {
        clientId: "jfp_tv_production",
        scopes: ["openid"],
        codeChallenge: "c".repeat(43),
        codeChallengeMethod: "S256",
        expiresInMs: 900_000,
        pollingIntervalMs: 5000,
        now,
      }),
    ).rejects.toThrow("connection lost")
    expect(create).toHaveBeenCalledTimes(1)
  })
})

/**
 * Each case below is written so that ONLY the branch under test can produce its
 * error. A shared "unknown outcome keeps polling" fallback would make several of
 * these deletable with no test going red, which is exactly the failure mode
 * docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
 * describes.
 */
describe("pollDeviceCode RFC 8628 outcomes", () => {
  async function poll(
    record: unknown,
    overrides: Record<string, unknown> = {},
  ) {
    const prisma = createPrismaMock({
      deviceCode: {
        findUnique: vi.fn(async () => record),
        updateMany: vi.fn(async () => ({ count: 1 })),
        ...overrides,
      },
    })
    return {
      prisma,
      run: () =>
        pollDeviceCode(prisma as never, {
          deviceCode: "device-code-raw",
          clientId: "jfp_tv_production",
          now,
        }),
    }
  }

  it("invalid_grant when the device code is unknown", async () => {
    const { run } = await poll(null)
    await expect(run()).rejects.toMatchObject({ code: "invalid_grant" })
  })

  it("invalid_grant when the code belongs to another client", async () => {
    // Not access_denied and not invalid_request: a device code must never be
    // portable to a different client id.
    const { run } = await poll(
      pendingRecord({ clientId: "jfp_web_production" }),
    )
    await expect(run()).rejects.toMatchObject({ code: "invalid_grant" })
  })

  it("slow_down when polled inside the advertised interval", async () => {
    const { run } = await poll(
      pendingRecord({ lastPolledAt: new Date(now.getTime() - 1000) }),
    )
    await expect(run()).rejects.toMatchObject({ code: "slow_down" })
  })

  it("does not slow_down once the interval has elapsed", async () => {
    const { run } = await poll(
      pendingRecord({ lastPolledAt: new Date(now.getTime() - 5001) }),
    )
    await expect(run()).rejects.toMatchObject({ code: "authorization_pending" })
  })

  it("expired_token once past expiry", async () => {
    const { run } = await poll(
      pendingRecord({ expiresAt: new Date(now.getTime() - 1) }),
    )
    await expect(run()).rejects.toMatchObject({ code: "expired_token" })
  })

  it("access_denied when the user declined", async () => {
    const { run } = await poll(pendingRecord({ status: "DENIED" }))
    await expect(run()).rejects.toMatchObject({ code: "access_denied" })
  })

  it("authorization_pending while awaiting approval", async () => {
    const { run } = await poll(pendingRecord())
    await expect(run()).rejects.toMatchObject({
      code: "authorization_pending",
    })
  })

  it("invalid_grant when the code was already consumed", async () => {
    const { run } = await poll(
      pendingRecord({ status: "APPROVED", consumedAt: now, userId: "user_1" }),
    )
    await expect(run()).rejects.toMatchObject({ code: "invalid_grant" })
  })

  it("returns the grant once, on the approved branch", async () => {
    const { run } = await poll(
      pendingRecord({
        status: "APPROVED",
        userId: "user_1",
        sessionId: "sess_1",
      }),
    )
    await expect(run()).resolves.toMatchObject({
      clientId: "jfp_tv_production",
      userId: "user_1",
      sessionId: "sess_1",
      codeChallengeMethod: "S256",
    })
  })

  it("loses the race when a concurrent poll claimed the code first", async () => {
    // Both polls read status APPROVED; the conditional write is what separates
    // them. count === 0 means this caller did not claim it.
    const { run } = await poll(
      pendingRecord({
        status: "APPROVED",
        userId: "user_1",
        sessionId: "sess_1",
      }),
      { updateMany: vi.fn(async (_args: unknown) => ({ count: 0 })) },
    )
    await expect(run()).rejects.toMatchObject({ code: "invalid_grant" })
  })

  it("claims with the full precondition, not just the code hash", async () => {
    const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }))
    const { prisma, run } = await poll(
      pendingRecord({
        status: "APPROVED",
        userId: "user_1",
        sessionId: "sess_1",
      }),
      { updateMany },
    )
    await run()

    void prisma
    const claim = updateMany.mock.calls.at(-1)?.[0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    expect(claim.where).toMatchObject({
      deviceCodeHash: hashDeviceSecret("device-code-raw"),
      status: "APPROVED",
      consumedAt: null,
    })
    expect(claim.where.expiresAt).toEqual({ gt: now })
    expect(claim.data).toMatchObject({ consumedAt: now })
  })
})

describe("approveDeviceCode", () => {
  it("transitions pending to approved as a single conditional write", async () => {
    const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }))
    const prisma = createPrismaMock({ deviceCode: { updateMany } })

    await approveDeviceCode(prisma as never, {
      userCode: "0194507302",
      userId: "user_1",
      sessionId: "sess_1",
      now,
    })

    const call = updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    expect(call.where).toMatchObject({
      userCodeHash: hashDeviceSecret("0194507302"),
      status: "PENDING",
      consumedAt: null,
    })
    expect(call.data).toMatchObject({
      status: "APPROVED",
      userId: "user_1",
      sessionId: "sess_1",
    })
  })

  it("reports an already-processed code distinctly from an unknown one", async () => {
    const prisma = createPrismaMock({
      deviceCode: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => ({
          status: "APPROVED",
          expiresAt: new Date(now.getTime() + 60_000),
          attemptCount: 0,
        })),
      },
    })

    await expect(
      approveDeviceCode(prisma as never, {
        userCode: "0194507302",
        userId: "user_1",
        sessionId: "sess_1",
        now,
      }),
    ).rejects.toMatchObject({ code: "device_code_already_processed" })
  })

  it("reports an unknown code as invalid_request", async () => {
    const prisma = createPrismaMock({
      deviceCode: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => null),
      },
    })

    await expect(
      approveDeviceCode(prisma as never, {
        userCode: "0000000000",
        userId: "user_1",
        sessionId: "sess_1",
        now,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" })
  })

  it("refuses a code that has burned its attempt budget", async () => {
    const prisma = createPrismaMock({
      deviceCode: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => ({
          status: "PENDING",
          expiresAt: new Date(now.getTime() + 60_000),
          attemptCount: MAX_USER_CODE_ATTEMPTS,
        })),
      },
    })

    await expect(
      approveDeviceCode(prisma as never, {
        userCode: "0194507302",
        userId: "user_1",
        sessionId: "sess_1",
        now,
      }),
    ).rejects.toMatchObject({ code: "expired_token" })
  })
})

describe("denyDeviceCode", () => {
  it("marks the code denied so the TV stops polling", async () => {
    const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }))
    const prisma = createPrismaMock({ deviceCode: { updateMany } })

    await denyDeviceCode(prisma as never, {
      userCode: "0194507302",
      userId: "user_1",
      now,
    })

    const call = updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect(call.data).toMatchObject({ status: "DENIED", userId: "user_1" })
  })
})

describe("user code attempt cap", () => {
  it("spends a code once its failed operations run out", async () => {
    // The counter lives on the row, so switching address does not reset it.
    // Note what this does NOT cover: a wrong guess matches no row, so it never
    // increments anything. This bounds retries against a code the caller
    // already holds, not guessing.
    const prisma = createPrismaMock({
      deviceCode: {
        findUnique: vi.fn(async () => ({
          id: "dc_1",
          clientId: "jfp_tv_production",
          scopes: ["openid"],
          status: "PENDING" as const,
          userId: null,
          expiresAt: new Date(now.getTime() + 60_000),
          attemptCount: MAX_USER_CODE_ATTEMPTS,
        })),
      },
    })

    await expect(
      findPendingByUserCode(prisma as never, {
        userCode: "0194507302",
        now,
      }),
    ).rejects.toBeInstanceOf(DeviceGrantError)
  })

  it("increments the counter by the hashed code", async () => {
    const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }))
    const prisma = createPrismaMock({ deviceCode: { updateMany } })

    await recordUserCodeAttempt(prisma as never, { userCode: "0194507302" })

    expect(updateMany).toHaveBeenCalledWith({
      where: { userCodeHash: hashDeviceSecret("0194507302") },
      data: { attemptCount: { increment: 1 } },
    })
  })

  it("admits a code that still has attempts left", async () => {
    const prisma = createPrismaMock({
      deviceCode: {
        findUnique: vi.fn(async () => ({
          id: "dc_1",
          clientId: "jfp_tv_production",
          scopes: ["openid"],
          status: "PENDING" as const,
          userId: null,
          expiresAt: new Date(now.getTime() + 60_000),
          attemptCount: MAX_USER_CODE_ATTEMPTS - 1,
        })),
      },
    })

    await expect(
      findPendingByUserCode(prisma as never, { userCode: "0194507302", now }),
    ).resolves.toMatchObject({ clientId: "jfp_tv_production" })
  })

  it("refuses an expired code even with attempts to spare", async () => {
    // Separate from the attempt-cap case on purpose: with only that test,
    // deleting the expiry guard left the whole suite green, so the approval
    // page would have offered an expired code as approvable.
    const prisma = createPrismaMock({
      deviceCode: {
        findUnique: vi.fn(async () => ({
          id: "dc_1",
          clientId: "jfp_tv_production",
          scopes: ["openid"],
          status: "PENDING" as const,
          userId: null,
          expiresAt: new Date(now.getTime() - 1),
          attemptCount: 0,
        })),
      },
    })

    await expect(
      findPendingByUserCode(prisma as never, { userCode: "0194507302", now }),
    ).rejects.toMatchObject({ code: "expired_token" })
  })
})

describe("purgeExpiredDeviceCodes", () => {
  it("deletes only rows already past expiry", async () => {
    const deleteMany = vi.fn(async () => ({ count: 3 }))
    const prisma = createPrismaMock({ deviceCode: { deleteMany } })

    await expect(
      purgeExpiredDeviceCodes(prisma as never, { now }),
    ).resolves.toBe(3)
    expect(deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: now } },
    })
  })
})

describe("expired code cleanup on issuance", () => {
  beforeEach(() => {
    resetDeviceCodePurgeState()
  })

  async function issue(prisma: Record<string, unknown>, at: Date) {
    return issueDeviceCode(prisma as never, {
      clientId: "jfp_tv_production",
      scopes: ["openid"],
      codeChallenge: "c".repeat(43),
      codeChallengeMethod: "S256",
      expiresInMs: 900_000,
      pollingIntervalMs: 5000,
      now: at,
    })
  }

  it("purges on issuance, so nothing has to be scheduled", async () => {
    // Without this the table grows for the life of the service: every issuance
    // writes a row and nothing else ever deletes one.
    const deleteMany = vi.fn(async (_args: unknown) => ({ count: 4 }))
    const prisma = createPrismaMock({ deviceCode: { deleteMany } })

    await issue(prisma, now)

    expect(deleteMany).toHaveBeenCalledTimes(1)
    const where = (
      deleteMany.mock.calls[0][0] as { where: { expiresAt: { lt: Date } } }
    ).where
    // A grace period behind `now`, so a code that expired seconds ago is still
    // present to explain itself to a late poll.
    expect(where.expiresAt.lt.getTime()).toBeLessThan(now.getTime())
  })

  it("does not purge again inside the interval", async () => {
    const deleteMany = vi.fn(async (_args: unknown) => ({ count: 0 }))
    const prisma = createPrismaMock({ deviceCode: { deleteMany } })

    await issue(prisma, now)
    await issue(prisma, new Date(now.getTime() + 60_000))
    await issue(prisma, new Date(now.getTime() + 120_000))

    expect(deleteMany).toHaveBeenCalledTimes(1)
  })

  it("purges again once the interval has elapsed", async () => {
    const deleteMany = vi.fn(async (_args: unknown) => ({ count: 0 }))
    const prisma = createPrismaMock({ deviceCode: { deleteMany } })

    await issue(prisma, now)
    await issue(prisma, new Date(now.getTime() + 11 * 60 * 1000))

    expect(deleteMany).toHaveBeenCalledTimes(2)
  })

  it("still issues a code when cleanup fails", async () => {
    // A viewer must never be turned away because a housekeeping query failed.
    const deleteMany = vi.fn(async (_args: unknown) => {
      throw new Error("deadlock detected")
    })
    const prisma = createPrismaMock({ deviceCode: { deleteMany } })

    await expect(issue(prisma, now)).resolves.toMatchObject({
      userCode: expect.stringMatching(/^[0-9]{10}$/),
    })
  })
})
