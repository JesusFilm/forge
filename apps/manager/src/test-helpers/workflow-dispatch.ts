import { expect, type Mock } from "vitest"

export type MockRun<TResult> = {
  runId: string
  returnValue: Promise<TResult>
}

export type WorkflowDispatchSpy<TResult> = {
  mockReturnValue(value: TResult): void
  mockRejection(err: Error): void
  expectDispatched(workflow: unknown, args: unknown[]): void
  expectNotDispatched(): void
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
