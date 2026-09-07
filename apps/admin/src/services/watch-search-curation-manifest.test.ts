import { describe, expect, it, vi } from "vitest"
import committedManifest from "../data/watch-search-curations.json"
import { normalizeWatchSearchCurationQuery } from "./typesense-watch-search-curation"
import {
  buildWatchSearchCurationManifest,
  loadWatchSearchCurationManifest,
  serializeWatchSearchCurationManifest,
} from "./watch-search-curation-manifest"

describe("Watch Search curation backup manifest", () => {
  it("commits the Rescue Project recovery record and its reviewed scope", () => {
    const [curation] = committedManifest.curations
    expect(committedManifest.schemaVersion).toBe("watch-search-curations/v1")
    expect(curation).toMatchObject({
      key: "rescue-project-visual-vernacular-intro",
      targetVideoCoreId: "13_0-RPGospelIntro",
      scope: "PUBLISHED_LOCALES",
      position: 1,
      enabled: true,
    })
    expect(curation?.aliases).toHaveLength(22)
    expect(curation?.aliases).toContainEqual(
      expect.objectContaining({
        query: "Rescue Project",
        normalizedQuery: "rescue project",
        locale: null,
        source: "EDITORIAL",
      }),
    )
    for (const alias of curation?.aliases ?? []) {
      expect(alias.normalizedQuery).toBe(
        normalizeWatchSearchCurationQuery(alias.query),
      )
      if (alias.source === "MACHINE") {
        expect(alias).toMatchObject({
          translationModel: "gpt-5",
          sourceTextDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          generatedAt: expect.any(String),
        })
      }
    }
  })

  it("loads disabled and inactive records with translation provenance", async () => {
    const findMany = vi.fn(async () => [])

    await loadWatchSearchCurationManifest({
      watchSearchCuration: { findMany },
    } as never)

    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ key: "asc" }, { id: "asc" }],
      select: expect.objectContaining({
        enabled: true,
        aliases: expect.objectContaining({
          orderBy: [
            { locale: "asc" },
            { normalizedQuery: "asc" },
            { id: "asc" },
          ],
          select: expect.objectContaining({
            active: true,
            source: true,
            translationModel: true,
            sourceTextDigest: true,
            generatedAt: true,
          }),
        }),
      }),
    })
  })

  it("serializes a deterministic recovery artifact without database timestamps", () => {
    const manifest = buildWatchSearchCurationManifest([
      {
        id: "curation-1",
        key: "rescue-project-intro",
        targetVideoCoreId: "13_0-RPGospelIntro",
        scope: "PUBLISHED_LOCALES",
        position: 1,
        enabled: true,
        aliases: [
          {
            id: "alias-fr",
            query: "Projet de sauvetage",
            normalizedQuery: "projet de sauvetage",
            locale: "fr",
            source: "MACHINE",
            translationModel: "gpt-5",
            sourceTextDigest: "sha256:source",
            generatedAt: new Date("2026-09-07T00:00:00.000Z"),
            active: true,
          },
        ],
      },
    ])

    expect(serializeWatchSearchCurationManifest(manifest)).toBe(
      `${JSON.stringify(
        {
          schemaVersion: "watch-search-curations/v1",
          curations: [
            {
              id: "curation-1",
              key: "rescue-project-intro",
              targetVideoCoreId: "13_0-RPGospelIntro",
              scope: "PUBLISHED_LOCALES",
              position: 1,
              enabled: true,
              aliases: [
                {
                  id: "alias-fr",
                  query: "Projet de sauvetage",
                  normalizedQuery: "projet de sauvetage",
                  locale: "fr",
                  source: "MACHINE",
                  translationModel: "gpt-5",
                  sourceTextDigest: "sha256:source",
                  generatedAt: "2026-09-07T00:00:00.000Z",
                  active: true,
                },
              ],
            },
          ],
        },
        null,
        2,
      )}\n`,
    )
  })
})
