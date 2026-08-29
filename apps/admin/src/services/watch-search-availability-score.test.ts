import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { availabilityScore, watchabilityRank } from "./watch-search.service"
import {
  availabilityScoreForKind,
  watchabilityRankForKind,
} from "./watch-search-availability-score"

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
    // The Typesense serving path was a FOURTH private copy, written as a
    // nested ternary rather than an if-chain, so neither pattern above would
    // have caught it. It went unnoticed long enough for the shared owner's own
    // doc comment to say "three surfaces".
    ["src/services/typesense-watch-search.service.ts"],
  ])("%s reads the shared owner rather than its own copy", (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8")
    expect(source).toContain("watch-search-availability-score")
    expect(source).not.toMatch(/if \(kind === "target_audio"\) return 0\.25/)
    expect(source).not.toMatch(
      /if \(watchability\?\.kind === "target_audio"\) return 0\.25/,
    )
    // The ternary form the Typesense copy used.
    expect(source).not.toMatch(/kind === "target_audio"\s*\n?\s*\?\s*0\.25/)
  })
})

describe("watchabilityRankForKind", () => {
  it("sorts a container between target subtitles and a related language", () => {
    expect(watchabilityRankForKind("target_audio")).toBe(0)
    expect(watchabilityRankForKind("target_subtitle")).toBe(1)
    expect(watchabilityRankForKind("container")).toBe(2)
    expect(watchabilityRankForKind("related_language")).toBe(3)
    expect(watchabilityRankForKind("unavailable")).toBe(4)
  })

  it("sorts an unknown or absent persisted kind last rather than throwing", () => {
    expect(watchabilityRankForKind(null)).toBe(4)
    expect(watchabilityRankForKind(undefined)).toBe(4)
    expect(watchabilityRankForKind("kind_from_a_future_deploy")).toBe(4)
  })

  // Both serving paths must order results identically, so neither may hold a
  // private ladder. The PostgreSQL adapter is exercised through its own
  // exported wrapper; the Typesense one is pinned by source above.
  it("is the order the PostgreSQL serving path applies", () => {
    const kinds = [
      "target_audio",
      "target_subtitle",
      "container",
      "related_language",
      "unavailable",
    ] as const
    for (const kind of kinds) {
      expect(
        watchabilityRank({ kind } as Parameters<typeof watchabilityRank>[0]),
      ).toBe(watchabilityRankForKind(kind))
    }
  })
})
