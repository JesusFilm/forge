import { describe, expect, it } from "vitest"
import { recommendationHistoryEvent } from "./producers"

describe("recommendation history producer contract", () => {
  it("keeps original receipt and expiry while excluding private linkage", () => {
    const event = recommendationHistoryEvent({
      family: "selection",
      logicalId: "selection-1",
      revision: 1,
      occurredAt: new Date("2026-10-28T01:00:00.000Z"),
      acceptedAt: new Date("2026-10-28T01:00:01.000Z"),
      expiresAt: new Date("2026-11-26T01:00:00.000Z"),
      payload: {
        requestId: "request-1",
        itemId: "item-1",
        eventId: "event-1",
        attributionEligibleAt: null,
      },
    })
    expect(event.logicalId).toBe("selection-1")
    expect(event.acceptedAt).toBe("2026-10-28T01:00:01.000Z")
    expect(event.expiresAt).toBe("2026-11-26T01:00:00.000Z")
    expect(JSON.stringify(event)).not.toContain("sessionDigest")
  })
})
