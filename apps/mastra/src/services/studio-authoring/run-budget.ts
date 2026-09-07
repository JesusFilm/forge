import { STUDIO_AGENT_LIMITS } from "@forge/studio-contracts/agent"
import { StudioBoundaryError } from "@forge/studio-server"

type AbortSource = "caller" | "whole-run" | "step" | "persistence"
export class StudioRunDeadlineError extends StudioBoundaryError {
  constructor(public readonly source: AbortSource) {
    super(
      source === "caller"
        ? "Studio caller cancelled generation. Inspect retained results before another request."
        : `Studio ${source} deadline exceeded. Inspect retained results; provider cost may be unknown.`,
    )
  }
}
export type StudioRunTelemetry = {
  event:
    | "started"
    | "step-started"
    | "step-finished"
    | "aborted"
    | "settling"
    | "settled"
    | "settlement-timeout"
  startedAt: string
  observedAt: string
  elapsedMs: number
  remainingMs: number
  source?: AbortSource
  firstAbortSource?: AbortSource
}
export type StudioSettlement = { signal: AbortSignal; timeoutMs: number }

/** One monotonic clock for the entire admitted run, including terminal persistence. */
export class StudioRunBudget {
  private readonly started = performance.now()
  private readonly startedAt = new Date().toISOString()
  private readonly controller = new AbortController()
  private readonly generationTimer: ReturnType<typeof setTimeout>
  private stepTimer?: ReturnType<typeof setTimeout>
  private closed = false
  private readonly callerAborted = () => this.abort("caller")
  reason?: StudioRunDeadlineError

  constructor(
    private readonly caller: AbortSignal,
    private readonly report: (event: StudioRunTelemetry) => void = () => {},
  ) {
    // This runs independently of model iterations, so a blocked tool cannot
    // consume the terminal-recording reserve. settle uses the original clock.
    this.generationTimer = setTimeout(
      () => this.abort("whole-run"),
      STUDIO_AGENT_LIMITS.runMs - STUDIO_AGENT_LIMITS.persistenceMs,
    )
    this.observe("started")
    caller.addEventListener("abort", this.callerAborted, { once: true })
    if (caller.aborted) this.callerAborted()
  }
  get signal() {
    return this.controller.signal
  }
  remainingMs() {
    return Math.max(
      0,
      STUDIO_AGENT_LIMITS.runMs - (performance.now() - this.started),
    )
  }
  private observe(event: StudioRunTelemetry["event"], source?: AbortSource) {
    try {
      this.report({
        event,
        startedAt: this.startedAt,
        observedAt: new Date().toISOString(),
        elapsedMs: performance.now() - this.started,
        remainingMs: this.remainingMs(),
        ...(source ? { source } : {}),
        ...(this.reason ? { firstAbortSource: this.reason.source } : {}),
      })
    } catch {
      /* Telemetry failure must not disable the deadline. */
    }
  }
  private abort(source: AbortSource) {
    if (this.signal.aborted || this.closed) return
    this.reason = new StudioRunDeadlineError(source)
    this.observe("aborted", source)
    this.controller.abort(this.reason)
  }
  beginStep() {
    this.signal.throwIfAborted()
    if (this.closed) throw new StudioBoundaryError("Studio run is closed")
    this.endStep()
    const available = this.remainingMs() - STUDIO_AGENT_LIMITS.persistenceMs
    if (available <= 0) {
      this.abort("whole-run")
      this.signal.throwIfAborted()
    }
    const duration = Math.min(STUDIO_AGENT_LIMITS.stepMs, available)
    this.stepTimer = setTimeout(
      () =>
        this.abort(
          duration < STUDIO_AGENT_LIMITS.stepMs ? "whole-run" : "step",
        ),
      duration,
    )
    this.observe("step-started")
  }
  endStep() {
    if (!this.stepTimer) return
    clearTimeout(this.stepTimer)
    this.stepTimer = undefined
    this.observe("step-finished")
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    return this.untilAborted(this.signal, work)
  }
  private async untilAborted<T>(
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted()
    let rejectAbort: () => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(signal.reason)
      signal.addEventListener("abort", rejectAbort, { once: true })
    })
    try {
      return await Promise.race([work(), aborted])
    } finally {
      signal.removeEventListener("abort", rejectAbort)
    }
  }
  async settle<T>(work: (context: StudioSettlement) => Promise<T>): Promise<T> {
    this.endStep()
    // Generation is over. Its cutoff must not turn a successful terminal
    // write into an aborted stream; persistence still uses the original clock.
    clearTimeout(this.generationTimer)
    const timeoutMs = Math.min(
      STUDIO_AGENT_LIMITS.persistenceMs,
      this.remainingMs(),
    )
    if (timeoutMs <= 0) throw new StudioRunDeadlineError("persistence")
    const controller = new AbortController()
    const timer = setTimeout(() => {
      this.observe("settlement-timeout", "persistence")
      controller.abort(new StudioRunDeadlineError("persistence"))
    }, timeoutMs)
    this.observe("settling")
    try {
      const result = await this.untilAborted(controller.signal, () =>
        work({ signal: controller.signal, timeoutMs }),
      )
      this.observe("settled")
      return result
    } finally {
      clearTimeout(timer)
    }
  }
  close() {
    this.endStep()
    clearTimeout(this.generationTimer)
    this.caller.removeEventListener("abort", this.callerAborted)
    this.closed = true
  }
}
