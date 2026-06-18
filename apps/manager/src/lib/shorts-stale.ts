import type { JobRecord, ShortsJobReport, ShortsPhase } from "@/types/job"

export const SHORTS_ACTIVE_STALL_GRACE_MS = 5 * 60_000
export const SHORTS_QUEUED_STALL_AFTER_MS = SHORTS_ACTIVE_STALL_GRACE_MS
export const SHORTS_PREPARING_STALL_AFTER_MS =
  50 * 60_000 + SHORTS_ACTIVE_STALL_GRACE_MS
export const SHORTS_RENDERING_STALL_AFTER_MS =
  80 * 60_000 + SHORTS_ACTIVE_STALL_GRACE_MS
export const SHORTS_MUX_PROCESSING_STALL_AFTER_MS =
  60 * 60_000 + SHORTS_ACTIVE_STALL_GRACE_MS

const ACTIVE_STALL_LIMITS: Partial<Record<ShortsPhase, number>> = {
  queued: SHORTS_QUEUED_STALL_AFTER_MS,
  preparing: SHORTS_PREPARING_STALL_AFTER_MS,
  rendering: SHORTS_RENDERING_STALL_AFTER_MS,
  mux_processing: SHORTS_MUX_PROCESSING_STALL_AFTER_MS,
}

export type ShortsActiveStall = {
  phase: Extract<
    ShortsPhase,
    "queued" | "preparing" | "rendering" | "mux_processing"
  >
  elapsedMs: number
  retryKind: "prepare" | "render"
  label: string
  message: string
}

function parseTime(value: string | undefined | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function retryKindForPhase(
  phase: ShortsActiveStall["phase"],
): "prepare" | "render" {
  return phase === "queued" || phase === "preparing" ? "prepare" : "render"
}

function labelForPhase(phase: ShortsActiveStall["phase"]): string {
  switch (phase) {
    case "queued":
      return "Launch stalled"
    case "preparing":
      return "Prepare stalled"
    case "rendering":
      return "Render stalled"
    case "mux_processing":
      return "Mux publish stalled"
  }
}

export function getShortsActiveStall(
  job: Pick<JobRecord, "createdAt" | "updatedAt">,
  report: Pick<ShortsJobReport, "phase" | "updatedAt"> | null,
  now: Date = new Date(),
): ShortsActiveStall | null {
  const phase = report?.phase ?? "queued"
  const limitMs = ACTIVE_STALL_LIMITS[phase]
  if (limitMs === undefined) {
    return null
  }

  const activeSince =
    parseTime(report?.updatedAt) ??
    parseTime(job.updatedAt) ??
    parseTime(job.createdAt)
  if (activeSince === null) {
    return null
  }

  const elapsedMs = now.getTime() - activeSince
  if (elapsedMs < limitMs) {
    return null
  }

  const activePhase = phase as ShortsActiveStall["phase"]
  const retryKind = retryKindForPhase(activePhase)

  return {
    phase: activePhase,
    elapsedMs,
    retryKind,
    label: labelForPhase(activePhase),
    message:
      retryKind === "prepare"
        ? "The prepare workflow has not updated this short within its expected window. Retry will relaunch prepare."
        : "The render workflow has not updated this short within its expected window. Retry will relaunch render.",
  }
}
