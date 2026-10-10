import { describe, expect, it } from "vitest"
import {
  cowatchRefreshSourceWindow,
  CowatchRefreshBudgetSchema,
} from "./refresh-policy"

describe("bounded mature co-watch refresh policy", () => {
  it("keeps the complete seven-day event window beyond the six-hour hard horizon", () => {
    expect(
      cowatchRefreshSourceWindow(new Date("2026-10-01T13:59:59.999Z")),
    ).toEqual({
      version: "episode-event-window-v1",
      windowStart: new Date("2026-09-24T06:00:00.000Z"),
      windowEnd: new Date("2026-10-01T06:00:00.000Z"),
      evaluationAsOf: new Date("2026-10-01T13:00:00.000Z"),
    })
  })
  it("has no default capacity authorization", () => {
    expect(CowatchRefreshBudgetSchema.safeParse({}).success).toBe(false)
  })
})
