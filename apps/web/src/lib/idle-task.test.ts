/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { scheduleIdleTask } from "./idle-task"

function setReadyState(value: DocumentReadyState) {
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => value,
  })
}

describe("scheduleIdleTask", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, "readyState")
  })

  it("uses requestIdleCallback with the bound as its timeout", () => {
    const requestIdleCallback = vi.fn(() => 7)
    const cancelIdleCallback = vi.fn()
    vi.stubGlobal("requestIdleCallback", requestIdleCallback)
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback)
    const task = vi.fn()

    const cancel = scheduleIdleTask(task, { timeoutMs: 1_500 })

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 1_500,
    })
    expect(task).not.toHaveBeenCalled()
    cancel()
    expect(cancelIdleCallback).toHaveBeenCalledWith(7)
  })

  it("runs at most once when idle fires after cancellation", () => {
    let fire: (() => void) | undefined
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      fire = callback
      return 1
    })
    vi.stubGlobal("cancelIdleCallback", vi.fn())
    const task = vi.fn()

    const cancel = scheduleIdleTask(task, { timeoutMs: 1_500 })
    cancel()
    fire?.()

    expect(task).not.toHaveBeenCalled()
  })

  describe("without requestIdleCallback", () => {
    beforeEach(() => {
      vi.stubGlobal("requestIdleCallback", undefined)
    })

    it("waits for window load and then yields one task", () => {
      setReadyState("loading")
      const task = vi.fn()

      scheduleIdleTask(task, { timeoutMs: 1_500 })
      vi.advanceTimersByTime(100)
      expect(task).not.toHaveBeenCalled()

      window.dispatchEvent(new Event("load"))
      expect(task).not.toHaveBeenCalled()
      vi.advanceTimersByTime(0)
      expect(task).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(2_000)
      expect(task).toHaveBeenCalledTimes(1)
    })

    it("runs after the bound when load never arrives", () => {
      setReadyState("loading")
      const task = vi.fn()

      scheduleIdleTask(task, { timeoutMs: 1_500 })
      vi.advanceTimersByTime(1_499)
      expect(task).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(task).toHaveBeenCalledTimes(1)
    })

    it("yields once when the document already loaded", () => {
      setReadyState("complete")
      const task = vi.fn()

      scheduleIdleTask(task, { timeoutMs: 1_500 })
      expect(task).not.toHaveBeenCalled()
      vi.advanceTimersByTime(0)
      expect(task).toHaveBeenCalledTimes(1)
    })

    it("cancels the load listener and both timers", () => {
      setReadyState("loading")
      const task = vi.fn()

      const cancel = scheduleIdleTask(task, { timeoutMs: 1_500 })
      cancel()
      window.dispatchEvent(new Event("load"))
      vi.advanceTimersByTime(2_000)

      expect(task).not.toHaveBeenCalled()
    })
  })
})
