// In-memory Prisma double for the Core Sync videos phase.
//
// Enough of `video.upsert` / `video.findMany` / `video.updateMany` to make
// Forge's side of the sync observable as STATE rather than as call arguments.
// #2324 is about what Forge ends up believing about a video across successive
// syncs — "is it restricted?", "is it soft-deleted?" — and assertions on
// `upsert` call arguments cannot express "and then the next sync converged".

export type StoredVideo = {
  id: string
  coreId: string
  source: "CORE" | "MANAGER"
  restrictViewPlatforms: string[]
  deletedAt: Date | null
  syncedAt: Date | null
}

export type PrismaVideoStore = {
  /** Pass to `syncVideos({ prisma })` / `syncVideoImages({ prisma })`. */
  client: unknown
  rows: Map<string, StoredVideo>
  get: (coreId: string) => StoredVideo | undefined
  seed: (row: Partial<StoredVideo> & { coreId: string }) => StoredVideo
  images: Map<
    string,
    { coreId: string; videoId: string; deletedAt: Date | null }
  >
}

let nextId = 0

export function createPrismaVideoStore(): PrismaVideoStore {
  const rows = new Map<string, StoredVideo>()
  const images = new Map<
    string,
    { coreId: string; videoId: string; deletedAt: Date | null }
  >()

  function seed(row: Partial<StoredVideo> & { coreId: string }): StoredVideo {
    const stored: StoredVideo = {
      id: row.id ?? `video-${++nextId}`,
      coreId: row.coreId,
      source: row.source ?? "CORE",
      restrictViewPlatforms: row.restrictViewPlatforms ?? [],
      deletedAt: row.deletedAt ?? null,
      syncedAt: row.syncedAt ?? null,
    }
    rows.set(stored.coreId, stored)
    return stored
  }

  const noopMany = async () => ({ count: 0 })

  const video = {
    findMany: async (args: { where?: { coreId?: { in?: string[] } } }) => {
      const ids = args?.where?.coreId?.in
      const all = [...rows.values()]
      const matched = ids ? all.filter((row) => ids.includes(row.coreId)) : all
      return matched.map((row) => ({ ...row }))
    },
    upsert: async (args: {
      where: { coreId: string }
      create: Record<string, unknown>
      update: Record<string, unknown>
    }) => {
      const existing = rows.get(args.where.coreId)
      if (existing) {
        const update = args.update
        if ("restrictViewPlatforms" in update) {
          existing.restrictViewPlatforms =
            update.restrictViewPlatforms as string[]
        }
        // `deletedAt: null` in the update branch is the restore path: an
        // ordinary sync un-tombstones a row Core turns out to still have.
        if ("deletedAt" in update) {
          existing.deletedAt = update.deletedAt as Date | null
        }
        existing.syncedAt = (update.syncedAt as Date) ?? existing.syncedAt
        return { ...existing }
      }
      const created = seed({
        coreId: args.where.coreId,
        restrictViewPlatforms: (args.create.restrictViewPlatforms ??
          []) as string[],
        syncedAt: (args.create.syncedAt as Date) ?? null,
      })
      return { ...created }
    },
    updateMany: async (args: {
      where: {
        source?: string
        coreId?: { notIn?: string[] }
        deletedAt?: null
      }
      data: { deletedAt: Date }
    }) => {
      const notIn = args.where.coreId?.notIn ?? []
      let count = 0
      for (const row of rows.values()) {
        if (args.where.source === "CORE" && row.source !== "CORE") continue
        if (args.where.deletedAt === null && row.deletedAt !== null) continue
        if (notIn.includes(row.coreId)) continue
        row.deletedAt = args.data.deletedAt
        count++
      }
      return { count }
    },
  }

  const videoImage = {
    upsert: async (args: {
      where: { coreId: string }
      create: { coreId: string; videoId: string }
    }) => {
      images.set(args.where.coreId, {
        coreId: args.where.coreId,
        videoId: args.create.videoId,
        deletedAt: null,
      })
      return { id: args.where.coreId }
    },
    updateMany: noopMany,
  }

  const tx = {
    video,
    videoImage,
    videoLocale: {
      findFirst: async () => null,
      create: async () => ({ id: "locale" }),
      update: async () => ({ id: "locale" }),
      updateMany: noopMany,
    },
    videoStudyQuestion: {
      findFirst: async () => null,
      create: async () => ({ id: "question" }),
      update: async () => ({ id: "question" }),
      updateMany: noopMany,
    },
    bibleCitation: { upsert: async () => undefined, updateMany: noopMany },
    videoSubtitle: { upsert: async () => undefined, updateMany: noopMany },
    videoKeyword: { deleteMany: noopMany },
    videoRelation: { deleteMany: noopMany },
    videoOrigin: { upsert: async () => ({ id: "origin" }) },
    bibleBook: {
      upsert: async () => ({ id: "book" }),
      findMany: async () => [],
    },
    keyword: { findMany: async () => [] },
    $executeRaw: async () => undefined,
  }

  const client = {
    language: { findMany: async () => [] },
    videoOrigin: { findMany: async () => [] },
    keyword: { findMany: async () => [] },
    bibleBook: { findMany: async () => [] },
    video,
    videoImage,
    $executeRaw: async () => undefined,
    $transaction: async (fn: (trx: typeof tx) => Promise<unknown>) => fn(tx),
  }

  return {
    client,
    rows,
    images,
    seed,
    get: (coreId: string) => rows.get(coreId),
  }
}
