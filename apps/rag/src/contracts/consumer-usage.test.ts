import { expect, it } from "vitest"
import { usageReportSchema, validateUsageWindow } from "./consumer-usage.js"
it("exposes only recorded consumer usage and preserves valid date boundaries", () => {
  const from = new Date("2026-09-22T05:17:00Z"),
    to = new Date("2026-09-29T05:17:00Z")
  const window = {
    consumerId: "00000000-0000-4000-8000-000000000528",
    from,
    to,
  }
  validateUsageWindow(window)
  const report = {
    consumerId: window.consumerId,
    label: "ragbot",
    windowStart: from.toISOString(),
    windowEnd: to.toISOString(),
    requestCount: 5,
    successfulRequestCount: 5,
    lastActivityAt: "2026-09-29T03:41:32.000Z",
    generatedAt: "2026-09-29T06:00:00.000Z",
  }
  expect(usageReportSchema.parse(report)).toEqual(report)
  expect(
    usageReportSchema.safeParse({ ...report, coverageStatus: "unavailable" })
      .success,
  ).toBe(false)
  expect(
    usageReportSchema.safeParse({ ...report, completeThrough: null }).success,
  ).toBe(false)
  expect(
    usageReportSchema.safeParse({ ...report, requestCount: -1 }).success,
  ).toBe(false)
  expect(
    usageReportSchema.safeParse({
      ...report,
      requestCount: Number.MAX_SAFE_INTEGER + 1,
    }).success,
  ).toBe(false)
  expect(window.from).toBe(from)
  expect(window.to).toBe(to)
})
