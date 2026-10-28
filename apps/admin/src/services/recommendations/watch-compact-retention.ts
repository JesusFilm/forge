import { Prisma, type Prisma as PrismaTypes } from "@prisma/client"

/** Independent fixed-size pages keep parent deletion free of hidden cascades. */
export const WATCH_COMPACT_RECEIPT_PAGE_SIZE = 100
export const WATCH_COMPACT_ITEM_PAGE_SIZE = 100
export const WATCH_COMPACT_WINDOW_PAGE_SIZE = 25

function assertPageSize(pageSize: number, maximum: number): void {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > maximum)
    throw new RangeError("Watch compact retention page size is invalid")
}

export async function purgeExpiredWatchCompactReceiptPage(
  tx: PrismaTypes.TransactionClient,
  now: Date,
  pageSize = WATCH_COMPACT_RECEIPT_PAGE_SIZE,
): Promise<number> {
  assertPageSize(pageSize, WATCH_COMPACT_RECEIPT_PAGE_SIZE)
  const rows = await tx.watchSurfaceEventReceipt.findMany({
    where: { expiresAt: { lte: now } },
    orderBy: [{ expiresAt: "asc" }, { eventId: "asc" }],
    take: pageSize,
    select: { eventId: true },
  })
  if (rows.length === 0) return 0
  return (
    await tx.watchSurfaceEventReceipt.deleteMany({
      where: {
        eventId: { in: rows.map(({ eventId }) => eventId) },
        expiresAt: { lte: now },
      },
    })
  ).count
}

/** Select item keys through their expired parent, then delete only those keys. */
export async function purgeExpiredWatchCompactItemPage(
  tx: PrismaTypes.TransactionClient,
  now: Date,
  pageSize = WATCH_COMPACT_ITEM_PAGE_SIZE,
): Promise<number> {
  assertPageSize(pageSize, WATCH_COMPACT_ITEM_PAGE_SIZE)
  const rows = await tx.$queryRaw<
    Array<{ windowId: string; position: number; itemPath: string }>
  >(Prisma.sql`
    SELECT item.window_id AS "windowId", item.position,
           item.item_path AS "itemPath"
    FROM watch_surface_issued_window AS issued
    JOIN watch_surface_issued_item AS item
      ON item.window_id = issued.window_id
    WHERE issued.expires_at <= ${now}
    ORDER BY issued.expires_at, issued.window_id, item.position, item.item_path
    LIMIT ${pageSize}
  `)
  if (rows.length === 0) return 0
  return (
    await tx.watchSurfaceIssuedItem.deleteMany({
      where: {
        OR: rows.map((row) => ({
          windowId: row.windowId,
          position: row.position,
          itemPath: row.itemPath,
          window: { expiresAt: { lte: now } },
        })),
      },
    })
  ).count
}

/** Lock empty parents first, so no concurrent child can enter before delete. */
export async function purgeExpiredWatchCompactWindowPage(
  tx: PrismaTypes.TransactionClient,
  now: Date,
  pageSize = WATCH_COMPACT_WINDOW_PAGE_SIZE,
): Promise<number> {
  assertPageSize(pageSize, WATCH_COMPACT_WINDOW_PAGE_SIZE)
  const rows = await tx.$queryRaw<Array<{ windowId: string }>>(Prisma.sql`
    SELECT issued.window_id AS "windowId"
    FROM watch_surface_issued_window AS issued
    WHERE issued.expires_at <= ${now}
      AND NOT EXISTS (
        SELECT 1 FROM watch_surface_issued_item AS item
        WHERE item.window_id = issued.window_id
      )
    ORDER BY issued.expires_at, issued.window_id
    LIMIT ${pageSize}
    FOR UPDATE OF issued SKIP LOCKED
  `)
  if (rows.length === 0) return 0
  return (
    await tx.watchSurfaceIssuedWindow.deleteMany({
      where: {
        windowId: { in: rows.map(({ windowId }) => windowId) },
        expiresAt: { lte: now },
        items: { none: {} },
      },
    })
  ).count
}
