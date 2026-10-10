import { it, expect, vi, afterEach } from "vitest"
vi.mock("@/config/env", () => ({
  env: {
    MANAGER_API_BASE_URL: "https://manager.test",
    MANAGER_TRIGGER_API_KEY: "owned-key",
    STUDIO_ENVIRONMENT: "test",
  },
}))
import { prepareScheduledStudioPublication } from "./scheduled-publication-adapter"
const input = {
  projectId: "project",
  expectedRevision: 1,
  approvalId: "approval",
  renderAttemptId: "render",
  releaseId: "release",
  idempotencyKey: "key",
  schedule: {
    scheduleId: "slot",
    version: 1,
    dueAt: "2026-09-08T00:00:00Z",
    latestAllowedAt: "2026-09-08T00:10:00Z",
  },
}
afterEach(() => vi.unstubAllGlobals())
it("returns the exact never-submitted envelope with only fresh readiness added", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({
      result: { ...input, readinessId: "fresh" },
      submission: "not-submitted",
    }),
  )
  vi.stubGlobal("fetch", fetch)
  expect(await prepareScheduledStudioPublication(input)).toEqual({
    ...input,
    readinessId: "fresh",
  })
  expect(fetch).toHaveBeenCalledOnce()
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(input)
  expect(fetch.mock.calls[0]).toEqual([
    expect.any(URL),
    expect.objectContaining({ redirect: "error" }),
  ])
})
it("rejects replacement content and classifies a lost preparation response as not submitted", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        result: { ...input, releaseId: "other", readinessId: "fresh" },
        submission: "not-submitted",
      }),
    ),
  )
  await expect(prepareScheduledStudioPublication(input)).rejects.toMatchObject({
    code: "STALE_BINDING",
    submission: "not-submitted",
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("lost response")
    }),
  )
  await expect(prepareScheduledStudioPublication(input)).rejects.toMatchObject({
    code: "UNREADY",
    submission: "not-submitted",
  })
})
