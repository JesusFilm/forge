import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { availabilityScore } from "./watch-search.service"
import { availabilityScoreForKind } from "./watch-search-availability-score"

describe("availabilityScoreForKind", () => {
  it("scores a container with the subtitle tier, not zero", () => {
    expect(availabilityScoreForKind("container")).toBe(0.18)
  })

  it("keeps the pre-existing kinds at their established contributions", () => {
    expect(availabilityScoreForKind("target_audio")).toBe(0.25)
    expect(availabilityScoreForKind("target_subtitle")).toBe(0.18)
    expect(availabilityScoreForKind("related_language")).toBe(0.08)
    expect(availabilityScoreForKind("unavailable")).toBe(0)
  })

  it("scores an unknown or absent persisted kind as zero rather than throwing", () => {
    // ops-data.ts reads this off persisted JSON, where a kind written by an
    // older or newer deploy can be anything.
    expect(availabilityScoreForKind(null)).toBe(0)
    expect(availabilityScoreForKind(undefined)).toBe(0)
    expect(availabilityScoreForKind("kind_from_a_future_deploy")).toBe(0)
  })

  it("is the same value live ranking applies", () => {
    const kinds = [
      "target_audio",
      "target_subtitle",
      "container",
      "related_language",
      "unavailable",
    ] as const
    for (const kind of kinds) {
      expect(
        availabilityScore({ kind } as Parameters<typeof availabilityScore>[0]),
      ).toBe(availabilityScoreForKind(kind))
    }
  })

  // Live ranking, the stored trace breakdown, and the operator dashboard each
  // read this contribution. When they held private copies, adding a kind to
  // one left the others returning 0, so a stored breakdown no longer summed to
  // its stored total. Keep every reader on the shared owner.
  it.each([
    ["src/services/watch-search.service.ts"],
    ["src/services/search-trace.service.ts"],
    ["src/app/dashboard/ops-data.ts"],
  ])("%s reads the shared owner rather than its own copy", (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8")
    expect(source).toContain("watch-search-availability-score")
    expect(source).not.toMatch(/if \(kind === "target_audio"\) return 0\.25/)
    expect(source).not.toMatch(
      /if \(watchability\?\.kind === "target_audio"\) return 0\.25/,
    )
  })
})
