// Sync phase: video-subtitles
// Depends on: videos, languages, video-editions
//
// Core's checksum manifest is the source of truth. A mismatch identifies work,
// but only a complete, snapshot-bound detail response authorizes mutation. An
// absence-based delete is therefore always limited to one proved video.

import type { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"

import {
  SUBTITLE_PARITY_DIAGNOSTIC_VERSION,
  emptySyncStats,
  type ProgressReporter,
  type SubtitleParityDiagnostic,
  type SubtitleParityResidualReason,
  type SyncStats,
} from "../types"
import { fetchVideoSubtitleChecksumManifest } from "../video-subtitle-checksum"
import {
  ResidualVideoError,
  SubtitleReconciliationError,
  addResidual,
  completedDiagnostic,
  failureCode,
  fetchAllDetails,
  inSyncEvidence,
  isSnapshotMismatch,
  loadAdminProjection,
  loadPreviousDiagnostic,
  mismatchedVideoIds,
  reconcileVideo,
  resolveDetails,
  safeFailureMessage,
} from "./video-subtitle-reconciliation"

export async function syncVideoSubtitles({
  prisma,
  progress,
  lockOwnerId,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
  lockOwnerId?: string
}): Promise<SyncStats> {
  const stats: SyncStats = { ...emptySyncStats }
  const checkId = randomUUID()
  const startedAt = new Date().toISOString()
  let previous: SubtitleParityDiagnostic | null = null
  const repairedVideoIds = new Set<string>()
  const observedMismatchVideoIds = new Set<string>()

  try {
    previous = await loadPreviousDiagnostic(prisma)
    let snapshotRestarted = false

    while (true) {
      try {
        const [coreManifest, initialAdmin] = await Promise.all([
          fetchVideoSubtitleChecksumManifest(),
          loadAdminProjection(prisma),
        ])
        const bucketMismatches = mismatchedVideoIds(
          coreManifest,
          initialAdmin.manifest,
        )
        const requestedVideoIds = bucketMismatches.filter(
          (videoId) => !videoId.startsWith("admin-video:"),
        )
        for (const videoId of bucketMismatches) {
          observedMismatchVideoIds.add(videoId)
        }
        for (const issue of initialAdmin.issues) {
          observedMismatchVideoIds.add(issue.videoId)
        }

        progress.setTotal(observedMismatchVideoIds.size)

        if (
          coreManifest.rootChecksum === initialAdmin.manifest.rootChecksum &&
          coreManifest.totalCount === initialAdmin.manifest.totalCount &&
          initialAdmin.issues.length === 0
        ) {
          const completedAt = new Date().toISOString()
          const completed = completedDiagnostic({
            checkId,
            startedAt,
            completedAt,
            core: coreManifest,
            admin: initialAdmin,
            initialMismatchVideoIds: observedMismatchVideoIds,
            repairedVideoIds,
            residualVideoIds: new Set(),
            residualReasons: [],
          })
          stats.subtitleParity = {
            version: SUBTITLE_PARITY_DIAGNOSTIC_VERSION,
            latestAttempt: {
              checkId,
              startedAt,
              completedAt,
              status: "completed",
            },
            lastCompleted: completed,
            lastInParity: inSyncEvidence(completed),
          }
          return stats
        }

        const details = await fetchAllDetails(coreManifest, requestedVideoIds)
        const residualVideoIds = new Set<string>()
        const residualReasons: SubtitleParityResidualReason[] = []
        for (const issue of initialAdmin.issues) {
          addResidual(
            residualVideoIds,
            residualReasons,
            issue.videoId,
            issue.code,
            issue.message,
          )
        }
        const resolved = await resolveDetails(
          prisma,
          details,
          initialAdmin,
          residualVideoIds,
          residualReasons,
        )

        if (resolved.size > 0 && !lockOwnerId) {
          throw new SubtitleReconciliationError(
            "MISSING_LOCK_OWNER",
            "Subtitle reconciliation requires the active Core Sync lock owner.",
          )
        }

        for (const videoId of requestedVideoIds) {
          const detail = resolved.get(videoId)
          if (!detail) {
            progress.increment()
            continue
          }
          try {
            const changes = await reconcileVideo(prisma, lockOwnerId!, detail)
            stats.created += changes.created
            stats.updated += changes.updated
            stats.softDeleted += changes.softDeleted
            if (changes.created + changes.updated + changes.softDeleted > 0) {
              repairedVideoIds.add(videoId)
            }
          } catch (error) {
            if (error instanceof ResidualVideoError) {
              addResidual(
                residualVideoIds,
                residualReasons,
                videoId,
                error.code,
                error.message,
              )
            } else {
              throw error
            }
          }
          progress.increment()
        }

        const [finalCore, finalAdmin] = await Promise.all([
          fetchVideoSubtitleChecksumManifest({
            expectedSnapshot: coreManifest.snapshot,
          }),
          loadAdminProjection(prisma),
        ])
        for (const issue of finalAdmin.issues) {
          addResidual(
            residualVideoIds,
            residualReasons,
            issue.videoId,
            issue.code,
            issue.message,
          )
        }
        for (const videoId of mismatchedVideoIds(
          finalCore,
          finalAdmin.manifest,
        )) {
          if (!residualVideoIds.has(videoId)) {
            addResidual(
              residualVideoIds,
              residualReasons,
              videoId,
              "final-checksum-mismatch",
              "Admin still differs from Core after targeted reconciliation.",
            )
          }
        }

        const completedAt = new Date().toISOString()
        const completed = completedDiagnostic({
          checkId,
          startedAt,
          completedAt,
          core: finalCore,
          admin: finalAdmin,
          initialMismatchVideoIds: observedMismatchVideoIds,
          repairedVideoIds,
          residualVideoIds,
          residualReasons,
        })
        stats.subtitleParity = {
          version: SUBTITLE_PARITY_DIAGNOSTIC_VERSION,
          latestAttempt: {
            checkId,
            startedAt,
            completedAt,
            status: "completed",
          },
          lastCompleted: completed,
          lastInParity:
            completed.status === "in-sync"
              ? inSyncEvidence(completed)
              : (previous?.lastInParity ?? null),
        }
        return stats
      } catch (error) {
        if (isSnapshotMismatch(error) && !snapshotRestarted) {
          snapshotRestarted = true
          continue
        }
        if (isSnapshotMismatch(error)) {
          throw new SubtitleReconciliationError(
            "SUBTITLE_SNAPSHOT_UNSTABLE",
            "Core subtitle snapshot changed twice during reconciliation.",
          )
        }
        throw error
      }
    }
  } catch (error) {
    const completedAt = new Date().toISOString()
    stats.errors = 1
    stats.subtitleParity = {
      version: SUBTITLE_PARITY_DIAGNOSTIC_VERSION,
      latestAttempt: {
        checkId,
        startedAt,
        completedAt,
        status: "failed",
        failure: {
          code: failureCode(error),
          message: safeFailureMessage(error),
        },
      },
      lastCompleted: previous?.lastCompleted ?? null,
      lastInParity: previous?.lastInParity ?? null,
    }
    console.error(
      JSON.stringify({
        event: "core-sync.video-subtitle.reconciliation-failed",
        checkId,
        code: failureCode(error),
        error: safeFailureMessage(error),
      }),
    )
    return stats
  }
}
