import { describe, expect, it, vi } from "vitest"
import type {
  GraphQLFieldResolver,
  GraphQLObjectType,
  GraphQLResolveInfo,
} from "graphql"
import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"
import { schema } from "@/graphql/schema"
import {
  readWatchHomeCategoryRailRolloutCompleted,
  resolveWatchHomeCategoryRailReadBlocks,
  synthesizeDefaultWatchHomeCategoryRail,
  WATCH_HOME_CATEGORY_RAIL_BACKFILL_PHASE,
} from "./watch-home-category-rail-rollout"

function rolloutPrisma(completed: boolean) {
  return {
    syncState: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          completed ? { phase: WATCH_HOME_CATEGORY_RAIL_BACKFILL_PHASE } : null,
        ),
    },
  }
}

function blockTypes(blocks: unknown) {
  return Array.isArray(blocks)
    ? blocks.map((block) =>
        block && typeof block === "object" && "t" in block ? block.t : null,
      )
    : null
}

async function resolveGraphqlBlocks(
  typeName:
    | "ExperienceLocale"
    | "ExperienceLocaleEffective"
    | "ExperiencePreview",
  row: { isHomepage: boolean; blocks: unknown[] },
  rolloutCompleted = false,
) {
  const type = schema.getType(typeName) as GraphQLObjectType
  const resolve = type.getFields().blocks.resolve as GraphQLFieldResolver<
    unknown,
    unknown
  >
  return resolve(
    row,
    {},
    { watchHomeCategoryRailRolloutCompleted: rolloutCompleted },
    {} as GraphQLResolveInfo,
  )
}

function graphqlBlocksResolver(
  typeName:
    | "ExperienceLocale"
    | "ExperienceLocaleEffective"
    | "ExperiencePreview",
) {
  const type = schema.getType(typeName) as GraphQLObjectType
  return type.getFields().blocks.resolve as GraphQLFieldResolver<
    unknown,
    unknown
  >
}

describe("Watch homepage category rail rollout read fallback", () => {
  it("builds the shared all-category block after the first hero", () => {
    const blocks = synthesizeDefaultWatchHomeCategoryRail([
      { t: "text", heading: "before" },
      { t: "watchHomeHero" },
      { t: "text", heading: "after" },
    ])

    expect(blockTypes(blocks)).toEqual([
      "text",
      "watchHomeHero",
      "watchHomeCategoryRail",
      "text",
    ])
    expect(blocks[2]).toEqual({
      t: "watchHomeCategoryRail",
      sectionKey: "watch-home-category-rail",
      categoryIds: WATCH_HOME_CATEGORY_CATALOG.map(({ id }) => id),
    })
  })

  it("inserts first without a hero only from a pre-activation request snapshot", () => {
    const blocks = [{ t: "text", heading: "body" }]

    const result = resolveWatchHomeCategoryRailReadBlocks({
      rolloutCompleted: false,
      blocks,
      isHomepage: true,
    })

    expect(blockTypes(result)).toEqual(["watchHomeCategoryRail", "text"])
    expect(
      resolveWatchHomeCategoryRailReadBlocks({
        rolloutCompleted: true,
        blocks,
        isHomepage: true,
      }),
    ).toBe(blocks)
  })

  it("preserves authored rail presence and non-homepages", () => {
    const authored = [
      { t: "watchHomeCategoryRail", categoryIds: ["family"] },
      { t: "watchHomeHero" },
    ]
    const nonHomepage = [{ t: "text", heading: "body" }]

    expect(
      resolveWatchHomeCategoryRailReadBlocks({
        rolloutCompleted: false,
        blocks: authored,
        isHomepage: true,
      }),
    ).toBe(authored)
    expect(
      resolveWatchHomeCategoryRailReadBlocks({
        rolloutCompleted: false,
        blocks: nonHomepage,
        isHomepage: false,
      }),
    ).toBe(nonHomepage)
  })

  it.each([
    "ExperienceLocale",
    "ExperienceLocaleEffective",
    "ExperiencePreview",
  ] as const)("synthesizes the %s blocks read surface", async (typeName) => {
    const blocks = await resolveGraphqlBlocks(typeName, {
      isHomepage: true,
      blocks: [{ t: "watchHomeHero" }],
    })

    expect(blockTypes(blocks)).toEqual([
      "watchHomeHero",
      "watchHomeCategoryRail",
    ])
  })

  it("uses one request-start completion snapshot across all block resolvers", async () => {
    const requestContext = { watchHomeCategoryRailRolloutCompleted: false }
    const row = { isHomepage: true, blocks: [{ t: "watchHomeHero" }] }

    const results = await Promise.all(
      (
        [
          "ExperienceLocale",
          "ExperienceLocaleEffective",
          "ExperiencePreview",
        ] as const
      ).map((typeName) =>
        graphqlBlocksResolver(typeName)(
          row,
          {},
          requestContext,
          {} as GraphQLResolveInfo,
        ),
      ),
    )

    expect(results.map(blockTypes)).toEqual([
      ["watchHomeHero", "watchHomeCategoryRail"],
      ["watchHomeHero", "watchHomeCategoryRail"],
      ["watchHomeHero", "watchHomeCategoryRail"],
    ])
  })

  it("rechecks a missing marker at the next request start and caches completion", async () => {
    const prisma = rolloutPrisma(false)
    prisma.syncState.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        phase: WATCH_HOME_CATEGORY_RAIL_BACKFILL_PHASE,
      })

    await expect(
      readWatchHomeCategoryRailRolloutCompleted(prisma),
    ).resolves.toBe(false)
    await expect(
      readWatchHomeCategoryRailRolloutCompleted(prisma),
    ).resolves.toBe(true)
    await expect(
      readWatchHomeCategoryRailRolloutCompleted(prisma),
    ).resolves.toBe(true)
    expect(prisma.syncState.findUnique).toHaveBeenCalledTimes(2)
  })

  it("keeps authored absence authoritative on a restarted process's first request", async () => {
    const restartedProcessPrisma = rolloutPrisma(true)
    const blocks = [{ t: "watchHomeHero" }]

    const rolloutCompleted = await readWatchHomeCategoryRailRolloutCompleted(
      restartedProcessPrisma,
    )
    const result = resolveWatchHomeCategoryRailReadBlocks({
      rolloutCompleted,
      blocks,
      isHomepage: true,
    })

    expect(result).toBe(blocks)
    expect(restartedProcessPrisma.syncState.findUnique).toHaveBeenCalledOnce()
  })
})
