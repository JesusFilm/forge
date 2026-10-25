import { beforeEach, describe, expect, it, vi } from "vitest"

const job = vi.hoisted(() => ({
  runVideoDbBackupJob: vi.fn(),
}))

vi.mock("@/services/video-db-backup/job", () => job)

describe("runVideoDbBackup workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("runs video DB backup as a workflow step", async () => {
    const result = {
      event: "video-db.backup.complete",
      profile: "video-core",
      tables: 22,
      path: "/tmp/video.dump",
      upload: {
        bucket: "admin-storage",
        key: "admin-video-db-backups/video-core/video.dump",
      },
    } as const
    job.runVideoDbBackupJob.mockResolvedValueOnce(result)
    const { runVideoDbBackup } = await import("./videoDbBackup")

    await expect(
      runVideoDbBackup({
        trigger: "scheduled",
        ledgerRunId: "workflow-run-1",
      }),
    ).resolves.toEqual(result)
    expect(job.runVideoDbBackupJob).toHaveBeenCalledWith({
      trigger: "scheduled",
      ledgerRunId: "workflow-run-1",
    })
  })
})
