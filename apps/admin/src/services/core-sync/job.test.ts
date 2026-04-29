import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import type { CoverageAudit } from "@/services/core-sync/coverage-audit"
import type { SyncResult } from "@/services/core-sync/orchestrator"

const syncPrisma = vi.hoisted(() => ({ name: "sync-prisma" }))
const runSync = vi.hoisted(() => vi.fn())

vi.mock("@/db/client", () => ({ syncPrisma }))
vi.mock("@/services/core-sync/orchestrator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/core-sync/orchestrator")>()
  return {
    ...actual,
    runSync,
  }
})

describe("core sync job", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("normalizes scheduled input to incremental all-phase sync", async () => {
    const { normalizeCoreSyncInput } = await import("./job")

    expect(normalizeCoreSyncInput({ trigger: "scheduled" })).toEqual({
      scope: ["languages", "countries", "keywords", "videos", "video-dubs"],
      incremental: true,
      trigger: "scheduled",
    })
  })

  it("preserves manual full-sync scope", async () => {
    const { normalizeCoreSyncInput } = await import("./job")

    expect(
      normalizeCoreSyncInput({
        scope: ["languages", "videos"],
        incremental: false,
        trigger: "manual",
      }),
    ).toEqual({
      scope: ["languages", "videos"],
      incremental: false,
      trigger: "manual",
    })
  })

  it("runs the orchestrator with syncPrisma and normalized input", async () => {
    const result = {
      incremental: false,
      phases: [],
      durationMs: 42,
    } satisfies SyncResult
    runSync.mockResolvedValueOnce(result)
    const { runCoreSyncJob } = await import("./job")

    await expect(
      runCoreSyncJob({
        scope: "languages",
        incremental: false,
        trigger: "graphql",
      }),
    ).resolves.toEqual({
      ...result,
      scope: ["languages"],
      trigger: "graphql",
    })
    expect(runSync).toHaveBeenCalledWith(
      syncPrisma as unknown as PrismaClient,
      {
        scope: ["languages"],
        incremental: false,
      },
    )
  })

  it("preserves lock-held skipped results", async () => {
    const result = {
      skipped: true,
      incremental: true,
      phases: [],
      durationMs: 0,
    } satisfies SyncResult
    runSync.mockResolvedValueOnce(result)
    const { runCoreSyncJob } = await import("./job")

    await expect(
      runCoreSyncJob({ trigger: "scheduled" }),
    ).resolves.toMatchObject({
      skipped: true,
      incremental: true,
      scope: ["languages", "countries", "keywords", "videos", "video-dubs"],
      trigger: "scheduled",
    })
  })

  it("preserves coverage audit result payloads", async () => {
    const coverageAudit = {
      generatedAt: "2026-04-29T00:00:00.000Z",
      status: "pass",
      checks: [],
    } satisfies CoverageAudit
    const result = {
      incremental: true,
      phases: [],
      durationMs: 10,
      coverageAudit,
    } satisfies SyncResult
    runSync.mockResolvedValueOnce(result)
    const { runCoreSyncJob } = await import("./job")

    await expect(runCoreSyncJob()).resolves.toMatchObject({
      coverageAudit,
      trigger: "manual",
    })
  })
})
