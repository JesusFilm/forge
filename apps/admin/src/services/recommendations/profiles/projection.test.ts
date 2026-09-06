import { describe, expect, it } from "vitest"
import {
  buildMultiInterestProjection,
  PROFILE_INTEREST_CLUSTER_LIMIT,
} from "./projection"

const vector = (...values: number[]) => values

describe("multi-interest profile projection", () => {
  it("keeps unrelated durable interests as deterministic medoids instead of one averaged persona", () => {
    const result = buildMultiInterestProjection({
      durableEvidence: [
        {
          sourceId: "outcome-faith-1",
          targetMediaId: "faith-a",
          embedding: vector(1, 0, 0),
          weight: 0.9,
          occurredAt: new Date("2026-08-25T08:00:00.000Z"),
        },
        {
          sourceId: "outcome-faith-2",
          targetMediaId: "faith-b",
          embedding: vector(0.98, 0.02, 0),
          weight: 0.8,
          occurredAt: new Date("2026-08-25T09:00:00.000Z"),
        },
        {
          sourceId: "outcome-family-1",
          targetMediaId: "family-a",
          embedding: vector(0, 1, 0),
          weight: 1,
          occurredAt: new Date("2026-08-25T10:00:00.000Z"),
        },
      ],
      sessionSelections: [],
      explicitPreferences: [],
      negativeEvidence: [],
    })

    expect(result.durableInterests).toHaveLength(2)
    expect(
      result.durableInterests.map((interest) => interest.medoidMediaId),
    ).toEqual(["faith-a", "family-a"])
    expect(
      result.durableInterests.flatMap((interest) => interest.sourceIds),
    ).toEqual(
      expect.arrayContaining([
        "outcome-faith-1",
        "outcome-faith-2",
        "outcome-family-1",
      ]),
    )
    expect(PROFILE_INTEREST_CLUSTER_LIMIT).toBeLessThanOrEqual(4)
  })

  it("lets selections shape only the short-lived session vector and preserves explicit and negative evidence separately", () => {
    const durable = {
      sourceId: "qualified-outcome",
      targetMediaId: "durable-video",
      embedding: vector(1, 0),
      weight: 1,
      occurredAt: new Date("2026-08-25T08:00:00.000Z"),
    }
    const result = buildMultiInterestProjection({
      durableEvidence: [durable],
      sessionSelections: [
        {
          sourceId: "selection-only",
          targetMediaId: "session-video",
          embedding: vector(0, 1),
          weight: 1,
          occurredAt: new Date("2026-08-25T10:00:00.000Z"),
        },
      ],
      explicitPreferences: [{ key: "declared:hope", weight: 0.75 }],
      negativeEvidence: [{ key: "explicit:not-for-me", weight: -0.5 }],
    })

    expect(result.durableInterests).toHaveLength(1)
    expect(result.durableInterests[0]?.medoidMediaId).toBe("durable-video")
    expect(result.sessionIntent?.medoidMediaId).toBe("session-video")
    expect(result.explicitPreferences).toEqual([
      { key: "declared:hope", weight: 0.75 },
    ])
    expect(result.negativeEvidence).toEqual([
      { key: "explicit:not-for-me", weight: -0.5 },
    ])
  })

  it("bounds contribution influence and remains deterministic under input replay", () => {
    const evidence = Array.from({ length: 80 }, (_, index) => ({
      sourceId: `outcome-${index}`,
      targetMediaId: `video-${index}`,
      embedding: vector(index % 2, (index + 1) % 2),
      weight: 100,
      occurredAt: new Date("2026-08-25T10:00:00.000Z"),
    }))
    const forward = buildMultiInterestProjection({
      durableEvidence: evidence,
      sessionSelections: [],
      explicitPreferences: [],
      negativeEvidence: [],
    })
    const replay = buildMultiInterestProjection({
      durableEvidence: [...evidence].reverse(),
      sessionSelections: [],
      explicitPreferences: [],
      negativeEvidence: [],
    })

    expect(replay).toEqual(forward)
    expect(forward.contributionCount).toBeLessThanOrEqual(64)
    expect(
      forward.durableInterests.every((interest) => interest.weight <= 1),
    ).toBe(true)
  })
})
