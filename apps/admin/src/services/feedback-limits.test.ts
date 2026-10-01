// The three feedback counters (KTD3) against the REAL fixed-window counter.
//
// `@/config/env` is mocked so the daily cap is settable per test. The mock
// also leaves REDIS_HOST unset, which is what puts `incrementFixedWindow` on
// its in-process fallback — the Redis-absent path the plan asks for.

import { beforeEach, describe, expect, it, vi } from "vitest"

const { envMock } = vi.hoisted(() => ({
  envMock: { ADMIN_FEEDBACK_DAILY_CAP: undefined as unknown },
}))

vi.mock("@/config/env", () => ({ env: envMock }))

import { resetLocalRateLimitState } from "@/auth/rate-limit"
import {
  FEEDBACK_ADDRESS_LIMIT,
  FEEDBACK_DAILY_CAP_DEFAULT,
  FEEDBACK_INSTALL_LIMIT,
  checkFeedbackLimits,
  feedbackDailyCap,
  feedbackDayKey,
} from "@/services/feedback-limits"

const DAY_MS = 24 * 60 * 60_000

function send(overrides: {
  installIdentity?: string
  clientIp?: string
  now?: number
}) {
  return checkFeedbackLimits({
    installIdentity: overrides.installIdentity ?? "consumer:key:v:install-a",
    clientIp: overrides.clientIp ?? "203.0.113.9",
    ...(overrides.now != null ? { now: overrides.now } : {}),
  })
}

beforeEach(() => {
  resetLocalRateLimitState()
  envMock.ADMIN_FEEDBACK_DAILY_CAP = 1000
})

describe("feedbackDailyCap", () => {
  // The env type says `number`, but `skipValidation` (set whenever CI is set)
  // makes zod defaults absent. Each case here is a shape that reaches the
  // module in a real environment.
  it.each([
    ["absent", undefined, FEEDBACK_DAILY_CAP_DEFAULT],
    ["a validated number", 200, 200],
    ["an unvalidated string", "50", 50],
    ["zero", 0, 0],
    ["a string zero", "0", 0],
    ["negative", -1, FEEDBACK_DAILY_CAP_DEFAULT],
    ["fractional", 1.5, FEEDBACK_DAILY_CAP_DEFAULT],
    ["unparseable", "many", FEEDBACK_DAILY_CAP_DEFAULT],
  ])("reads %s as %s", (_label, raw, expected) => {
    envMock.ADMIN_FEEDBACK_DAILY_CAP = raw
    expect(feedbackDailyCap()).toBe(expected)
  })

  it("defaults to the same number the env schema declares", () => {
    expect(FEEDBACK_DAILY_CAP_DEFAULT).toBe(200)
  })
})

describe("feedbackDayKey", () => {
  it("names the UTC date, so the counter turns over at midnight UTC", () => {
    expect(feedbackDayKey(Date.parse("2026-09-14T23:59:59.999Z"))).toBe(
      "2026-09-14",
    )
    expect(feedbackDayKey(Date.parse("2026-09-15T00:00:00.000Z"))).toBe(
      "2026-09-15",
    )
  })
})

describe("per-install limit", () => {
  it(`allows ${FEEDBACK_INSTALL_LIMIT} and refuses the next one`, async () => {
    for (let i = 0; i < FEEDBACK_INSTALL_LIMIT; i++) {
      expect(await send({})).toEqual({ allowed: true })
    }
    expect(await send({})).toEqual({
      allowed: false,
      scope: "install",
      refusal: "RATE_LIMITED",
    })
  })

  it("keeps two installs behind one address independent (AE15)", async () => {
    const clientIp = "198.51.100.4"
    for (let i = 0; i < FEEDBACK_INSTALL_LIMIT; i++) {
      await send({ installIdentity: "install-a", clientIp })
    }
    expect(await send({ installIdentity: "install-a", clientIp })).toEqual({
      allowed: false,
      scope: "install",
      refusal: "RATE_LIMITED",
    })
    expect(await send({ installIdentity: "install-b", clientIp })).toEqual({
      allowed: true,
    })
  })
})

describe("per-address limit", () => {
  it(`allows ${FEEDBACK_ADDRESS_LIMIT} from one address across installs`, async () => {
    const clientIp = "198.51.100.5"
    for (let i = 0; i < FEEDBACK_ADDRESS_LIMIT; i++) {
      // A fresh identity each time: the address bound is what has to fire,
      // not the install bound.
      expect(await send({ installIdentity: `install-${i}`, clientIp })).toEqual(
        { allowed: true },
      )
    }
    expect(await send({ installIdentity: "install-last", clientIp })).toEqual({
      allowed: false,
      scope: "address",
      refusal: "RATE_LIMITED",
    })
  })
})

describe("daily cap", () => {
  it("refuses the call that passes the cap", async () => {
    envMock.ADMIN_FEEDBACK_DAILY_CAP = 2
    expect(await send({ installIdentity: "a" })).toEqual({ allowed: true })
    expect(await send({ installIdentity: "b" })).toEqual({ allowed: true })
    expect(await send({ installIdentity: "c" })).toEqual({
      allowed: false,
      scope: "daily",
      refusal: "DAILY_CAP",
    })
  })

  it("refuses the FIRST call when the cap is 0 — the kill switch", async () => {
    envMock.ADMIN_FEEDBACK_DAILY_CAP = 0
    expect(await send({})).toEqual({
      allowed: false,
      scope: "daily",
      refusal: "DAILY_CAP",
    })
  })

  it("starts again on the next UTC day", async () => {
    envMock.ADMIN_FEEDBACK_DAILY_CAP = 1
    const day = Date.parse("2026-09-14T12:00:00.000Z")
    expect(await send({ installIdentity: "a", now: day })).toEqual({
      allowed: true,
    })
    expect(await send({ installIdentity: "b", now: day })).toEqual({
      allowed: false,
      scope: "daily",
      refusal: "DAILY_CAP",
    })
    expect(await send({ installIdentity: "c", now: day + DAY_MS })).toEqual({
      allowed: true,
    })
  })

  it("does not spend the day on a call the install limit already refused", async () => {
    // With the cap at 6 and the install limit at 5: install A spends 5, its
    // sixth is refused, and B's first call must still be inside the cap. If
    // the refused call had debited the day, B would read DAILY_CAP here.
    envMock.ADMIN_FEEDBACK_DAILY_CAP = FEEDBACK_INSTALL_LIMIT + 1
    for (let i = 0; i < FEEDBACK_INSTALL_LIMIT; i++) {
      await send({ installIdentity: "a" })
    }
    expect(await send({ installIdentity: "a" })).toEqual({
      allowed: false,
      scope: "install",
      refusal: "RATE_LIMITED",
    })
    expect(await send({ installIdentity: "b" })).toEqual({ allowed: true })
  })
})
