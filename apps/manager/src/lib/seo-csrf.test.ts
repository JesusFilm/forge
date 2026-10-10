import { beforeEach, describe, expect, it } from "vitest"
import {
  consumeSeoCsrfToken,
  issueSeoCsrfToken,
  resetSeoCsrfStateForTests,
} from "./seo-csrf"

describe("SEO mutation CSRF tokens", () => {
  beforeEach(() => resetSeoCsrfStateForTests())

  it("accepts an actor-bound token once and rejects replay", () => {
    const token = issueSeoCsrfToken(
      "manager-user-7",
      new Date("2026-08-01T12:00:00.000Z"),
      "nonce-1",
    )
    expect(
      consumeSeoCsrfToken(
        token,
        "manager-user-7",
        new Date("2026-08-01T12:01:00.000Z"),
      ),
    ).toEqual({ ok: true })
    expect(
      consumeSeoCsrfToken(
        token,
        "manager-user-7",
        new Date("2026-08-01T12:01:01.000Z"),
      ),
    ).toEqual({ ok: false, reason: "reused" })
  })

  it("rejects another actor, expiry, and tampering", () => {
    const token = issueSeoCsrfToken(
      "manager-user-7",
      new Date("2026-08-01T12:00:00.000Z"),
      "nonce-2",
    )
    expect(
      consumeSeoCsrfToken(
        token,
        "manager-user-8",
        new Date("2026-08-01T12:01:00.000Z"),
      ),
    ).toEqual({ ok: false, reason: "actor_mismatch" })
    expect(
      consumeSeoCsrfToken(
        token,
        "manager-user-7",
        new Date("2026-08-01T12:16:00.000Z"),
      ),
    ).toEqual({ ok: false, reason: "expired" })
    expect(
      consumeSeoCsrfToken(
        `${token}tampered`,
        "manager-user-7",
        new Date("2026-08-01T12:01:00.000Z"),
      ),
    ).toEqual({ ok: false, reason: "invalid" })
  })
})
