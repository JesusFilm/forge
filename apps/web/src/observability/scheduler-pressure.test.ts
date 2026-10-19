import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  SCHEDULER_PRESSURE_METRICS,
  computeSchedulerPressure,
  parseCounter,
  parseCpuPressure,
  parseSchedstat,
  readSchedulerSnapshot,
  startSchedulerPressureSampler,
} from "./scheduler-pressure"

const PID = 20
const SCHEDSTAT = `/proc/${PID}/task/${PID}/schedstat`
const STATUS = `/proc/${PID}/status`
const CPU_STAT = "/sys/fs/cgroup/cpu.stat"
const CPU_PRESSURE = "/sys/fs/cgroup/cpu.pressure"

// Two readings of the production web main thread taken 10.01 s apart during
// the 2026-10-19 incident (feat-745): 82.5% on CPU, 16.8% waiting to run.
const INCIDENT_BEFORE = "3897583445691 688080089222 6731400\n"
const INCIDENT_AFTER = "3905840783601 689758245754 6744636\n"
const INCIDENT_WALL_NS = 10_010_000_000

function status(involuntary: number): string {
  return [
    "Name:\tnext-server (v16)",
    "Threads:\t20",
    "voluntary_ctxt_switches:\t183880",
    `nonvoluntary_ctxt_switches:\t${involuntary}`,
    "",
  ].join("\n")
}

function cpuStat(throttledUsec: number): string {
  return [
    "usage_usec 5577226723",
    "nr_periods 45484",
    "nr_throttled 0",
    `throttled_usec ${throttledUsec}`,
    "",
  ].join("\n")
}

const PRESSURE = [
  "some avg10=14.43 avg60=8.88 avg300=6.45 total=230311592",
  "full avg10=13.50 avg60=8.35 avg300=6.03 total=218765987",
  "",
].join("\n")

function reader(files: Record<string, string | undefined>) {
  return (path: string) => files[path]
}

describe("scheduler pressure parsers", () => {
  it("reads on-CPU and run-queue nanoseconds from schedstat", () => {
    expect(parseSchedstat(INCIDENT_BEFORE)).toEqual({
      cpuNs: 3897583445691,
      waitNs: 688080089222,
    })
    expect(parseSchedstat("garbage")).toBeUndefined()
    expect(parseSchedstat("")).toBeUndefined()
  })

  it("reads tab- and space-separated counters by exact key", () => {
    expect(parseCounter(status(6526538), "nonvoluntary_ctxt_switches")).toBe(
      6526538,
    )
    expect(parseCounter(status(6526538), "voluntary_ctxt_switches")).toBe(
      183880,
    )
    expect(parseCounter(cpuStat(42), "throttled_usec")).toBe(42)
    expect(parseCounter(cpuStat(42), "missing")).toBeUndefined()
  })

  it("reads both PSI avg10 lines", () => {
    expect(parseCpuPressure(PRESSURE)).toEqual({
      someAvg10: 14.43,
      fullAvg10: 13.5,
    })
    expect(parseCpuPressure("")).toEqual({
      someAvg10: undefined,
      fullAvg10: undefined,
    })
  })
})

