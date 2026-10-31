import { createRequire } from "node:module"
import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { createLoaders } from "./loaders"
import { schema } from "./schema"

const { graphql, GraphQLSchema, GraphQLObjectType, GraphQLList } =
  createRequire(import.meta.url)("graphql") as typeof import("graphql")

type Selection = {
  select?: Record<string, boolean | Selection>
  include?: Record<string, boolean | Selection>
}

function project(value: unknown, query: Selection): unknown {
  if (value == null) return value
  const row = value as Record<string, unknown>
  const result: Record<string, unknown> = query.select ? {} : { ...row }
  for (const [key, selection] of Object.entries(
    query.select ?? query.include ?? {},
  )) {
    if (selection)
      result[key] = selection === true ? row[key] : project(row[key], selection)
  }
  return result
}

describe("authored block dub query fanout", () => {
  it.each([
    "MediaCollectionItem",
    "VideoCarouselItem",
    "VideoBlock",
    "VideoHeroBlock",
  ])(
    "batches 62 sibling %s selections without dropping nested fields",
    async (typeName) => {
      const items = Array.from({ length: 62 }, (_, i) => ({
        videoId: `video-${i}`,
        languageId: "language-en",
      }))
      const dubs = items.map((item, i) => ({
        id: `dub-${i}`,
        ...item,
        hls: `fixture-${i}.m3u8`,
        language: { id: "language-en", slug: "english" },
      }))
      items.push(
        { videoId: "", languageId: "language-en" },
        { videoId: "video-0", languageId: "" },
      )
      const findFirst = vi.fn(
        async (args: Selection & { where: { videoId: string } }) =>
          project(
            dubs.find((dub) => dub.videoId === args.where.videoId),
            args,
          ),
      )
      const raw = vi.fn().mockResolvedValue(
        dubs.map((dub) => ({
          videoId: dub.videoId,
          languageId: dub.languageId,
          dubId: dub.id,
        })),
      )
      const findMany = vi.fn(async (args: Selection) =>
        dubs.map((dub) => project(dub, args)),
      )
      const prisma = {
        $queryRaw: raw,
        videoDub: { findFirst, findMany },
      } as unknown as PrismaClient
      const querySchema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: "BlockBatchTestQuery",
          fields: {
            items: {
              type: new GraphQLList(
                schema.getType(typeName) as import("graphql").GraphQLObjectType,
              ),
              resolve: () => items,
            },
          },
        }),
      })
      const result = await graphql({
        schema: querySchema,
        source: "{ items { videoDub { id hls language { slug } } } }",
        contextValue: { user: null, prisma, loaders: createLoaders(prisma) },
      })
      expect(result.errors).toBeUndefined()
      expect(result.data).toEqual({
        items: [
          ...dubs.map((dub) => ({
            videoDub: {
              id: dub.id,
              hls: dub.hls,
              language: { slug: "english" },
            },
          })),
          { videoDub: null },
          { videoDub: null },
        ],
      })
      expect(findFirst).not.toHaveBeenCalled()
      expect(raw).toHaveBeenCalledOnce()
      expect(findMany).toHaveBeenCalledOnce()
    },
  )
})
