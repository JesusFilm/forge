// Shared types for the Core sync system.

export type SyncPhase =
  | "languages"
  | "countries"
  | "keywords"
  | "videos"
  | "video-dubs"

export const PHASE_ORDER: SyncPhase[] = [
  "languages",
  "countries",
  "keywords",
  "videos",
  "video-dubs",
]

export type SyncStats = {
  created: number
  updated: number
  softDeleted: number
  errors: number
  /**
   * Rows the phase intentionally did not write — currently used by
   * sync-dubs to count variants whose video FK isn't yet present in
   * admin (pre-cursor phase hasn't caught up). Distinct from
   * `errors` because skipping is an expected outcome of inter-phase
   * ordering, not a failure: the soft-delete sweep should still run
   * if a phase only saw skips. Surfaced in per-phase stats so
   * operators can alert on `skipped > threshold`.
   */
  skipped: number
}

export type ProgressReporter = {
  setTotal: (total: number) => void
  increment: (count?: number) => void
}

export type PhaseRunner = (opts: {
  prisma: import("@prisma/client").PrismaClient
  progress: ProgressReporter
  since?: string
}) => Promise<SyncStats>

export const emptySyncStats: SyncStats = {
  created: 0,
  updated: 0,
  softDeleted: 0,
  errors: 0,
  skipped: 0,
}
