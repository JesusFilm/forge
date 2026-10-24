// Test helper for useworkflow dispatch assertions.
//
// Why this exists: `"use workflow"` functions are rewritten by the
// `workflow/next` build plugin so they can only be invoked via
// `start()` from `workflow/api`. In production the build plugin is
// active and direct invocation throws at runtime; in tests the
// directive is inert and direct invocation silently executes the
// function body. That divergence means workflow-body tests cannot
// catch dispatch-site bugs — a resolver that forgot to wrap its call
// in `start()` passes every unit test and crashes on first live
// traffic.
//
// Usage:
//
//   import { vi } from "vitest"
//   import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"
//
//   const { start } = vi.hoisted(() => ({ start: vi.fn() }))
//   vi.mock("workflow/api", () => ({ start }))
//
//   const dispatch = wrapStartSpy<MyReport>(start)
//
//   it("dispatches the workflow", async () => {
//     dispatch.mockReturnValue(fakeReport)
//     await callSiteUnderTest()
//     dispatch.expectDispatched(runMyWorkflow, [{ expectedArg: 1 }])
//   })
//
// `vi.hoisted` is required because `vi.mock` is hoisted above imports
// by vitest; the mock factory must reference a spy that also exists
// at hoist time.

import { expect, type Mock } from "vitest"

export type MockRun<TResult> = {
  runId: string
  returnValue: Promise<TResult>
}

export type WorkflowDispatchSpy<TResult> = {
  /** Resolve the next `start()` call so `run.returnValue` yields `value`. */
  mockReturnValue(value: TResult): void
  /** Resolve the next `start()` call so `run.returnValue` rejects with `err`. */
  mockRejection(err: Error): void
  /** Assert that `start()` was called with the given workflow + args tuple. */
  expectDispatched(workflow: unknown, args: unknown[]): void
  /** Assert no dispatch occurred (e.g. caller was rejected by ABAC first). */
  expectNotDispatched(): void
  /** The underlying spy, for bespoke assertions. */
  readonly spy: Mock
}

export function wrapStartSpy<TResult>(
  start: Mock,
): WorkflowDispatchSpy<TResult> {
  return {
    mockReturnValue(value) {
      start.mockResolvedValueOnce({
        runId: `test-run-${Math.random().toString(36).slice(2, 10)}`,
        returnValue: Promise.resolve(value),
      } satisfies MockRun<TResult>)
    },
    mockRejection(err) {
      start.mockResolvedValueOnce({
        runId: "test-run-err",
        returnValue: Promise.reject(err),
      } satisfies MockRun<TResult>)
    },
    expectDispatched(workflow, args) {
      expect(start).toHaveBeenCalledWith(workflow, args)
    },
    expectNotDispatched() {
      expect(start).not.toHaveBeenCalled()
    },
    spy: start,
  }
}
