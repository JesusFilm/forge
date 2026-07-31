// Shared types for the Core sync system.

export type SyncPhase =
  | "languages"
  | "countries"
  | "keywords"
  | "video-origins"
  | "videos"
  | "video-images"
  | "video-editions"
  | "video-subtitles"
  | "video-dubs"
  | "video-dub-downloads"

export const PHASE_ORDER: SyncPhase[] = [
  "languages",
  "countries",
  "keywords",
  "video-origins",
  "videos",
  "video-images",
  "video-editions",
  "video-subtitles",
  "video-dubs",
  "video-dub-downloads",
]

export type SyncStats = {
  created: number
  updated: number
  softDeleted: number
  errors: number
  subtitleParity?: SubtitleParityDiagnostic
}

export const SUBTITLE_PARITY_DIAGNOSTIC_VERSION = 1 as const

export type SubtitleParityAttempt = {
  checkId: string
  startedAt: string
  completedAt: string
  status: "completed" | "failed"
  failure?: {
    code: string
    message: string
  }
}

export type SubtitleParityResidualReason = {
  videoId: string
  code: string
  message: string
}

export type SubtitleParityCompletedCheck = {
  checkId: string
  startedAt: string
  completedAt: string
  status: "in-sync" | "out-of-sync"
  manifestVersion: typeof SUBTITLE_PARITY_DIAGNOSTIC_VERSION
  core: {
    snapshot: string
    rootChecksum: string
    totalCount: number
  }
  admin: {
    rootChecksum: string
    totalCount: number
    unprojectableCount: number
  }
  initialMismatchTotal: number
  repairedTotal: number
  residualTotal: number
  initialMismatchVideoIds: string[]
  repairedVideoIds: string[]
  residualVideoIds: string[]
  residualReasons: SubtitleParityResidualReason[]
  residualReasonTruncatedCount: number
}

export type SubtitleParityInSyncCheck = {
  checkId: string
  completedAt: string
  snapshot: string
  rootChecksum: string
  totalCount: number
}

/**
 * Latest attempt is independent from the last completed comparison. A failed
 * transport/contract/persistence attempt therefore cannot erase the last
 * known parity result operators were shown.
 */
export type SubtitleParityDiagnostic = {
  version: typeof SUBTITLE_PARITY_DIAGNOSTIC_VERSION
  latestAttempt: SubtitleParityAttempt
  lastCompleted: SubtitleParityCompletedCheck | null
  lastInParity: SubtitleParityInSyncCheck | null
}

export type ProgressReporter = {
  setTotal: (total: number) => void
  increment: (count?: number) => void
}

export type SyncPhaseProgress = {
  phase: SyncPhase
  completed: number
  total: number
  elapsedMs: number
}

export type PhaseRunner = (opts: {
  prisma: import("@prisma/client").PrismaClient
  progress: ProgressReporter
  since?: string
  lockOwnerId: string
}) => Promise<SyncStats>

export const emptySyncStats: SyncStats = {
  created: 0,
  updated: 0,
  softDeleted: 0,
  errors: 0,
}
