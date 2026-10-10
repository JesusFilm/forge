import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import type { TypesenseWatchLexicalDocument } from "./typesense-watch-search-lexical"
import {
  buildTypesenseWatchCurationProjection,
  loadWatchSearchCurations,
  TYPESENSE_WATCH_SEARCH_CURATION_TAG,
} from "./typesense-watch-search-curation"

function lexicalDocument({
  id,
  videoId,
  canonicalVideoId,
  languageIdentity,
  localeCodes,
}: Pick<
  TypesenseWatchLexicalDocument,
  "id" | "videoId" | "canonicalVideoId" | "languageIdentity" | "localeCodes"
>): TypesenseWatchLexicalDocument {
  return {
    id,
    videoId,
    canonicalVideoId,
    languageIdentity,
    localeCodes,
    title_en: ["Fixture"],
  }
}

describe("Typesense Watch Search curation projection", () => {
  it("loads the active PostgreSQL curation contract in stable order", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "rescue-project-intro",
        targetVideoCoreId: "13_0-RPGospelIntro",
        scope: "PUBLISHED_LOCALES" as const,
        position: 1,
        enabled: true,
        aliases: [
          {
            id: "rescue-project-en",
            query: "Rescue Project",
            normalizedQuery: "rescue project",
            locale: null,
            active: true,
          },
        ],
      },
    ])
    const prisma = {
      watchSearchCuration: { findMany },
    } as unknown as PrismaClient

    await expect(loadWatchSearchCurations(prisma)).resolves.toEqual([
      expect.objectContaining({
        id: "rescue-project-intro",
        aliases: [expect.objectContaining({ id: "rescue-project-en" })],
      }),
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      orderBy: { id: "asc" },
      select: {
        id: true,
        targetVideoCoreId: true,
        scope: true,
        position: true,
        enabled: true,
        aliases: {
          where: { active: true },
          orderBy: { id: "asc" },
          select: {
            id: true,
            query: true,
            normalizedQuery: true,
            locale: true,
            active: true,
          },
        },
      },
    })
  })

  it("compiles exact aliases only for published target-video localizations", () => {
    const projection = buildTypesenseWatchCurationProjection({
      setName: "watch_search_curations_generation-7",
      curations: [
        {
          id: "rescue-project-intro",
          targetVideoCoreId: "13_0-RPGospelIntro",
          scope: "PUBLISHED_LOCALES",
          position: 1,
          enabled: true,
          aliases: [
            {
              id: "rescue-project-en",
              query: "  Rescue   Project  ",
              normalizedQuery: "rescue project",
              locale: null,
              active: true,
            },
            {
              id: "rescue-project-fr",
              query: "Projet de sauvetage",
              normalizedQuery: "projet de sauvetage",
              locale: "fr",
              active: true,
            },
            {
              id: "rescue-project-ru",
              query: "Проект спасения",
              normalizedQuery: "проект спасения",
              locale: "ru",
              active: true,
            },
          ],
        },
      ],
      lexicalDocuments: [
        lexicalDocument({
          id: "intro:slug:english",
          videoId: "intro",
          canonicalVideoId: "core:13_0-rpgospelintro",
          languageIdentity: "slug:english",
          localeCodes: ["en"],
        }),
        lexicalDocument({
          id: "intro:slug:french",
          videoId: "intro",
          canonicalVideoId: "core:13_0-rpgospelintro",
          languageIdentity: "slug:french",
          localeCodes: ["fr"],
        }),
        lexicalDocument({
          id: "jesus:slug:english",
          videoId: "jesus",
          canonicalVideoId: "core:1_jf-0-0",
          languageIdentity: "slug:english",
          localeCodes: ["en"],
        }),
      ],
    })

    expect(projection).toEqual({
      name: "watch_search_curations_generation-7",
      set: {
        items: [
          {
            id: expect.stringMatching(/^query-[a-f0-9]{16}$/),
            rule: {
              query: "projet de sauvetage",
              match: "exact",
              tags: [TYPESENSE_WATCH_SEARCH_CURATION_TAG],
            },
            includes: [{ id: "intro:slug:french", position: 1 }],
            filter_curated_hits: true,
            remove_matched_tokens: false,
          },
          {
            id: expect.stringMatching(/^query-[a-f0-9]{16}$/),
            rule: {
              query: "rescue project",
              match: "exact",
              tags: [TYPESENSE_WATCH_SEARCH_CURATION_TAG],
            },
            includes: [
              { id: "intro:slug:english", position: 1 },
              { id: "intro:slug:french", position: 2 },
            ],
            filter_curated_hits: true,
            remove_matched_tokens: false,
          },
        ],
      },
      coverage: [
        {
          curationId: "rescue-project-intro",
          publishedDocumentIds: ["intro:slug:english", "intro:slug:french"],
          skippedAliasIds: ["rescue-project-ru"],
        },
      ],
    })
    expect(JSON.stringify(projection)).not.toContain("jesus:slug:english")
  })

  it("rejects an enabled curation with no published target documents", () => {
    expect(() =>
      buildTypesenseWatchCurationProjection({
        setName: "watch_search_curations_generation-8",
        curations: [
          {
            id: "rescue-project-intro",
            targetVideoCoreId: "13_0-RPGospelIntro",
            scope: "PUBLISHED_LOCALES",
            position: 1,
            enabled: true,
            aliases: [
              {
                id: "rescue-project-en",
                query: "Rescue Project",
                normalizedQuery: "rescue project",
                locale: null,
                active: true,
              },
            ],
          },
        ],
        lexicalDocuments: [],
      }),
    ).toThrow(
      "Watch Search curation rescue-project-intro has no published searchable target documents",
    )
  })
})
