import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { _internal } from "./authored-data"

/**
 * The modernizer prompt is authored DATA in the Workspace, not code, so nothing
 * in the type system or the pipeline notices when one of the owner's content
 * rules is edited out of it. Two rules in particular were absent from the
 * seeded prompt until 2026-08-13 and are the ones with a stated reason behind
 * them, so they are the ones worth pinning:
 *
 *  - AUDIENCE: the viewer already follows Jesus. Without it the model turns a
 *    devotional for a believer into an altar call, and every individual
 *    sentence still reads fine, which is what makes the drift hard to catch by
 *    reading the output.
 *  - DESCRIBE, DON'T COMMAND: a synthetic voice has no reputation to spend, so
 *    imperatives land as scolding.
 *
 * SCOPE, deliberately narrow: this guards the COMMITTED seed document, which is
 * what a fresh environment migrates from. In Railway the writable S3 Workspace
 * is authoritative and an operator can edit prompts there without a deploy, and
 * the migration script reports a conflict rather than overwriting a diverged
 * destination. So a green run here does NOT prove the live prompt carries these
 * rules. It proves the next environment seeded from this repo will.
 */
describe("authored modernizer prompt", () => {
  const document = JSON.parse(
    readFileSync(
      path.resolve("devotional-workspace/inputs/prompts/generation.json"),
      "utf8",
    ),
  ) as unknown
  const prompts = _internal.PromptBundleSchema.parse(document).prompts

  it("keeps the audience rule so the reflection is not redirected at seekers", () => {
    expect(prompts.modernizer).toContain("ALREADY follows Jesus")
    expect(prompts.modernizer).toContain(
      "DO NOT REDIRECT THE AUTHOR'S AUDIENCE",
    )
    expect(prompts.modernizer).toContain("altar call")
  })

  it("keeps the no-imperatives rule and its worked example", () => {
    expect(prompts.modernizer).toContain("DESCRIBE, DON'T COMMAND")
    expect(prompts.modernizer).toContain("SYNTHETIC VOICE")
    expect(prompts.modernizer).toContain("Never stack imperatives")
    // The rule is easy to keep as a slogan and lose as guidance, so pin the
    // before/after pair that shows what converting an imperative looks like.
    expect(prompts.modernizer).toContain("Renounce the sins that have held you")
    expect(prompts.modernizer).toContain("A heart that has tasted his grace")
  })

  it("still ends on the JSON output contract", () => {
    // Both rules were inserted ABOVE this line on purpose: the output contract
    // is the last thing the model reads.
    expect(prompts.modernizer.trimEnd()).toMatch(
      /Return JSON only: an object with an 'adapted' string\.$/,
    )
  })
})
