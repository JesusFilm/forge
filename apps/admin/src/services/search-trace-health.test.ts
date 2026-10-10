import { beforeEach, describe, expect, it } from "vitest"

import {
  __resetSearchTraceHealthForTest,
  getSearchTraceHealthCounters,
  recordSearchTraceRawCaptureDisabled,
  recordSearchTraceWriteFailure,
  recordSearchTraceWriteSuccess,
  recordSearchTraceWriteTimeout,
} from "./search-trace-health"

describe("search trace health counters", () => {
  beforeEach(() => {
    __resetSearchTraceHealthForTest()
  })

  it("tracks safe capture outcomes without storing query text", () => {
    recordSearchTraceWriteSuccess()
    recordSearchTraceWriteFailure()
    recordSearchTraceWriteTimeout()
    recordSearchTraceRawCaptureDisabled()

    expect(getSearchTraceHealthCounters()).toMatchObject({
      writeSuccesses: 1,
      writeFailures: 1,
      writeTimeouts: 1,
      rawCaptureDisabled: 1,
    })
    expect(getSearchTraceHealthCounters().lastWriteSuccessAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    )
  })
})
