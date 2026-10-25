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
}) => Promise<SyncStats>

export const emptySyncStats: SyncStats = {
  created: 0,
  updated: 0,
  softDeleted: 0,
  errors: 0,
}
