import { readFileSync } from "node:fs"

import { instanceTags, resolveInstanceIdentity } from "./instance-identity"

// Watch serves every request from one Node main thread. On a contended host
// that thread can be runnable but waiting for a CPU, which inflates every
// latency (cache HITs included) while CPU usage and event-loop metrics stay
// ambiguous. The kernel's per-thread schedstat separates "running" from
// "waiting to run"; these gauges make that split visible in Datadog without
// shell access to the container (feat-745).
//
// The sampler shares the event loop it measures, so a stalled loop delays or
// skips samples. `sample_interval_seconds` reports each sample's real window
// (a late timer shows as a window longer than the configured interval), and a
// fully stalled loop shows as no data, which monitors must treat as a signal.

const DEFAULT_INTERVAL_MS = 15_000
const MIN_INTERVAL_MS = 5_000
const SATURATION_LOG_INTERVAL_MS = 5 * 60_000
const SATURATED_RUNNABLE_RATIO = 0.95

const CGROUP_CPU_PRESSURE_PATH = "/sys/fs/cgroup/cpu.pressure"
const CGROUP_CPU_STAT_PATH = "/sys/fs/cgroup/cpu.stat"

export const SCHEDULER_PRESSURE_METRICS = {
  mainThreadOnCpuRatio: "forge.web.main_thread.on_cpu_ratio",
  mainThreadRunqueueWaitRatio: "forge.web.main_thread.runqueue_wait_ratio",
  // Read from the main thread's own task status, not the whole process.
  mainThreadInvoluntaryContextSwitchesPerSecond:
    "forge.web.main_thread.involuntary_context_switches_per_second",
  cgroupCpuThrottledRatio: "forge.web.cgroup.cpu_throttled_ratio",
  cgroupCpuPressureSomeAvg10: "forge.web.cgroup.cpu_pressure.some_avg10_pct",
  cgroupCpuPressureFullAvg10: "forge.web.cgroup.cpu_pressure.full_avg10_pct",
  sampleIntervalSeconds: "forge.web.scheduler_pressure.sample_interval_seconds",
} as const

export type SchedulerPressureMetric =
  (typeof SCHEDULER_PRESSURE_METRICS)[keyof typeof SCHEDULER_PRESSURE_METRICS]

export type SchedulerSnapshot = {
  wallNs: number
  mainThreadCpuNs?: number
  mainThreadWaitNs?: number
  mainThreadInvoluntaryContextSwitches?: number
  cgroupThrottledUsec?: number
  cpuPressureSomeAvg10?: number
  cpuPressureFullAvg10?: number
}

export type SchedulerPressureGauges = Partial<
  Record<SchedulerPressureMetric, number>
>

type ReadFile = (path: string) => string | undefined

export type MetricTags = Record<string, string>

type SchedulerPressureOptions = {
  emit: (
    metric: SchedulerPressureMetric,
    value: number,
    tags: MetricTags,
  ) => void
  intervalMs?: number
  log?: (message: string) => void
  now?: () => number
  pid?: number
  readFile?: ReadFile
  tags?: MetricTags
}

// Module instances can be duplicated across Next server bundles; the guard
// lives on globalThis so one process never runs two samplers.
const STARTED_KEY = Symbol.for("forge.web.schedulerPressure.started")
type StartedGlobal = typeof globalThis & { [STARTED_KEY]?: boolean }

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** `/proc/<pid>/task/<tid>/schedstat`: on-CPU ns, run-queue wait ns, slices. */
export function parseSchedstat(
  text: string,
): { cpuNs: number; waitNs: number } | undefined {
  const [cpu, wait] = text.trim().split(/\s+/)
  const cpuNs = finiteNumber(cpu)
  const waitNs = finiteNumber(wait)
  if (cpuNs === undefined || waitNs === undefined) return undefined
  return { cpuNs, waitNs }
}

