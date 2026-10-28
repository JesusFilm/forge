import type { Prisma } from "@prisma/client"

/** One bounded page; caller may run another page on its next retention pass. */
export async function purgeExpiredWatchCompactAdmission(
  tx: Prisma.TransactionClient,
  now: Date,
  pageSize: number,
): Promise<{ receipts: number; windows: number }> {
  const [receipts, windows] = await Promise.all([
    tx.watchSurfaceEventReceipt.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { eventId: "asc" }],
      take: pageSize,
      select: { eventId: true },
    }),
    tx.watchSurfaceIssuedWindow.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { windowId: "asc" }],
      take: pageSize,
      select: { windowId: true },
    }),
  ])
  const [removedReceipts, removedWindows] = await Promise.all([
    tx.watchSurfaceEventReceipt.deleteMany({
      where: { eventId: { in: receipts.map(({ eventId }) => eventId) } },
    }),
    tx.watchSurfaceIssuedWindow.deleteMany({
      where: { windowId: { in: windows.map(({ windowId }) => windowId) } },
    }),
  ])
  return { receipts: removedReceipts.count, windows: removedWindows.count }
}
