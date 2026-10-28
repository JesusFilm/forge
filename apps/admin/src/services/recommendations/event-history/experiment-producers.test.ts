import { describe, expect, it } from "vitest"
import {
  baselineVisitHistoryEvent,
  experimentVisitHistoryEvent,
  visitRequestHistoryEvent,
} from "./experiment-producers"

describe("experiment visit history producer", () => {
  it("exports a redacted immutable visit revision with original expiry", () => {
    const event = experimentVisitHistoryEvent({
      kind: "admission",
      visitId: "11111111-1111-4111-8111-111111111111",
      experimentId: "public-test",
      revision: 1,
      occurredAt: new Date("2026-10-28T00:00:00.000Z"),
      acceptedAt: new Date("2026-10-28T00:00:01.000Z"),
      expiresAt: new Date("2026-11-26T00:00:00.000Z"),
      sourceVideoId: "video-1",
      locale: "en",
      audioLanguageSlug: "english",
      eligibility: "eligible",
      qualification: "unverified_browser",
      exclusionReason: null,
      arm: "CONTROL",
      deliveryResult: "not_attempted",
      actualStrategy: null,
      deliveryRequestId: null,
      fallbackReason: null,
    })
    expect(event).toMatchObject({
      family: "experiment-visit",
      logicalId: "ab-visit:11111111-1111-4111-8111-111111111111",
      revision: 1,
      acceptedAt: "2026-10-28T00:00:01.000Z",
      expiresAt: "2026-11-26T00:00:00.000Z",
      payload: {
        kind: "admission",
        sourceVideoId: "video-1",
        audioLanguageSlug: "english",
        deliveryResult: "not_attempted",
      },
    })
    expect(Object.keys(event.payload).join(",")).not.toMatch(
      /browser|consent|session|token/i,
    )
  })
  it("keeps baseline visits and request links distinct from A/B admissions", () => {
    const shared = {
      visitId: "11111111-1111-4111-8111-111111111111",
      occurredAt: new Date("2026-10-28T00:00:00.000Z"),
      acceptedAt: new Date("2026-10-28T00:00:01.000Z"),
      expiresAt: new Date("2026-11-26T00:00:00.000Z"),
    }
    const baseline = baselineVisitHistoryEvent({
      ...shared,
      runId: "22222222-2222-4222-8222-222222222222",
      revision: 1,
      kind: "admission",
      sourceVideoId: "video-1",
      locale: "en",
      audioLanguageSlug: "english",
      deliveryResult: "not_attempted",
    })
    const link = visitRequestHistoryEvent({
      ...shared,
      scope: "baseline",
      requestId: "request-1",
    })
    expect(baseline.logicalId).toBe(`baseline-visit:${shared.visitId}`)
    expect(link.logicalId).toBe(
      `baseline-visit:${shared.visitId}/request:request-1`,
    )
    expect(link.payload).toMatchObject({
      kind: "request-link",
      requestId: "request-1",
    })
    expect(link.revision).toBe(1)
  })
})
