import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import type { TypesenseClient } from "./typesense-client"
import {
  parseTypesenseVector,
  rebuildTypesenseWatchSearchIndex,
  TypesenseWatchSearchIndexError,
} from "./typesense-watch-search-indexer"
import {
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
} from "./typesense-watch-search-schema"

describe("Typesense Watch Search indexer", () => {
  it("parses a complete pgvector value", () => {
    const vector = parseTypesenseVector(
      `[${new Array(TYPESENSE_WATCH_EMBEDDING_DIMENSIONS).fill("0.125").join(",")}]`,
    )
    expect(vector).toHaveLength(TYPESENSE_WATCH_EMBEDDING_DIMENSIONS)
    expect(vector[0]).toBe(0.125)
  })

  it("rejects malformed and wrong-dimension vectors", () => {
    expect(() => parseTypesenseVector("not-a-vector")).toThrow(
      TypesenseWatchSearchIndexError,
    )
    expect(() => parseTypesenseVector("[1,2,3]")).toThrow(
      `Transcript vector must contain ${TYPESENSE_WATCH_EMBEDDING_DIMENSIONS} finite values`,
    )
  })

  it("rejects an invalid import batch size before touching dependencies", async () => {
    await expect(
      rebuildTypesenseWatchSearchIndex({
        prisma: {} as never,
        typesense: {} as never,
        batchSize: 0,
      }),
    ).rejects.toThrow("batch size must be a positive integer")
  })

  it("restores the first alias when publishing the second alias fails", async () => {
    const prisma = {
      video: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    } as unknown as PrismaClient
    const typesense = {
      getAlias: vi.fn(async (alias: string) => ({
        name: alias,
        collection_name:
          alias === TYPESENSE_WATCH_TRANSCRIPT_ALIAS
            ? "transcripts_previous"
            : "catalog_previous",
      })),
      createCollection: vi.fn(async () => ({})),
      importDocuments: vi.fn(async () => undefined),
      upsertAlias: vi.fn(async (alias: string, collection: string) => {
        if (
          alias === TYPESENSE_WATCH_CATALOG_ALIAS &&
          collection !== "catalog_previous"
        ) {
          throw new Error("catalog alias failed")
        }
      }),
      deleteAlias: vi.fn(async () => undefined),
      deleteCollection: vi.fn(async () => undefined),
    } as unknown as TypesenseClient

    await expect(
      rebuildTypesenseWatchSearchIndex({
        prisma,
        typesense,
        buildId: "rollback-test",
      }),
    ).rejects.toThrow("catalog alias failed")

    expect(typesense.upsertAlias).toHaveBeenCalledWith(
      TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
      "transcripts_previous",
    )
    expect(typesense.deleteCollection).toHaveBeenCalledTimes(2)
  })
})
