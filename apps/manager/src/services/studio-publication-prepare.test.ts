import { expect, it, vi } from "vitest"
import { prepareStudioPublication } from "./studio-publication-prepare"
it("refreshes only the exact staged provider asset without creating or publishing", async () => {
  const port = {
    eligible: vi.fn(async () => {}),
    ready: vi.fn(async () => {}),
    read: vi.fn(async () => ({
      id: "intent",
      state: "READY",
      assetId: "asset",
    })),
    observe: vi.fn(async () => ({ observedAt: "2026-09-08T00:00:00Z" })),
    record: vi.fn(async () => {}),
    stage: vi.fn(async () => ({ releaseId: "release", readinessId: "ready" })),
  }
  expect(
    await prepareStudioPublication(
      {
        projectId: "project",
        approvalId: "approval",
        expectedRevision: 3,
        renderAttemptId: "attempt",
        releaseId: "release",
      },
      port,
    ),
  ).toEqual({ releaseId: "release", readinessId: "ready" })
  expect(port.observe).toHaveBeenCalledWith("asset", "intent")
  expect(port.record).toHaveBeenCalledWith("intent", {
    observedAt: "2026-09-08T00:00:00Z",
  })
  expect(port.stage).toHaveBeenCalledWith("attempt")
})
it("rejects a stale or substituted binding before observing provider state", async () => {
  const port = {
    eligible: vi.fn(async () => {
      throw new Error("STALE_BINDING")
    }),
    ready: vi.fn(),
    read: vi.fn(),
    observe: vi.fn(),
    record: vi.fn(),
    stage: vi.fn(),
  }
  await expect(
    prepareStudioPublication(
      {
        projectId: "project",
        approvalId: "approval",
        expectedRevision: 3,
        renderAttemptId: "attempt",
        releaseId: "release",
      },
      port,
    ),
  ).rejects.toThrow("STALE_BINDING")
  expect(port.read).not.toHaveBeenCalled()
  expect(port.observe).not.toHaveBeenCalled()
})

it("rechecks exact eligibility after observation and retains unready result without publication", async () => {
  const port = {
    eligible: vi.fn(async () => {}),
    read: vi.fn(async () => ({
      id: "intent",
      state: "READY",
      assetId: "asset",
    })),
    observe: vi.fn(async () => ({})),
    record: vi.fn(async () => {}),
    stage: vi.fn(async () => ({ releaseId: "release", readinessId: "fresh" })),
    ready: vi.fn(async () => {
      throw new Error("AUTHORIZATION_REVOKED")
    }),
  }
  await expect(
    prepareStudioPublication(
      {
        projectId: "project",
        approvalId: "approval",
        expectedRevision: 3,
        renderAttemptId: "attempt",
        releaseId: "release",
      },
      port,
    ),
  ).rejects.toThrow("AUTHORIZATION_REVOKED")
  expect(port.ready).toHaveBeenCalledWith(
    {
      projectId: "project",
      approvalId: "approval",
      expectedRevision: 3,
      renderAttemptId: "attempt",
      releaseId: "release",
    },
    "fresh",
  )
})
