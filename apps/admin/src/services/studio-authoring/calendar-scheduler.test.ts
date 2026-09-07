import { afterEach, beforeEach, expect, it, vi } from "vitest"
const fixture = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    workflowRun: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
  runs: { findMany: vi.fn() },
  calendars: { findMany: vi.fn() },
  begin: vi.fn(),
  fail: vi.fn(),
  start: vi.fn(),
  fetch: vi.fn(),
  warn: vi.fn(),
}))
vi.mock("@/db/client", () => ({
  prisma: {
    $transaction: async (work: (tx: typeof fixture.tx) => Promise<unknown>) =>
      work(fixture.tx),
    workflowRun: fixture.tx.workflowRun,
    studioPlanningRun: fixture.runs,
    studioCalendar: fixture.calendars,
  },
}))
vi.mock("@/config/env", () => ({
  env: {
    MANAGER_API_BASE_URL: "http://127.0.0.1:3461",
    MANAGER_TRIGGER_API_KEY: "local-fixture-only",
    STUDIO_ENVIRONMENT: "local",
  },
}))
vi.mock("workflow/api", () => ({ start: fixture.start }))
vi.mock("@/workflows/studioCalendar", () => ({
  runStudioCalendarScheduler: vi.fn(),
}))
vi.mock("./calendar", () => ({
  StudioCalendarService: class {
    beginAutomaticPlanning = fixture.begin
    failPlanning = fixture.fail
  },
}))
import {
  ensureStudioCalendarSchedulerStarted,
  runStudioCalendarTick,
} from "./calendar-scheduler"
beforeEach(() => {
  vi.clearAllMocks()
  fixture.tx.$queryRaw.mockResolvedValue([])
  fixture.tx.workflowRun.findFirst.mockResolvedValue({
    id: "old-ledger",
    runtimeRunId: "missing-runtime",
    createdAt: new Date(),
  })
  fixture.tx.workflowRun.create.mockResolvedValue({ id: "new-ledger" })
  fixture.tx.workflowRun.update.mockResolvedValue({})
  fixture.start.mockResolvedValue({ runId: "recovered-runtime" })
  fixture.runs.findMany.mockResolvedValue([])
  fixture.calendars.findMany.mockResolvedValue([])
  fixture.fetch.mockResolvedValue(new Response("{}"))
  vi.stubGlobal("fetch", fixture.fetch)
})
afterEach(() => vi.unstubAllGlobals())
it("recovers an authoritatively absent runtime without making a provider dispatch", async () => {
  await ensureStudioCalendarSchedulerStarted()
  expect(fixture.start).toHaveBeenCalledTimes(1)
  expect(fixture.tx.workflowRun.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: "old-ledger" },
      data: expect.objectContaining({ status: "FAILED" }),
    }),
  )
  expect(fixture.fetch).not.toHaveBeenCalled()
  fixture.tx.workflowRun.findFirst.mockResolvedValueOnce({
    id: "new-ledger",
    runtimeRunId: "recovered-runtime",
    createdAt: new Date(),
  })
  fixture.tx.$queryRaw
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ status: "running" }])
  await ensureStudioCalendarSchedulerStarted()
  expect(fixture.start).toHaveBeenCalledTimes(1)
  expect(fixture.fetch).not.toHaveBeenCalled()
})
it("preserves a transient runtime lookup failure rather than treating it as authoritative absence", async () => {
  fixture.tx.$queryRaw
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error("Connection interrupted"))
  await expect(ensureStudioCalendarSchedulerStarted()).rejects.toThrow(
    "Connection interrupted",
  )
  expect(fixture.start).not.toHaveBeenCalled()
  expect(fixture.tx.workflowRun.update).not.toHaveBeenCalled()
})
it("continues after a poisoned first calendar and advances the bounded page with its error retained", async () => {
  fixture.calendars.findMany
    .mockResolvedValueOnce([
      { id: "a-poison" },
      { id: "b-healthy" },
      { id: "c-consumed" },
      { id: "d-idle" },
    ])
    .mockResolvedValueOnce([])
  fixture.begin
    .mockRejectedValueOnce(new Error("Invalid calendar settings"))
    .mockResolvedValueOnce({ id: "healthy-run", status: "RUNNING" })
    .mockResolvedValueOnce({ id: "consumed-run", status: "COMPLETE" })
    .mockResolvedValueOnce(null)
  const result = await runStudioCalendarTick()
  expect(result).toMatchObject({
    cursor: "d-idle",
    failures: [{ calendarId: "a-poison", stage: "admission" }],
  })
  expect(fixture.fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fixture.fetch.mock.calls[0][1].body)).toEqual({
    runId: "healthy-run",
  })
  await runStudioCalendarTick(result?.cursor)
  expect(fixture.calendars.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ id: { gt: "d-idle" } }),
      take: 4,
    }),
  )
  expect(fixture.fetch).toHaveBeenCalledTimes(1)
})
