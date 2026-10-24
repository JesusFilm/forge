// The native Datadog SDK never links under jest; stub the emit surface so every
// signal is assertable without pulling it in.
jest.mock("../datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  reportDatadogAction: jest.fn(),
}))

import { datadogLog, reportDatadogAction } from "../datadog"
import {
  DEVICE_GRANT_APPROVED_ACTION,
  MAX_DETAIL_LENGTH,
  REDACTED,
  reportAnonymousMergeOutcome,
  reportDeviceGrantApproved,
  reportDeviceGrantCodeRequestFailed,
  reportDeviceGrantCodeRequested,
  reportDeviceGrantDegraded,
  reportDeviceGrantDenied,
  reportDeviceGrantError,
  reportDeviceGrantExpired,
  reportDeviceGrantRefreshFailed,
  reportDeviceGrantSignedOut,
  sanitizeDeviceGrantDetail,
} from "./deviceGrantTelemetry"

const info = datadogLog.info as jest.Mock
const warn = datadogLog.warn as jest.Mock
const action = reportDatadogAction as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

/** The live code as apps/auth mints it: ten digits, no hyphens on the wire. */
const USER_CODE = "0194507302"

describe("sanitizeDeviceGrantDetail — the user code cannot survive", () => {
  const carriers = [
    `error: see https://auth.jesusfilm.org/device?user_code=${USER_CODE}`,
    `verification_uri_complete=https://auth.jesusfilm.org/device?user_code=019-450-7302`,
    `{"error":"invalid_grant","user_code":"${USER_CODE}"}`,
    `enter 019-450-7302 on your phone`,
    `enter 019 450 7302 on your phone`,
    `code ${USER_CODE} expired`,
    `https://auth.jesusfilm.org/device#user_code=${USER_CODE}`,
  ]

  it.each(carriers)("redacts every digit of the code in %s", (carrier) => {
    const out = sanitizeDeviceGrantDetail(carrier)
    expect(out).not.toContain(USER_CODE)
    expect(out).not.toContain("019-450-7302")
    expect(out).not.toContain("019 450 7302")
    // Not even a usable fragment: no run of 4+ digits survives anywhere.
    expect(out).not.toMatch(/\d(?:[\s-]?\d){3,}/)
  })

  it("redacts the letters format too, in case the server flips DEVICE_USER_CODE_FORMAT", () => {
    expect(sanitizeDeviceGrantDetail("code BXKD-QWNM expired")).toBe(
      `code ${REDACTED} expired`,
    )
    expect(sanitizeDeviceGrantDetail("code BXKDQWNM expired")).toBe(
      `code ${REDACTED} expired`,
    )
  })

  it("keeps the URL's origin and path, so the failure is still diagnosable", () => {
    expect(
      sanitizeDeviceGrantDetail(
        `POST https://auth.jesusfilm.org/api/auth/device/token?user_code=${USER_CODE} failed`,
      ),
    ).toBe("POST https://auth.jesusfilm.org/api/auth/device/token failed")
  })

  it("flattens newlines and tabs into one line", () => {
    const out = sanitizeDeviceGrantDetail("first line\nsecond\tthird\r\nfourth")
    expect(out).toBe("first line second third fourth")
    expect(out).not.toMatch(/[\r\n\t]/)
  })

  it("caps length", () => {
    const out = sanitizeDeviceGrantDetail("x".repeat(1000))
    expect(out).toHaveLength(MAX_DETAIL_LENGTH)
  })

  it("redacts BEFORE capping, so truncation cannot publish a code prefix", () => {
    // The code sits past the cap: if the cap ran first the redaction would
    // never see it, and if the cap ran first on a code straddling the boundary
    // a guessable prefix would ship. Assert against the whole raw code and
    // against every prefix of it.
    const out = sanitizeDeviceGrantDetail(
      `${"pad ".repeat(40)}user_code=${USER_CODE}`,
    )
    expect(out).toHaveLength(MAX_DETAIL_LENGTH)
    for (let i = 4; i <= USER_CODE.length; i += 1) {
      expect(out).not.toContain(USER_CODE.slice(0, i))
    }
  })

  it("accepts an Error and reports only its message", () => {
    const error = new Error(`token failed for user_code=${USER_CODE}`)
    const out = sanitizeDeviceGrantDetail(error)
    expect(out).not.toContain(USER_CODE)
    expect(out).toContain("token failed")
  })

  it("survives non-string, non-Error input", () => {
    expect(sanitizeDeviceGrantDetail(undefined)).toBe("undefined")
    expect(sanitizeDeviceGrantDetail(null)).toBe("null")
    expect(sanitizeDeviceGrantDetail({ a: 1 })).toBe("[object Object]")
  })
})

