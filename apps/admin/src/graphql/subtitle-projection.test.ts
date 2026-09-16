import { createRequire } from "node:module"
import { describe, expect, it, vi } from "vitest"
import { schema } from "@/graphql/schema"

// Pothos loads GraphQL's CommonJS entry; use that same instance in Vitest.
const { graphql } = createRequire(import.meta.url)(
  "graphql",
) as typeof import("graphql")

type Selection = {
  select?: Record<string, boolean | Selection>
  include?: Record<string, boolean | Selection>
}

const language = {
  id: "language",
  coreId: "529",
  name: { en: "English" },
  bcp47: "en",
  iso3: "eng",
  slug: "english",
  audioPreviewValue: "audio.mp3",
  audioPreviewDuration: 7,
  audioPreviewSize: 9007199254740993n,
  audioPreviewBitrate: 128,
  audioPreviewCodec: "mp3",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-02T00:00:00Z"),
}
const subtitle = {
  id: "subtitle",
  value: "subtitle-value",
  primary: true,
  vttSrc: "subtitle.vtt",
  srtSrc: "subtitle.srt",
  aiGenerated: false,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  language,
}
const dub = {
  id: "dub",
  language,
  videoEdition: { id: "edition", subtitles: [subtitle] },
}

// Return only the fields Pothos actually asks Prisma to load. Missing custom
// field selections then fail GraphQL execution instead of being hidden by a
// full-row mock. The real PostgreSQL load probe covers ORM materialization.
function project(value: unknown, query: Selection): unknown {
  if (value == null) return value
  if (Array.isArray(value)) return value.map((row) => project(row, query))
  const row = value as Record<string, unknown>
  const result: Record<string, unknown> = query.select ? {} : { ...row }
  for (const [key, selection] of Object.entries(
    query.select ?? query.include ?? {},
  )) {
    if (!selection) continue
    result[key] = selection === true ? row[key] : project(row[key], selection)
  }
  return result
}

async function execute(fields: string, value: unknown = dub) {
  const getDubById = vi.fn(async ({ query }: { query: Selection }) =>
    project(value, query),
  )
  const result = await graphql({
    schema,
    source: `{ videoDub(id: "dub") { ${fields} } }`,
    contextValue: {
      user: null,
      services: { video: { getDubById } },
    },
  })
  expect(result.errors).toBeUndefined()
  expect(getDubById).toHaveBeenCalledOnce()
  return { result: result.data, query: getDubById.mock.calls[0]![0].query }
}

describe("subtitle and language scalar projections", () => {
  it("preserves null optional language metadata and a missing subtitle language", async () => {
    const { result } = await execute(
      `language { audioPreviewSize } videoEdition { subtitles { language { slug } } }`,
      {
        ...dub,
        language: { ...language, audioPreviewSize: null },
        videoEdition: {
          id: "edition",
          subtitles: [{ ...subtitle, language: null }],
        },
      },
    )
    expect(result).toEqual({
      videoDub: {
        language: { audioPreviewSize: null },
        videoEdition: { subtitles: [{ language: null }] },
      },
    })
  })

  it("hydrates the complete requested subtitle list without unused metadata", async () => {
    const { result, query } = await execute(`
      videoEdition { subtitles { vttSrc primary language { bcp47 slug } } }
    `)
    expect(result).toEqual({
      videoDub: {
        videoEdition: {
          subtitles: [
            {
              vttSrc: "subtitle.vtt",
              primary: true,
              language: { bcp47: "en", slug: "english" },
            },
          ],
        },
      },
    })
    const hydrated = project(dub, query) as typeof dub
    expect(Object.keys(hydrated.videoEdition.subtitles[0]!).sort()).toEqual([
      "id",
      "language",
      "primary",
      "vttSrc",
    ])
    expect(
      Object.keys(hydrated.videoEdition.subtitles[0]!.language).sort(),
    ).toEqual(["bcp47", "id", "slug"])
  })

  it("still loads every requested language metadata field, including BigInt and dates", async () => {
    const { result } = await execute(`
      language {
        id coreId name bcp47 iso3 slug audioPreviewValue audioPreviewDuration
        audioPreviewSize audioPreviewBitrate audioPreviewCodec createdAt updatedAt
      }
      videoEdition { subtitles { id value primary vttSrc srtSrc aiGenerated } }
    `)
    expect(result).toEqual({
      videoDub: {
        language: {
          ...language,
          audioPreviewSize: "9007199254740993",
          createdAt: language.createdAt.toISOString(),
          updatedAt: language.updatedAt.toISOString(),
        },
        videoEdition: {
          subtitles: [
            {
              id: "subtitle",
              value: "subtitle-value",
              primary: true,
              vttSrc: "subtitle.vtt",
              srtSrc: "subtitle.srt",
              aiGenerated: false,
            },
          ],
        },
      },
    })
  })
})
