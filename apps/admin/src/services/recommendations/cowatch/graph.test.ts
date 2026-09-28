import { describe, expect, it } from "vitest"
import {
  buildCowatchGraph,
  compatibleCowatchFeature,
  COWATCH_FEATURE_VERSION,
  COWATCH_MAX_GAP_MS,
  type CowatchOutcome,
} from "./graph"

const NOW = new Date("2026-09-28T00:00:00.000Z")
const DAY = 86_400_000

function outcome(
  viewer: string,
  session: string,
  media: string,
  offsetMs: number,
  overrides: Partial<CowatchOutcome> = {},
): CowatchOutcome {
  return {
    outcomeId: `${viewer}-${session}-${media}-${offsetMs}`,
    episodeId: `${viewer}-${session}-${media}-${offsetMs}`,
    revision: 1,
    mediaId: media,
    sessionDigest: session,
    viewerKey: viewer,
    occurredAt: new Date(NOW.getTime() - 2 * DAY + offsetMs),
    qualified: true,
    finalized: true,
    integrityEligible: true,
    eligibilityDecisionId: `${viewer}-${session}-${media}-${offsetMs}-decision`,
    eligibilityRevision: 1,
    eligibilityPolicyVersion: "recommendation-integrity-v1",
    qualityWeight: 1,
    expiresAt: new Date(NOW.getTime() + DAY),
    ...overrides,
  }
}

function pair(viewer: string, session: string, a = "A", b = "B") {
  return [outcome(viewer, session, a, 0), outcome(viewer, session, b, 1_000)]
}

describe("directional co-watch graph", () => {
  it("keeps direction, bounded gap and session/pair dedup exact", () => {
    const graph = buildCowatchGraph(
      [
        ...pair("v1", "s1"),
        outcome("v1", "s1", "A", 2_000),
        outcome("v1", "s1", "B", 3_000),
        ...pair("v2", "s2", "B", "A"),
        outcome("v2", "s2", "C", COWATCH_MAX_GAP_MS + 4_000),
      ],
      NOW,
    )
    expect(
      graph.contributions.filter(
        (row) => row.sourceMediaId === "A" && row.targetMediaId === "B",
      ),
    ).toHaveLength(1)
    expect(
      graph.edges.find(
        (row) => row.sourceMediaId === "A" && row.targetMediaId === "B",
      )?.distinctViewerSupport,
    ).toBe(1)
    expect(
      graph.edges.find(
        (row) => row.sourceMediaId === "B" && row.targetMediaId === "A",
      )?.distinctViewerSupport,
    ).toBe(2)
    expect(graph.edges.some((row) => row.targetMediaId === "C")).toBe(false)
  })

  it("replaces a superseded qualified revision and exactly removes deleted evidence", () => {
    const rows = [...pair("v1", "s1"), ...pair("v2", "s2"), ...pair("v3", "s3")]
    const original = buildCowatchGraph(rows, NOW)
    const corrected = buildCowatchGraph(
      [
        ...rows,
        { ...rows[1], outcomeId: "corrected", revision: 2, qualified: false },
      ],
      NOW,
    )
    expect(
      original.edges.find((edge) => edge.sourceMediaId === "A")
        ?.distinctViewerSupport,
    ).toBe(3)
    expect(
      corrected.edges.find((edge) => edge.sourceMediaId === "A")
        ?.distinctViewerSupport,
    ).toBe(2)
    expect(corrected).toEqual(
      buildCowatchGraph(
        rows.filter((row) => row.episodeId !== rows[1].episodeId),
        NOW,
      ),
    )
    expect(buildCowatchGraph([...rows].reverse(), NOW)).toEqual(original)
  })

  it("one viewer across sessions cannot manufacture distinct support", () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      pair("v1", `s${index}`),
    ).flat()
    const graph = buildCowatchGraph(rows, NOW)
    const edge = graph.edges.find((row) => row.sourceMediaId === "A")
    expect(edge?.distinctViewerSupport).toBe(1)
    expect(edge?.eligible).toBe(false)
  })

  it("corrects for a globally popular target and fences sparse features", () => {
    const rows = [
      ...pair("v1", "s1"),
      ...pair("v2", "s2"),
      ...pair("v3", "s3"),
      ...Array.from({ length: 20 }, (_, index) =>
        outcome(`other-${index}`, `other-${index}`, "B", 0),
      ),
    ]
    const graph = buildCowatchGraph(rows, NOW)
    const edge = graph.edges.find(
      (row) => row.sourceMediaId === "A" && row.targetMediaId === "B",
    )!
    expect(edge.popularityCorrectedLift).toBeLessThan(1.1)
    expect(edge.eligible).toBe(false)
    expect(compatibleCowatchFeature(edge, graph.generation)).toBeNull()
    expect(
      compatibleCowatchFeature({ ...edge, eligible: true }, "old"),
    ).toBeNull()
    expect(
      compatibleCowatchFeature(
        {
          ...edge,
          eligible: true,
          contractVersion: "unknown" as typeof COWATCH_FEATURE_VERSION,
        },
        graph.generation,
      ),
    ).toBeNull()
  })

  it("changes generation identity when a singleton changes the popularity denominator", () => {
    const pairs = [
      ...pair("v1", "s1"),
      ...pair("v2", "s2"),
      ...pair("v3", "s3"),
    ]
    const first = buildCowatchGraph(pairs, NOW)
    const second = buildCowatchGraph(
      [...pairs, outcome("v4", "s4", "C", 0)],
      NOW,
    )
    expect(second.contributions).toEqual(first.contributions)
    expect(second.generation).not.toBe(first.generation)
    expect(second.sources).toHaveLength(first.sources.length + 1)
    expect(second.edges[0].popularityCorrectedLift).not.toBe(
      first.edges[0].popularityCorrectedLift,
    )
  })

  it("weights quality and recency without changing support", () => {
    const graph = buildCowatchGraph(
      [
        outcome("v1", "s1", "A", 0, { qualityWeight: 0.25 }),
        outcome("v1", "s1", "B", 1_000, { qualityWeight: 1 }),
      ],
      NOW,
    )
    expect(graph.contributions[0].qualityWeight).toBe(0.5)
    expect(graph.contributions[0].recencyWeight).toBeGreaterThan(0)
    expect(graph.contributions[0].recencyWeight).toBeLessThan(1)
    expect(graph.contributions[0].effectiveWeight).toBeLessThan(0.5)
  })
})
