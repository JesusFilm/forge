import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"
import { BlocksSchema, type Block, type Blocks } from "@/domain/blocks"

export const WATCH_HOME_CATEGORY_RAIL_BACKFILL_PHASE =
  "watch-home-category-rail-backfill-v1"

export const DEFAULT_WATCH_HOME_CATEGORY_RAIL_BLOCK = {
  t: "watchHomeCategoryRail",
  sectionKey: "watch-home-category-rail",
  categoryIds: WATCH_HOME_CATEGORY_CATALOG.map(({ id }) => id),
} satisfies Block

type RolloutStateReader = {
  syncState: {
    findUnique(args: {
      where: { phase: string }
      select: { phase: true }
    }): Promise<{ phase: string } | null>
  }
}

// Prisma is process-singleton in production. Once this process observes the
// durable marker, remember it so an intentionally absent post-activation rail
// does not add a steady-state marker query to every homepage response.
const completedRolloutReaders = new WeakSet<object>()

export async function readWatchHomeCategoryRailRolloutCompleted(
  prisma: RolloutStateReader,
): Promise<boolean> {
  if (completedRolloutReaders.has(prisma)) return true

  const completed = await prisma.syncState.findUnique({
    where: { phase: WATCH_HOME_CATEGORY_RAIL_BACKFILL_PHASE },
    select: { phase: true },
  })
  if (!completed) return false

  completedRolloutReaders.add(prisma)
  return true
}

export function synthesizeDefaultWatchHomeCategoryRail(blocks: Blocks): Blocks {
  const heroIndex = blocks.findIndex((block) => block.t === "watchHomeHero")
  const insertAt = heroIndex < 0 ? 0 : heroIndex + 1
  return [
    ...blocks.slice(0, insertAt),
    DEFAULT_WATCH_HOME_CATEGORY_RAIL_BLOCK,
    ...blocks.slice(insertAt),
  ]
}

/**
 * Temporary expand-before-activate read compatibility.
 *
 * Before the reviewed post-deploy backfill records its durable SyncState
 * marker, effective homepages that still have the legacy stored shape receive
 * a synthesized all-category rail. The marker and row updates commit in the
 * same SQL transaction, so after activation an authored absence is
 * authoritative and is never synthesized back into the response.
 */
export function resolveWatchHomeCategoryRailReadBlocks({
  rolloutCompleted,
  blocks,
  isHomepage,
}: {
  rolloutCompleted: boolean
  blocks: unknown
  isHomepage: boolean
}): unknown {
  if (!isHomepage || !Array.isArray(blocks)) return blocks
  if (
    blocks.some(
      (block) =>
        block != null &&
        typeof block === "object" &&
        !Array.isArray(block) &&
        (block as Record<string, unknown>).t === "watchHomeCategoryRail",
    )
  ) {
    return blocks
  }

  const parsed = BlocksSchema.safeParse(blocks)
  if (!parsed.success) return blocks

  if (rolloutCompleted) return blocks

  return synthesizeDefaultWatchHomeCategoryRail(parsed.data)
}
