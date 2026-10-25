import { describe, expect, it } from "vitest"
import { classifyRecommendationHealth } from "./health"

const healthy = {
  databaseAvailable: true,
  retentionOverdue: false,
  durableSuccessWatermark: new Date("2026-08-19T00:00:00.000Z"),
  requestCount: 0,
  committedRejectionCount: 0,
  writeFailureCount: 0,
  replayCount: 0,
  conflictCount: 0,
  lateCount: 0,
  classifierLagCount: 0,
  selectionWithoutImpressionCount: 0,
}

describe("recommendation health truth table", () => {
  it("reports zero after a successful current probe and healthy retention", () => {
    expect(classifyRecommendationHealth(healthy)).toMatchObject({
      primary: "zero_activity",
      states: ["zero_activity"],
    })
    expect(
      classifyRecommendationHealth({
        ...healthy,
        databaseAvailable: false,
      }),
    ).toMatchObject({ primary: "unavailable_unknown" })
    expect(
      classifyRecommendationHealth({
        ...healthy,
        durableSuccessWatermark: null,
      }),
    ).toMatchObject({ primary: "unavailable_unknown" })
    expect(
      classifyRecommendationHealth({
        ...healthy,
        requestCount: 1,
        durableSuccessWatermark: null,
      }),
    ).toMatchObject({ primary: "unavailable_unknown" })
    expect(
      classifyRecommendationHealth({ ...healthy, retentionOverdue: true }),
    ).toMatchObject({ primary: "retention_overdue" })
  })

  it("keeps durable loss, replay, conflict, late, and classifier lag distinct", () => {
    expect(
      classifyRecommendationHealth({
        ...healthy,
        requestCount: 2,
        committedRejectionCount: 1,
        replayCount: 3,
        conflictCount: 4,
        lateCount: 5,
        classifierLagCount: 6,
        selectionWithoutImpressionCount: 7,
      }),
    ).toEqual({
      primary: "loss_suspected",
      states: [
        "loss_suspected",
        "replay",
        "conflict",
        "late",
        "classifier_lag",
      ],
      counts: {
        requests: 2,
        lossSuspected: 1,
        replays: 3,
        conflicts: 4,
        late: 5,
        classifierLag: 6,
        selectionWithoutImpression: 7,
      },
    })
  })
})