/** A `key:\tvalue` (task status) or `key value` (cpu.stat) counter line. */
export function parseCounter(text: string, key: string): number | undefined {
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Za-z_]+):?\s+(\d+)\s*$/)
    if (match?.[1] === key) return finiteNumber(match[2])
  }
  return undefined
}

/** PSI file: `some avg10=1.23 ...` and `full avg10=0.45 ...`. */
export function parseCpuPressure(text: string): {
  someAvg10?: number
  fullAvg10?: number
} {
  const avg10 = (kind: string) =>
    finiteNumber(text.match(new RegExp(`^${kind} avg10=([0-9.]+)`, "m"))?.[1])
  return { someAvg10: avg10("some"), fullAvg10: avg10("full") }
}

function defaultReadFile(path: string): string | undefined {
  try {
    // procfs and cgroupfs reads are in-kernel and sub-millisecond. The async
    // API would queue them on the libuv pool behind the very saturation being
    // measured and blur the sample window.
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

export function readSchedulerSnapshot(
  readFile: ReadFile,
  pid: number,
  wallNs: number,
): SchedulerSnapshot {
  // Linux gives the main thread tid === pid.
  const schedstatText = readFile(`/proc/${pid}/task/${pid}/schedstat`)
  const statusText = readFile(`/proc/${pid}/task/${pid}/status`)
  const cpuStatText = readFile(CGROUP_CPU_STAT_PATH)
  const pressureText = readFile(CGROUP_CPU_PRESSURE_PATH)

  const schedstat = schedstatText ? parseSchedstat(schedstatText) : undefined
  const pressure = pressureText ? parseCpuPressure(pressureText) : {}

  return {
    wallNs,
    mainThreadCpuNs: schedstat?.cpuNs,
    mainThreadWaitNs: schedstat?.waitNs,
    mainThreadInvoluntaryContextSwitches: statusText
      ? parseCounter(statusText, "nonvoluntary_ctxt_switches")
      : undefined,
    cgroupThrottledUsec: cpuStatText
      ? parseCounter(cpuStatText, "throttled_usec")
      : undefined,
    cpuPressureSomeAvg10: pressure.someAvg10,
    cpuPressureFullAvg10: pressure.fullAvg10,
  }
}

function deltaRatio(
  previous: number | undefined,
  next: number | undefined,
  scale: number,
  wallDeltaNs: number,
): number | undefined {
  if (previous === undefined || next === undefined) return undefined
  const delta = next - previous
  // A counter that moved backwards belongs to a different task; skip it.
  if (delta < 0) return undefined
  return (delta * scale) / wallDeltaNs
}

export function computeSchedulerPressure(
  previous: SchedulerSnapshot,
  next: SchedulerSnapshot,
): SchedulerPressureGauges {
  const wallDeltaNs = next.wallNs - previous.wallNs
  const gauges: SchedulerPressureGauges = {}
  if (wallDeltaNs <= 0) return gauges

  const set = (metric: SchedulerPressureMetric, value: number | undefined) => {
    if (value !== undefined && Number.isFinite(value)) gauges[metric] = value
  }

  set(
    SCHEDULER_PRESSURE_METRICS.mainThreadOnCpuRatio,
    deltaRatio(previous.mainThreadCpuNs, next.mainThreadCpuNs, 1, wallDeltaNs),
  )
  set(
    SCHEDULER_PRESSURE_METRICS.mainThreadRunqueueWaitRatio,
    deltaRatio(
      previous.mainThreadWaitNs,
      next.mainThreadWaitNs,
      1,
      wallDeltaNs,
    ),
  )
  set(
    SCHEDULER_PRESSURE_METRICS.mainThreadInvoluntaryContextSwitchesPerSecond,
    deltaRatio(
      previous.mainThreadInvoluntaryContextSwitches,
      next.mainThreadInvoluntaryContextSwitches,
      1e9,
      wallDeltaNs,
    ),
  )
  set(
    SCHEDULER_PRESSURE_METRICS.cgroupCpuThrottledRatio,
    deltaRatio(
      previous.cgroupThrottledUsec,
      next.cgroupThrottledUsec,
      1e3,
      wallDeltaNs,
    ),
  )
  set(
    SCHEDULER_PRESSURE_METRICS.cgroupCpuPressureSomeAvg10,
    next.cpuPressureSomeAvg10,
  )
  set(
    SCHEDULER_PRESSURE_METRICS.cgroupCpuPressureFullAvg10,
    next.cpuPressureFullAvg10,
  )
  set(SCHEDULER_PRESSURE_METRICS.sampleIntervalSeconds, wallDeltaNs / 1e9)
  return gauges
}

function formatRatio(value: number | undefined): string {
  return value === undefined ? "na" : value.toFixed(3)
}

/**
 * Samples the kernel's view of the main thread on an unref'd timer. Returns a
 * stop function, or `undefined` when the main-thread schedstat is unreadable
 * (non-Linux hosts, kernels without schedstats).
 */
export function startSchedulerPressureSampler(
  options: SchedulerPressureOptions,
): (() => void) | undefined {
  const readFile = options.readFile ?? defaultReadFile
  const now = options.now ?? (() => Number(process.hrtime.bigint()))
  const pid = options.pid ?? process.pid
  const intervalMs = Math.max(
    MIN_INTERVAL_MS,
    options.intervalMs ?? DEFAULT_INTERVAL_MS,
  )
  const tags = options.tags ?? {}
  const logIdentity = Object.entries(tags)
    .map(([key, value]) => ` ${key}=${value}`)
    .join("")

  let previous = readSchedulerSnapshot(readFile, pid, now())
  if (previous.mainThreadCpuNs === undefined) return undefined

  let lastSaturationLogNs: number | undefined
  const sample = () => {
    const next = readSchedulerSnapshot(readFile, pid, now())
    const gauges = computeSchedulerPressure(previous, next)
    previous = next

    for (const [metric, value] of Object.entries(gauges)) {
      options.emit(metric as SchedulerPressureMetric, value, tags)
    }

    const onCpu = gauges[SCHEDULER_PRESSURE_METRICS.mainThreadOnCpuRatio]
    const wait = gauges[SCHEDULER_PRESSURE_METRICS.mainThreadRunqueueWaitRatio]
    if (
      options.log &&
      onCpu !== undefined &&
      wait !== undefined &&
      onCpu + wait >= SATURATED_RUNNABLE_RATIO &&
      (lastSaturationLogNs === undefined ||
        next.wallNs - lastSaturationLogNs >= SATURATION_LOG_INTERVAL_MS * 1e6)
    ) {
      lastSaturationLogNs = next.wallNs
      options.log(
        `[scheduler-pressure] event=main_thread_saturated on_cpu=${formatRatio(onCpu)} runqueue_wait=${formatRatio(wait)} cpu_pressure_full_avg10=${formatRatio(gauges[SCHEDULER_PRESSURE_METRICS.cgroupCpuPressureFullAvg10])} sample_interval_s=${formatRatio(gauges[SCHEDULER_PRESSURE_METRICS.sampleIntervalSeconds])}${logIdentity}`,
      )
    }
  }

  const timer = setInterval(sample, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

/** Production-only, process-wide idempotent wiring used by `configureDatadog()`. */
export function startSchedulerPressureMetrics(
  emit: SchedulerPressureOptions["emit"],
): void {
  const global = globalThis as StartedGlobal
  if (global[STARTED_KEY]) return
  if (process.env.NODE_ENV !== "production") return
  if (process.env.FORGE_SCHEDULER_PRESSURE_METRICS === "false") return
  global[STARTED_KEY] = true

  startSchedulerPressureSampler({
    emit,
    log: (message) => console.warn(message),
    tags: instanceTags(resolveInstanceIdentity()),
  })
}
