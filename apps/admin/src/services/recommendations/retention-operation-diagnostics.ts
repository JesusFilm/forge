import { monitorEventLoopDelay, performance } from "node:perf_hooks"
import { getHeapStatistics } from "node:v8"

export type RetentionExecutionContext =
  | "manual-cli"
  | "scheduled-job"
  | "worker-job"
  | "unspecified"

type DecisionEvent = "select" | "selected" | "update" | "updated"
export type RetentionDecisionObserver = (
  event: DecisionEvent,
  count?: number,
) => void

export type RetentionDecisionObservation = {
  executionContext: RetentionExecutionContext
  scope: "executing-process-wide-decision-operation"
  gcAttribution: "unmeasured"
  boundary: "select" | "update" | "complete" | "unavailable"
  selectedCount: number | null
  unlinkedCount: number | null
  selectMs: number | null
  updateMs: number | null
  incompleteStageMs: number | null
  elapsedMs: number | null
  heapUsedStartBytes: number | null
  heapUsedEndBytes: number | null
  heapLimitBytes: number | null
  processCpuUserMs: number | null
  processCpuSystemMs: number | null
  loopActiveMs: number | null
  loopIdleMs: number | null
  loopDelayMaxMs: number | null
}

const CONTEXTS = new Set([
  "manual-cli",
  "scheduled-job",
  "worker-job",
  "unspecified",
])
const NUMBER_KEYS = [
  "selectedCount",
  "unlinkedCount",
  "selectMs",
  "updateMs",
  "incompleteStageMs",
  "elapsedMs",
  "heapUsedStartBytes",
  "heapUsedEndBytes",
  "heapLimitBytes",
  "processCpuUserMs",
  "processCpuSystemMs",
  "loopActiveMs",
  "loopIdleMs",
  "loopDelayMaxMs",
] as const

function number(value: number): number | null {
  const rounded = Math.round(value)
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : null
}

// A failed diagnostic must never replace the original query/error/result.
export function recordRetentionDecisionOperation(
  observer: RetentionDecisionObserver | undefined,
  event: DecisionEvent,
  count?: number,
): void {
  try {
    observer?.(event, count)
  } catch {
    // No error inspection or logging on this path.
  }
}

/** Only this Node process is sampled, never PID1 or a diagnostic subprocess.
 * The interval covers the decision helper, not the entire purge or exclusive
 * query CPU. Concurrent work and GC may contribute; no GC cause is inferred.
 */
export function createRetentionDecisionObservation(
  executionContext: RetentionExecutionContext,
) {
  const observation: RetentionDecisionObservation = {
    executionContext: CONTEXTS.has(executionContext)
      ? executionContext
      : "unspecified",
    scope: "executing-process-wide-decision-operation",
    gcAttribution: "unmeasured",
    boundary: "unavailable",
    selectedCount: null,
    unlinkedCount: null,
    selectMs: null,
    updateMs: null,
    incompleteStageMs: null,
    elapsedMs: null,
    heapUsedStartBytes: null,
    heapUsedEndBytes: null,
    heapLimitBytes: null,
    processCpuUserMs: null,
    processCpuSystemMs: null,
    loopActiveMs: null,
    loopIdleMs: null,
    loopDelayMaxMs: null,
  }
  let histogram: ReturnType<typeof monitorEventLoopDelay> | undefined
  let started: number | undefined
  let stageStarted: number | undefined
  let cpu: ReturnType<typeof process.cpuUsage> | undefined
  let loop: ReturnType<typeof performance.eventLoopUtilization> | undefined
  let disposed = false
  try {
    started = performance.now()
    cpu = process.cpuUsage()
    loop = performance.eventLoopUtilization()
    const heap = getHeapStatistics()
    observation.heapUsedStartBytes = number(heap.used_heap_size)
    observation.heapLimitBytes = number(heap.heap_size_limit)
    histogram = monitorEventLoopDelay({ resolution: 20 })
    histogram.enable()
  } catch {
    // Partial observations remain useful; finish always disposes the sampler.
  }
  const record: RetentionDecisionObserver = (event, count) => {
    if (disposed) return
    try {
      if (event === "select" || event === "update") {
        observation.boundary = event
        stageStarted = performance.now()
      } else {
        const elapsed =
          stageStarted === undefined
            ? null
            : number(performance.now() - stageStarted)
        const boundedCount =
          Number.isSafeInteger(count) && count! >= 0 && count! <= 5_000
            ? count!
            : null
        if (event === "selected") {
          observation.selectMs = elapsed
          observation.selectedCount = boundedCount
        } else {
          observation.updateMs = elapsed
          observation.unlinkedCount = boundedCount
        }
      }
    } catch {
      // Observations cannot affect the operation.
    }
  }
  return {
    record,
    finish(completed: boolean): RetentionDecisionObservation {
      if (disposed) return { ...observation }
      disposed = true
      try {
        if (completed) observation.boundary = "complete"
        else if (stageStarted !== undefined)
          observation.incompleteStageMs = number(
            performance.now() - stageStarted,
          )
        if (started !== undefined)
          observation.elapsedMs = number(performance.now() - started)
        const heap = getHeapStatistics()
        observation.heapUsedEndBytes = number(heap.used_heap_size)
        observation.heapLimitBytes = number(heap.heap_size_limit)
        if (cpu) {
          const delta = process.cpuUsage(cpu)
          observation.processCpuUserMs = number(delta.user / 1_000)
          observation.processCpuSystemMs = number(delta.system / 1_000)
        }
        if (loop) {
          const delta = performance.eventLoopUtilization(loop)
          observation.loopActiveMs = number(delta.active)
          observation.loopIdleMs = number(delta.idle)
        }
        // An unprimed/short interval cannot establish absence of a pause.
        if (histogram && histogram.count > 0)
          observation.loopDelayMaxMs = number(histogram.max / 1e6)
      } catch {
        // Preserve the original error even if runtime sampling fails.
      } finally {
        try {
          histogram?.disable()
        } catch {
          // No handles or timers are added beyond the owned histogram.
        }
      }
      return { ...observation }
    },
  }
}

export function isRetentionDecisionObservation(
  value: unknown,
): value is RetentionDecisionObservation {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false
  const v = value as Record<string, unknown>
  return (
    Object.keys(v).length === NUMBER_KEYS.length + 4 &&
    typeof v.executionContext === "string" &&
    CONTEXTS.has(v.executionContext) &&
    v.scope === "executing-process-wide-decision-operation" &&
    v.gcAttribution === "unmeasured" &&
    typeof v.boundary === "string" &&
    ["select", "update", "complete", "unavailable"].includes(v.boundary) &&
    NUMBER_KEYS.every(
      (key) =>
        Object.hasOwn(v, key) &&
        (v[key] === null ||
          (typeof v[key] === "number" &&
            Number.isSafeInteger(v[key]) &&
            v[key] >= 0 &&
            (!(key === "selectedCount" || key === "unlinkedCount") ||
              v[key] <= 5_000))),
    )
  )
}

// Copy data descriptors only; producer-side validation prevents future callers
// from accidentally logging fields that the parser would later reject.
export function safeRetentionDecisionObservation(
  value: unknown,
): RetentionDecisionObservation | null {
  try {
    if (value === null || typeof value !== "object") return null
    const copy = Object.fromEntries(
      [
        "executionContext",
        "scope",
        "gcAttribution",
        "boundary",
        ...NUMBER_KEYS,
      ].map((key) => [key, Object.getOwnPropertyDescriptor(value, key)?.value]),
    )
    return isRetentionDecisionObservation(copy) ? copy : null
  } catch {
    return null
  }
}
