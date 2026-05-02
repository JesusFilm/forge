import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CoreSyncJobResult } from "@/services/core-sync/job"

const runCoreSyncJob = vi.hoisted(() => vi.fn())

vi.mock("@/services/core-sync/job", () => ({ runCoreSyncJob }))

describe("runCoreSync workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("delegates scheduled sync input to the Core sync job", async () => {
    const result = {
      incremental: true,
      phases: [],
      durationMs: 12,
      scope: ["languages", "countries", "keywords", "videos", "video-dubs"],
      trigger: "scheduled",
    } satisfies CoreSyncJobResult
    runCoreSyncJob.mockResolvedValueOnce(result)
    const { runCoreSync } = await import("./coreSync")

    await expect(
      runCoreSync({ trigger: "scheduled", incremental: true }),
    ).resolves.toEqual(result)
    expect(runCoreSyncJob).toHaveBeenCalledWith({
      trigger: "scheduled",
      incremental: true,
    })
  })

  it("returns skipped lock-held results without throwing", async () => {
    const result = {
      skipped: true,
      incremental: true,
      phases: [],
      durationMs: 0,
      scope: ["languages", "countries", "keywords", "videos", "video-dubs"],
      trigger: "scheduled",
    } satisfies CoreSyncJobResult
    runCoreSyncJob.mockResolvedValueOnce(result)
    const { runCoreSync } = await import("./coreSync")

    await expect(runCoreSync({ trigger: "scheduled" })).resolves.toEqual(result)
  })
})
