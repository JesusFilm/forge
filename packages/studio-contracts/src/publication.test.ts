import { expect, it } from "vitest"
import { studioPublishSchema } from "./publication"
it("binds exact release delivery while keeping fresh readiness outside permanent schedule identity", () => {
  const input = {
    projectId: "project",
    expectedRevision: 1,
    idempotencyKey: "receipt",
    approvalId: "approval",
    renderAttemptId: "render",
    releaseId: "release",
    readinessId: "fresh-proof",
    schedule: {
      scheduleId: "slot",
      version: 2,
      dueAt: "2026-09-08T00:00:00Z",
      latestAllowedAt: "2026-09-08T00:10:00Z",
    },
  }
  expect(studioPublishSchema.parse(input)).toEqual(input)
  expect(
    studioPublishSchema.safeParse({ ...input, releaseId: undefined }).success,
  ).toBe(false)
  expect(
    studioPublishSchema.safeParse({
      ...input,
      schedule: { ...input.schedule, readinessId: "frozen-proof" },
    }).success,
  ).toBe(false)
  expect(
    studioPublishSchema.safeParse({
      ...input,
      schedule: { ...input.schedule, latestAllowedAt: "2026-09-07T23:59:59Z" },
    }).success,
  ).toBe(false)
})