describe("signals", () => {
  it("reports a code request with an empty context", () => {
    reportDeviceGrantCodeRequested()
    expect(info).toHaveBeenCalledWith("device_grant.code_requested", {})
  })

  it("sanitizes the code-request failure reason", () => {
    reportDeviceGrantCodeRequestFailed(
      new Error(`https://auth.jesusfilm.org/device?user_code=${USER_CODE}`),
    )
    const [, context] = warn.mock.calls[0]!
    expect(context.reason).not.toContain(USER_CODE)
    expect(warn).toHaveBeenCalledWith(
      "device_grant.code_request_failed",
      expect.objectContaining({ reason: expect.any(String) }),
    )
  })

  it("reports approval as a duration, never an identity", () => {
    reportDeviceGrantApproved(41.6)
    expect(action).toHaveBeenCalledWith(DEVICE_GRANT_APPROVED_ACTION, {
      waited_seconds: 42,
    })
  })

  it("floors a negative duration rather than reporting it", () => {
    reportDeviceGrantApproved(-5)
    expect(action).toHaveBeenCalledWith(DEVICE_GRANT_APPROVED_ACTION, {
      waited_seconds: 0,
    })
  })

  it("reports denial and expiry with no context at all", () => {
    reportDeviceGrantDenied()
    reportDeviceGrantExpired()
    expect(info).toHaveBeenCalledWith("device_grant.denied", {})
    expect(info).toHaveBeenCalledWith("device_grant.expired", {})
  })

  it("sanitizes a terminal error code off the wire", () => {
    reportDeviceGrantError(`invalid_grant for ${USER_CODE}`)
    const [, context] = warn.mock.calls[0]!
    expect(context.code).toBe(`invalid_grant for ${REDACTED}`)
  })

  it("reports transport degradation as a count", () => {
    reportDeviceGrantDegraded(3)
    expect(warn).toHaveBeenCalledWith("device_grant.transport_degraded", {
      consecutive_errors: 3,
    })
  })

  it("sanitizes a refresh failure reason", () => {
    reportDeviceGrantRefreshFailed(`refresh rejected, user_code=${USER_CODE}`)
    const [, context] = warn.mock.calls[0]!
    expect(context.reason).not.toContain(USER_CODE)
  })

  it("distinguishes a revoked sign-out from a local-only one", () => {
    reportDeviceGrantSignedOut("revoked")
    reportDeviceGrantSignedOut("local_only")
    expect(info).toHaveBeenCalledWith("device_grant.signed_out", {
      scope: "revoked",
    })
    expect(info).toHaveBeenCalledWith("device_grant.signed_out", {
      scope: "local_only",
    })
  })

  it("reports the merge outcome as a status plus counts", () => {
    reportAnonymousMergeOutcome({
      status: "promoted",
      eventsSubmitted: 2,
      eventsRetained: 1,
    })
    expect(info).toHaveBeenCalledWith("device_grant.anonymous_merge", {
      status: "promoted",
      events_submitted: 2,
      events_retained: 1,
    })
  })

  it("defaults the merge counts when the outcome carries none", () => {
    reportAnonymousMergeOutcome({ status: "reset_for_other_user" })
    expect(info).toHaveBeenCalledWith("device_grant.anonymous_merge", {
      status: "reset_for_other_user",
      events_submitted: 0,
      events_retained: 0,
    })
  })
})

// The whole-source zero-PII guard (`setUser`/`setUserInfo` appears nowhere in
// src/) lives in `zeroPii.guard.test.js` — it needs Node's fs/path, which the RN
// tsconfig has no types for, so it follows the repo's `.guard.test.js` precedent.
