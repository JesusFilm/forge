import { sleep } from "workflow"
import type {
  VideoDbBackupSchedulerInput,
  VideoDbBackupWorkflowInput,
} from "@/services/video-db-backup/job"
import type { VideoDbBackupJobResult } from "@/services/video-db-backup/profiles"

export async function runVideoDbBackup(
  input: VideoDbBackupWorkflowInput = {},
): Promise<VideoDbBackupJobResult> {
  "use workflow"

  return stepRunVideoDbBackup(input)
}

async function stepRunVideoDbBackup(
  input: VideoDbBackupWorkflowInput,
): Promise<VideoDbBackupJobResult> {
  "use step"

  const { runVideoDbBackupJob } = await import("@/services/video-db-backup/job")
  return runVideoDbBackupJob(input)
}

export async function runVideoDbBackupScheduler(
  input: VideoDbBackupSchedulerInput = {},
): Promise<never> {
  "use workflow"

  await stepMarkSchedulerStarted(input)
  await stepRunScheduledBackup()

  while (true) {
    const nextRunAt = await stepNextRunAt(input)
    await sleep(nextRunAt)
    await stepRunScheduledBackup()
  }
}

async function stepMarkSchedulerStarted(
  input: VideoDbBackupSchedulerInput,
): Promise<void> {
  "use step"

  const { markVideoDbBackupSchedulerStarted } =
    await import("@/services/video-db-backup/job")
  await markVideoDbBackupSchedulerStarted(input)
}

async function stepNextRunAt(
  input: VideoDbBackupSchedulerInput,
): Promise<Date> {
  "use step"

  const { nextVideoDbBackupRunAt, recordVideoDbBackupSchedulerHeartbeat } =
    await import("@/services/video-db-backup/job")
  const nextRunAt = nextVideoDbBackupRunAt()
  await recordVideoDbBackupSchedulerHeartbeat(input, nextRunAt)
  return nextRunAt
}

async function stepRunScheduledBackup(): Promise<void> {
  "use step"

  const { runVideoDbBackupFromScheduler } =
    await import("@/services/video-db-backup/job")
  await runVideoDbBackupFromScheduler()
}
