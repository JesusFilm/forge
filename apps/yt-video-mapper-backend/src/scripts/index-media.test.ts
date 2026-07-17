import { describe, expect, it } from "vitest"
import { shouldFailMediaIndexCli } from "./index-media.js"

describe("index-media CLI exit policy", () => {
  it("fails automation when the run itself fails", () => {
    expect(
      shouldFailMediaIndexCli({
        status: "failed",
        variantsAttempted: 0,
        variantsIndexed: 0,
        variantsFailed: 0,
      }),
    ).toBe(true)
  })

  it("fails automation when every attempted variant failed", () => {
    expect(
      shouldFailMediaIndexCli({
        status: "completed",
        variantsAttempted: 12,
        variantsIndexed: 0,
        variantsFailed: 12,
      }),
    ).toBe(true)
  })

  it("allows completed runs with any successful indexed variant", () => {
    expect(
      shouldFailMediaIndexCli({
        status: "completed",
        variantsAttempted: 12,
        variantsIndexed: 1,
        variantsFailed: 11,
      }),
    ).toBe(false)
  })

  it("allows idempotent reruns with skipped indexed variants and one failure", () => {
    expect(
      shouldFailMediaIndexCli({
        status: "completed",
        variantsAttempted: 12,
        variantsIndexed: 0,
        variantsFailed: 1,
      }),
    ).toBe(false)
  })
})