describe("computeSchedulerPressure", () => {
  it("separates running from waiting on the incident readings", () => {
    const previous = readSchedulerSnapshot(
      reader({
        [SCHEDSTAT]: INCIDENT_BEFORE,
        [STATUS]: status(6_526_538),
        [CPU_STAT]: cpuStat(0),
        [CPU_PRESSURE]: PRESSURE,
      }),
      PID,
      0,
    )
    const next = readSchedulerSnapshot(
      reader({
        [SCHEDSTAT]: INCIDENT_AFTER,
        [STATUS]: status(6_540_538),
        [CPU_STAT]: cpuStat(500_500),
        [CPU_PRESSURE]: PRESSURE,
      }),
      PID,
      INCIDENT_WALL_NS,
    )

    const gauges = computeSchedulerPressure(previous, next)

    expect(gauges[SCHEDULER_PRESSURE_METRICS.mainThreadOnCpuRatio]).toBeCloseTo(
      0.825,
      3,
    )
    expect(
      gauges[SCHEDULER_PRESSURE_METRICS.mainThreadRunqueueWaitRatio],
    ).toBeCloseTo(0.168, 3)
    expect(
      gauges[SCHEDULER_PRESSURE_METRICS.involuntaryContextSwitchesPerSecond],
    ).toBeCloseTo(1398.6, 1)
    expect(
      gauges[SCHEDULER_PRESSURE_METRICS.cgroupCpuThrottledRatio],
    ).toBeCloseTo(0.05, 3)
    expect(gauges[SCHEDULER_PRESSURE_METRICS.cgroupCpuPressureSomeAvg10]).toBe(
      14.43,
    )
    expect(gauges[SCHEDULER_PRESSURE_METRICS.cgroupCpuPressureFullAvg10]).toBe(
      13.5,
    )
  })

  it("omits a counter that moved backwards instead of emitting a negative", () => {
    const gauges = computeSchedulerPressure(
      { wallNs: 0, mainThreadCpuNs: 100, mainThreadWaitNs: 50 },
      { wallNs: 1_000, mainThreadCpuNs: 90, mainThreadWaitNs: 60 },
    )

    expect(gauges).toEqual({
      [SCHEDULER_PRESSURE_METRICS.mainThreadRunqueueWaitRatio]: 0.01,
    })
  })

  it("emits nothing for a zero or negative wall window", () => {
    expect(
      computeSchedulerPressure(
        { wallNs: 5, mainThreadCpuNs: 1 },
        { wallNs: 5, mainThreadCpuNs: 2 },
      ),
    ).toEqual({})
  })

  it("omits unreadable sources rather than reporting zero", () => {
    const previous = readSchedulerSnapshot(
      reader({ [SCHEDSTAT]: INCIDENT_BEFORE }),
      PID,
      0,
    )
    const next = readSchedulerSnapshot(
      reader({ [SCHEDSTAT]: INCIDENT_AFTER }),
      PID,
      INCIDENT_WALL_NS,
    )

    expect(
      Object.keys(computeSchedulerPressure(previous, next)).sort(),
    ).toEqual(
      [
        SCHEDULER_PRESSURE_METRICS.mainThreadOnCpuRatio,
        SCHEDULER_PRESSURE_METRICS.mainThreadRunqueueWaitRatio,
      ].sort(),
    )
  })
})

describe("startSchedulerPressureSampler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function sequence(...values: string[]) {
    let index = 0
    return () => values[Math.min(index++, values.length - 1)]
  }

  it("does not start when the main-thread schedstat is unreadable", () => {
    const emit = vi.fn()

    expect(
      startSchedulerPressureSampler({
        emit,
        pid: PID,
        readFile: () => undefined,
      }),
    ).toBeUndefined()
    vi.advanceTimersByTime(60_000)
    expect(emit).not.toHaveBeenCalled()
  })

  it("emits gauges each interval and logs saturation at most every five minutes", () => {
    const emit = vi.fn()
    const log = vi.fn()
    // Each tick: +0.8 s on CPU and +0.19 s waiting per 1 s of wall time.
    const nextSchedstat = sequence(
      "0 0 0",
      "800000000 190000000 1",
      "1600000000 380000000 2",
      "2400000000 570000000 3",
    )
    let wallNs = 0
    const stop = startSchedulerPressureSampler({
      emit,
      log,
      intervalMs: 5_000,
      now: () => wallNs,
      pid: PID,
      readFile: (path) => (path === SCHEDSTAT ? nextSchedstat() : undefined),
    })

    wallNs += 1e9
    vi.advanceTimersByTime(5_000)

    expect(emit).toHaveBeenCalledWith(
      SCHEDULER_PRESSURE_METRICS.mainThreadOnCpuRatio,
      0.8,
    )
    expect(emit).toHaveBeenCalledWith(
      SCHEDULER_PRESSURE_METRICS.mainThreadRunqueueWaitRatio,
      0.19,
    )
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toBe(
      "[scheduler-pressure] event=main_thread_saturated on_cpu=0.800 runqueue_wait=0.190 cpu_pressure_full_avg10=na",
    )

    wallNs += 1e9
    vi.advanceTimersByTime(5_000)
    expect(log).toHaveBeenCalledTimes(1)

    stop?.()
    vi.advanceTimersByTime(60_000)
    expect(emit).toHaveBeenCalledTimes(4)
  })

  it("does not log when the main thread has headroom", () => {
    const log = vi.fn()
    const nextSchedstat = sequence("0 0 0", "500000000 10000000 1")
    let wallNs = 0
    startSchedulerPressureSampler({
      emit: vi.fn(),
      log,
      intervalMs: 5_000,
      now: () => wallNs,
      pid: PID,
      readFile: (path) => (path === SCHEDSTAT ? nextSchedstat() : undefined),
    })

    wallNs += 1e9
    vi.advanceTimersByTime(5_000)
    expect(log).not.toHaveBeenCalled()
  })
})
