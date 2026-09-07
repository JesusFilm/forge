import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { describe, it, expect, vi } from "vitest"
import { env } from "@/config/env"
vi.mock("../core-sync/core-client", () => ({ coreQuery: vi.fn() }))
import { coreQuery } from "../core-sync/core-client"
import { syncVideoEditions } from "../core-sync/phases/sync-video-editions"
class SyncHarnessError extends Error {}
const url = env.STUDIO_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
suite("Core sync preserves Manager identity", () => {
  it("leaves Manager editions intact while updating and tombstoning real Core editions", async () => {
    const p = new URL(url!)
    if (
      p.hostname !== "127.0.0.1" ||
      p.port !== "55459" ||
      p.pathname !== "/forge_studio_459_test"
    )
      throw new SyncHarnessError("Only isolated feat-459 database allowed")
    const db = new PrismaClient({ datasources: { db: { url } } })
    try {
      const manager = await db.videoEdition.create({
        data: {
          source: "MANAGER",
          coreId: randomUUID(),
          name: "Manager-owned",
        },
      })
      const generated = await db.videoEdition.create({
        data: { source: "MANAGER", name: "Generated" },
      })
      const core = await db.videoEdition.create({
        data: { coreId: randomUUID(), name: "Core-old" },
      })
      const absent = await db.videoEdition.create({
        data: { coreId: randomUUID(), name: "Core-absent" },
      })
      vi.mocked(coreQuery).mockResolvedValueOnce({
        data: {
          videoEditions: [
            { id: manager.coreId, name: "Overwritten" },
            { id: core.coreId, name: "Core-current" },
          ],
        },
      })
      await syncVideoEditions({
        prisma: db,
        progress: { setTotal: vi.fn(), increment: vi.fn() },
      })
      expect(
        (await db.videoEdition.findUniqueOrThrow({ where: { id: manager.id } }))
          .name,
      ).toBe("Manager-owned")
      expect(
        (
          await db.videoEdition.findUniqueOrThrow({
            where: { id: generated.id },
          })
        ).deletedAt,
      ).toBeNull()
      expect(
        (await db.videoEdition.findUniqueOrThrow({ where: { id: core.id } }))
          .name,
      ).toBe("Core-current")
      expect(
        (await db.videoEdition.findUniqueOrThrow({ where: { id: absent.id } }))
          .deletedAt,
      ).not.toBeNull()
    } finally {
      await db.$disconnect()
    }
  })
})
