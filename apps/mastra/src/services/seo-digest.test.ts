import { describe, expect, it } from "vitest"

import {
  digestSeoProposalPayload,
  digestSeoValue,
  stableSeoJson,
} from "./seo-digest"

describe("SEO canonical digests", () => {
  it("sorts object keys recursively without reordering arrays", () => {
    const left = { z: [{ b: 2, a: 1 }], a: "value" }
    const right = { a: "value", z: [{ a: 1, b: 2 }] }

    expect(stableSeoJson(left)).toBe('{"a":"value","z":[{"a":1,"b":2}]}')
    expect(digestSeoValue(left)).toBe(digestSeoValue(right))
  })

  it("excludes transport identity fields from proposal payload digests", () => {
    const payload = { title: "A", intent: "Serve search intent" }

    expect(
      digestSeoProposalPayload({
        ...payload,
        proposalId: "proposal-a",
        payloadDigest: "stale",
        semanticConflictKey: "page:title",
      }),
    ).toBe(digestSeoValue(payload))
  })
})
