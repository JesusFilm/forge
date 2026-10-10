import { setTimeout as delay } from "node:timers/promises"
import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"
import { studioAttemptResultSchema } from "@forge/studio-contracts"
import type { z } from "zod"
type StudioAttemptResult = z.infer<typeof studioAttemptResultSchema>

export class StudioRenderRunError extends Error {}
export class StudioRenderRetentionError extends StudioRenderRunError {
  constructor(readonly result: StudioAttemptResult) {
    super("Render retention incomplete")
  }
}
export interface StudioRenderRunPort {
  enqueue(attemptId: string): Promise<unknown>
  claim(
    attemptId: string,
  ): Promise<
    | { execute: false; leaseId: null }
    | { execute: true; leaseId: string; expiresAt: number }
  >
  prepare(
    attemptId: string,
    leaseId: string,
    expiresAt: number,
    signal: AbortSignal,
  ): Promise<{
    execute(signal: AbortSignal): Promise<{
      retain(signal: AbortSignal): Promise<StudioAttemptResult>
    }>
  }>
  owns(
    attemptId: string,
    leaseId: string,
    signal: AbortSignal,
  ): Promise<boolean>
  finish(
    attemptId: string,
    leaseId: string,
    status: "SUCCEEDED" | "FAILED" | "CANCELLED",
    result: StudioAttemptResult,
    signal: AbortSignal,
  ): Promise<unknown>
}
/** A restart re-scans canonical admissions. Claims serialize dispatch, while
 * issued lease receipts retain losing results without resurrecting the attempt.
 * Retention has its own bounded window even if cancellation races completed
 * bytes; cancellation cannot discard an already verified output silently. */
export async function runStudioRenderJob(
  attemptId: string,
  port: StudioRenderRunPort,
  parent: AbortSignal,
) {
  parent.throwIfAborted()
  await port.enqueue(attemptId)
  const lease = await port.claim(attemptId)
  if (!lease.execute) return
  const cancel = new AbortController(),
    monitorStop = new AbortController()
  const leaseRemaining = lease.expiresAt - Date.now()
  const executionSignal = AbortSignal.any([
    parent,
    cancel.signal,
    AbortSignal.timeout(Math.max(1, leaseRemaining)),
  ])
  const monitor = (async () => {
    try {
      while (!monitorStop.signal.aborted) {
        await delay(2000, undefined, { signal: monitorStop.signal })
        const signal = AbortSignal.any([
          monitorStop.signal,
          AbortSignal.timeout(5000),
        ])
        if (!(await port.owns(attemptId, lease.leaseId, signal))) {
          cancel.abort(new StudioRenderRunError("Render lease lost"))
          return
        }
      }
    } catch (error) {
      if (!monitorStop.signal.aborted) cancel.abort(error)
    }
  })()
  let retained: StudioAttemptResult = {
    assets: [],
    costMicros: null,
    diagnostic: "Render execution failed",
  }
  let status: "SUCCEEDED" | "FAILED" | "CANCELLED" = "FAILED"
  let retentionDeadline: number | undefined
  try {
    executionSignal.throwIfAborted()
    const prepared = await port.prepare(
      attemptId,
      lease.leaseId,
      lease.expiresAt,
      AbortSignal.any([
        executionSignal,
        AbortSignal.timeout(STUDIO_RENDER_PROFILE.preparationMs),
      ]),
    )
    const output = await prepared.execute(
      AbortSignal.any([
        executionSignal,
        AbortSignal.timeout(STUDIO_RENDER_PROFILE.requestMs),
      ]),
    )
    retentionDeadline = Date.now() + STUDIO_RENDER_PROFILE.retentionMs
    retained = await output.retain(
      AbortSignal.timeout(STUDIO_RENDER_PROFILE.retentionTransferMs),
    )
    status = "SUCCEEDED"
  } catch (error) {
    status = executionSignal.aborted ? "CANCELLED" : "FAILED"
    retained =
      error instanceof StudioRenderRetentionError
        ? error.result
        : {
            assets: [],
            costMicros: null,
            diagnostic:
              status === "CANCELLED"
                ? "Render execution cancelled or lease expired"
                : "Render execution or retention failed",
          }
  } finally {
    monitorStop.abort()
    await monitor
  }
  // Admin is the only authority for whether this result wins. A network failure
  // here is left for lease reconciliation, never retried as a new admission.
  const recordingMs = Math.min(
    STUDIO_RENDER_PROFILE.terminalRecordingMs,
    (retentionDeadline ??
      Date.now() + STUDIO_RENDER_PROFILE.terminalRecordingMs) - Date.now(),
  )
  if (recordingMs <= 0)
    throw new StudioRenderRunError(
      "Terminal recording deadline exhausted; canonical reconciliation required",
    )
  await port.finish(
    attemptId,
    lease.leaseId,
    status,
    retained,
    AbortSignal.timeout(recordingMs),
  )
}
