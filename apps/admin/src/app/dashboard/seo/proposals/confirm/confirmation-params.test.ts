import { describe, expect, it } from "vitest"

import {
  confirmationHref,
  parseConfirmationIdentity,
  parseConfirmationResult,
} from "./confirmation-params"

const DIGEST = "a".repeat(64)
const valid = {
  proposalId: "seo-rollback-abc:v2",
  version: "2",
  payloadDigest: DIGEST,
  decision: "decline",
}

describe("confirmation params", () => {
  it("parses a bound identity and round-trips it through the href", () => {
    const identity = parseConfirmationIdentity(valid)
    expect(identity).toEqual({
      proposalId: "seo-rollback-abc:v2",
      version: 2,
      payloadDigest: DIGEST,
      decision: "decline",
    })
    const href = confirmationHref(identity!, "REJECTED")
    const query = new URL(href, "https://admin.test").searchParams
    expect(parseConfirmationIdentity(Object.fromEntries(query))).toEqual(
      identity,
    )
    expect(parseConfirmationResult(query.get("result"))).toBe("REJECTED")
  })

  it.each([
    ["control character in id", { proposalId: "a\u0000b" }],
    ["padded id", { proposalId: " proposal-1" }],
    ["overlong id", { proposalId: "x".repeat(192) }],
    ["repeated param", { version: ["2", "3"] }],
    ["uppercase digest", { payloadDigest: "A".repeat(64) }],
    ["leading-zero version", { version: "02" }],
    ["publish action", { decision: "publish" }],
  ])("rejects %s", (_label, override) => {
    expect(parseConfirmationIdentity({ ...valid, ...override })).toBeNull()
  })

  it("accepts only closed result codes", () => {
    expect(parseConfirmationResult("CONFLICT")).toBe("CONFLICT")
    expect(parseConfirmationResult("conflict")).toBeNull()
    expect(parseConfirmationResult(["CONFLICT"])).toBeNull()
    expect(parseConfirmationResult(undefined)).toBeNull()
  })
})
