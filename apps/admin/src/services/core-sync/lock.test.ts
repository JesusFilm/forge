import { describe, expect, it, vi } from "vitest"
import {
  acquireSyncLock,
  DEFAULT_SYNC_LOCK_STALE_AFTER_MS,
  refreshSyncLock,
  releaseSyncLock,
} from "./lock"

function buildPrismaMock(executeResult = 1) {
  return {
    syncLock: {
      upsert: vi.fn().mockResolvedValue({ key: "core-sync" }),
    },
    $executeRaw: vi.fn().mockResolvedValue(executeResult),
  }
}

function executedSql(prisma: ReturnType<typeof buildPrismaMock>) {
  const [strings] = prisma.$executeRaw.mock.calls.at(-1) as [
    TemplateStringsArray,
    ...unknown[],
  ]
  return strings.join("?").replace(/\s+/g, " ").trim()
}

describe("core sync lock", () => {
  it("claims an unlocked or stale lock and refreshes the heartbeat timestamp", async () => {
    const prisma = buildPrismaMock(1)

    await expect(acquireSyncLock(prisma as never, "sync-1")).resolves.toBe(true)

    expect(prisma.syncLock.upsert).toHaveBeenCalledWith({
      where: { key: "core-sync" },
      create: { key: "core-sync" },
      update: {},
    })
    expect(executedSql(prisma)).toContain("held_by IS NULL")
    expect(executedSql(prisma)).toContain("updated_at < NOW()")
    expect(executedSql(prisma)).toContain("updated_at = NOW()")
    expect(prisma.$executeRaw.mock.calls[0]).toContain(
      DEFAULT_SYNC_LOCK_STALE_AFTER_MS,
    )
  })

  it("reports an active fresh lock as unavailable", async () => {
    const prisma = buildPrismaMock(0)

    await expect(acquireSyncLock(prisma as never, "sync-2")).resolves.toBe(
      false,
    )
  })

  it("refreshes only the current lock holder", async () => {
    const prisma = buildPrismaMock(1)

    await expect(refreshSyncLock(prisma as never, "sync-1")).resolves.toBe(true)

    expect(executedSql(prisma)).toContain("WHERE key = ? AND held_by = ?")
  })

  it("releases only the current lock holder", async () => {
    const prisma = buildPrismaMock(1)

    await expect(releaseSyncLock(prisma as never, "sync-1")).resolves.toBe(true)

    expect(executedSql(prisma)).toContain("held_by = NULL")
    expect(executedSql(prisma)).toContain("acquired_at = NULL")
    expect(executedSql(prisma)).toContain("WHERE key = ? AND held_by = ?")
  })
})
