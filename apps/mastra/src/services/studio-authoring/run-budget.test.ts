import { afterEach, expect, it, vi } from "vitest"
import { StudioRunBudget, type StudioRunTelemetry } from "./run-budget"

afterEach(() => vi.useRealTimers())
function clock() {
  vi.useFakeTimers({
    toFake: ["Date", "performance", "setTimeout", "clearTimeout"],
  })
}
it("uses one run allowance across steps and rejects dispatch at the persistence reserve", async () => {
  clock()
  const budget = new StudioRunBudget(new AbortController().signal)
  budget.beginStep()
  await vi.advanceTimersByTimeAsync(80000)
  budget.endStep()
  budget.beginStep()
  await vi.advanceTimersByTimeAsync(80000)
  budget.endStep()
  await vi.advanceTimersByTimeAsync(15000)
  expect(() => budget.beginStep()).toThrow("Studio whole-run deadline")
  expect(budget.reason?.source).toBe("whole-run")
  expect(budget.remainingMs()).toBe(5000)
  budget.close()
})
it("caps a step at ninety seconds and preserves earlier caller cancellation", async () => {
  clock()
  const caller = new AbortController()
  const budget = new StudioRunBudget(caller.signal)
  budget.beginStep()
  const stopped = budget
    .run(() => new Promise(() => {}))
    .catch((e: unknown) => e)
  await vi.advanceTimersByTimeAsync(100)
  caller.abort()
  expect(await stopped).toMatchObject({ source: "caller" })
  expect(budget.signal.aborted).toBe(true)
  budget.close()
  const timed = new StudioRunBudget(new AbortController().signal)
  timed.beginStep()
  await vi.advanceTimersByTimeAsync(90000)
  expect(timed.reason?.source).toBe("step")
  timed.close()
})
it("shortens a late step instead of resetting the whole-run clock", async () => {
  clock()
  const budget = new StudioRunBudget(new AbortController().signal)
  budget.beginStep()
  await vi.advanceTimersByTimeAsync(80000)
  budget.endStep()
  budget.beginStep()
  await vi.advanceTimersByTimeAsync(80000)
  budget.endStep()
  budget.beginStep()
  await vi.advanceTimersByTimeAsync(15000)
  expect(budget.reason?.source).toBe("whole-run")
  budget.close()
})
it("bounds terminal persistence even if its implementation ignores cancellation", async () => {
  clock()
  const caller = new AbortController()
  const events: StudioRunTelemetry[] = []
  const budget = new StudioRunBudget(caller.signal, (event) =>
    events.push(event),
  )
  caller.abort()
  let signal: AbortSignal | undefined
  const result = budget
    .settle((context) => {
      signal = context.signal
      expect(context.timeoutMs).toBe(5000)
      return new Promise(() => {})
    })
    .catch((e: unknown) => e)
  await vi.advanceTimersByTimeAsync(5000)
  expect(await result).toMatchObject({ source: "persistence" })
  expect(signal?.aborted).toBe(true)
  expect(budget.reason?.source).toBe("caller")
  expect(events.filter((event) => event.event === "aborted")).toHaveLength(1)
  expect(events.at(-1)).toMatchObject({
    event: "settlement-timeout",
    source: "persistence",
    firstAbortSource: "caller",
  })
  budget.close()
  expect(vi.getTimerCount()).toBe(0)
})
it("reserves terminal time when an inter-step tool call never resolves", async () => {
  clock()
  const budget = new StudioRunBudget(new AbortController().signal)
  budget.beginStep()
  await vi.advanceTimersByTimeAsync(80000)
  budget.endStep()
  const result = budget
    .run(() => new Promise(() => {}))
    .catch((e: unknown) => e)
  await vi.advanceTimersByTimeAsync(95000)
  expect(budget.signal.aborted).toBe(true)
  expect(await result).toMatchObject({ source: "whole-run" })
  expect(budget.remainingMs()).toBe(5000)
  let persistenceSignal: AbortSignal | undefined
  const recording = budget
    .settle(async ({ timeoutMs, signal }) => {
      expect(timeoutMs).toBe(5000)
      persistenceSignal = signal
      return new Promise(() => {})
    })
    .catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(4999)
  expect(persistenceSignal?.aborted).toBe(false)
  expect(budget.remainingMs()).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(await recording).toMatchObject({ source: "persistence" })
  expect(persistenceSignal?.aborted).toBe(true)
  expect(budget.remainingMs()).toBe(0)
  await expect(budget.settle(async () => {})).rejects.toMatchObject({
    source: "persistence",
  })
  budget.close()
})
it("keeps caller as first abort source when the generation cutoff occurs during persistence", async () => {
  clock()
  const caller = new AbortController()
  const events: StudioRunTelemetry[] = []
  const budget = new StudioRunBudget(caller.signal, (event) =>
    events.push(event),
  )
  await vi.advanceTimersByTimeAsync(174999)
  caller.abort()
  const recording = budget
    .settle(() => new Promise(() => {}))
    .catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(5000)
  expect(await recording).toMatchObject({ source: "persistence" })
  expect(budget.reason?.source).toBe("caller")
  expect(events.filter((event) => event.event === "aborted")).toEqual([
    expect.objectContaining({ source: "caller", firstAbortSource: "caller" }),
  ])
  expect(events.at(-1)).toMatchObject({
    event: "settlement-timeout",
    firstAbortSource: "caller",
  })
  expect(budget.remainingMs()).toBe(1)
  budget.close()
})
it("allows successful terminal recording across the generation cutoff without aborting success", async () => {
  clock()
  const budget = new StudioRunBudget(new AbortController().signal)
  await vi.advanceTimersByTimeAsync(174000)
  const recording = budget.settle(
    () =>
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("recorded"), 2000),
      ),
  )
  await vi.advanceTimersByTimeAsync(2000)
  expect(await recording).toBe("recorded")
  expect(budget.signal.aborted).toBe(false)
  expect(budget.remainingMs()).toBe(4000)
  budget.close()
})
