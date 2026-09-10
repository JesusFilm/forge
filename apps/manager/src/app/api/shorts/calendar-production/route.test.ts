import { beforeEach, expect, it, vi } from "vitest"
import { StudioTransportError } from "@/backend/studio-interactive"
import { POST } from "./route"
const fixture = vi.hoisted(() => ({ call: vi.fn(), generate: vi.fn() }))
vi.mock("@/lib/studio-request", () => ({
  authenticateStudioRequest: async () => ({ approvedByUserId: "operator" }),
}))
vi.mock("@/backend/studio-interactive", async (original) => ({
  ...(await original<typeof import("@/backend/studio-interactive")>()),
  createStudioInteractiveClient: () => fixture.call,
}))
vi.mock("@/services/studio-agent/generation", () => ({
  studioGenerationBatch: (...args: unknown[]) => fixture.generate(...args),
}))
const request = () =>
  new Request("http://localhost/api/shorts/calendar-production", {
    method: "POST",
    body: JSON.stringify({
      calendarId: "calendar",
      idempotencyKey: "stable-selection",
      confirmed: true,
      targets: [
        { date: "2026-09-22", version: 1, projectId: "project", revision: 1 },
      ],
    }),
  })
beforeEach(() => vi.resetAllMocks())
it("marks a confirmed admission conflict as safely refreshable without dispatch", async () => {
  fixture.call.mockRejectedValue(new StudioTransportError(409, "CONFLICT"))
  const response = await POST(request())
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ admission: "rejected" })
  expect(fixture.generate).not.toHaveBeenCalled()
})
it("retains ambiguous admission and execution failures rather than authorizing a fresh selection", async () => {
  fixture.call.mockRejectedValueOnce(
    new Error("Connection lost after possible commit"),
  )
  expect(await (await POST(request())).json()).toMatchObject({
    admission: "unknown",
  })
  fixture.call.mockResolvedValueOnce({ requests: [] })
  fixture.generate.mockRejectedValueOnce(
    new StudioTransportError(409, "Lost execution response"),
  )
  expect(await (await POST(request())).json()).toMatchObject({
    admission: "unknown",
  })
})
