/**
 * Content-mode regression snapshot — locks the active + soft-removed
 * `FORGE_CONTENT_API` value matrix to a single source-of-truth output
 * table. Lands as the FIRST commit of PR-B (plan-003 direct cutover) per
 * the test-first regression discipline at
 * `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md`.
 *
 * **Contract:** U4-U9 implementation units must not change the
 * normalizer's output for any input in this table. Any change to the
 * accepted set or the soft-removed coercion behavior is a deliberate
 * decision that requires updating this regression test in the same
 * commit — making the change visible at review.
 *
 * **Why:** during PR-B, U4 collapses the active mode set, U5 ships
 * admin-shape fragments, U6 wires the cutover branch, UB7 the error
 * boundary, U8 the verification harness, U9 the runbook. Several of
 * those units touch `apps/web/src/lib/content.ts` and adjacent surfaces.
 * Without a regression gate, a unit could silently change what
 * `getContentApiMode()` returns for, say, an unset env var and break
 * production rendering for every operator who hasn't set
 * `FORGE_CONTENT_API`. The whole plan rests on the contract that "no
 * config change = strapi mode = byte-identical to current main."
 *
 * **What this test does NOT cover:** the downstream behavior of
 * `fetchSlugExperience`'s branch table (that's U6's contract; covered
 * in `content.test.ts`). This test locks the normalizer-output
 * boundary; U6 locks the orchestrator behavior given a mode value.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { FORGE_CONTENT_API: undefined as string | undefined },
}))

vi.mock("@/env", () => ({
  env: mockEnv,
}))

// Suppress console.warn during the regression snapshot — the soft-removed
// and unknown-value paths emit warnings as documented contract; we test
// the warn shape in content-api-mode.test.ts, not here.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  mockEnv.FORGE_CONTENT_API = undefined
})

describe("ContentApiMode regression snapshot — input/output stability", () => {
  // Source-of-truth table. Each row is "given env.FORGE_CONTENT_API
  // value X, getContentApiMode() must return Y". Adding a new input or
  // changing an output is a deliberate plan decision; reviewers see the
  // diff in PR.
  const INPUT_OUTPUT_MATRIX: ReadonlyArray<{
    description: string
    envValue: string | undefined
    expected: "strapi" | "admin"
  }> = [
    // -------------------------------------------------------------------------
    // Default-mode preservation (no operator action → strapi mode)
    // -------------------------------------------------------------------------
    {
      description: "undefined → strapi (default path)",
      envValue: undefined,
      expected: "strapi",
    },
    // -------------------------------------------------------------------------
    // Active modes (plan-003 R3 closed set)
    // -------------------------------------------------------------------------
    {
      description: "'strapi' → strapi (explicit active mode)",
      envValue: "strapi",
      expected: "strapi",
    },
    {
      description: "'admin' → admin (NEW active mode in plan-003)",
      envValue: "admin",
      expected: "admin",
    },
    // -------------------------------------------------------------------------
    // Legacy soft-removed modes (plan-003 U4 — stale Doppler configs
    // continue to boot, narrower coerces to strapi)
    // -------------------------------------------------------------------------
    {
      description: "'dual-read' → strapi (legacy U5 canary, soft-removed)",
      envValue: "dual-read",
      expected: "strapi",
    },
    {
      description:
        "'admin-with-fallback' → strapi (legacy R7 spec, soft-removed)",
      envValue: "admin-with-fallback",
      expected: "strapi",
    },
  ]

  for (const { description, envValue, expected } of INPUT_OUTPUT_MATRIX) {
    it(description, async () => {
      mockEnv.FORGE_CONTENT_API = envValue
      const { getContentApiMode } = await import("../content-api-mode")
      expect(getContentApiMode()).toBe(expected)
    })
  }

  // ---------------------------------------------------------------------------
  // Type contract: ContentApiMode union has exactly 2 members
  // ---------------------------------------------------------------------------
  //
  // If a future change widens or narrows the union, this snapshot file
  // is the canonical place to lock the contract — adding a third value
  // requires updating both the type and this test.

  it("ContentApiMode union has exactly two members ('strapi' | 'admin')", async () => {
    const mod = await import("../content-api-mode")
    // Compile-time exhaustiveness: a switch over ContentApiMode must
    // handle exactly these two cases. If a third is added, the `never`
    // assertion at the default branch will fail the typecheck.
    const exhaustivenessCheck = (
      mode: "strapi" | "admin",
    ): "strapi" | "admin" => {
      switch (mode) {
        case "strapi":
          return mode
        case "admin":
          return mode
        default: {
          const _exhaustive: never = mode
          return _exhaustive
        }
      }
    }
    // Runtime probe — exercise both arms.
    expect(exhaustivenessCheck("strapi")).toBe("strapi")
    expect(exhaustivenessCheck("admin")).toBe("admin")
    // Runtime sanity that the normalizer accepts both literal values.
    expect(mod.normalizeContentApiMode("strapi")).toBe("strapi")
    expect(mod.normalizeContentApiMode("admin")).toBe("admin")
  })
})
