import { describe, expect, it } from "vitest"

import { buildCandidateRetrieval } from "./candidate-retrieval"
import type { SourceCatalog, Video } from "./source-generation"

function video(
  id: string,
  coreId: string,
  title: string,
  parentVideoIds: string[] = [],
): Video {
  return {
    id,
    coreId,
    slug: id,
    locale: "en",
    title,
    description: "",
    descriptionTruncated: false,
    keywords: [],
    keywordsTruncated: false,
    bibleCitations: [],
    bibleCitationsTruncated: false,
    parentVideoIds,
    childVideoIds: [],
    transcriptLanguages: [],
  }
}

const catalog = {
  async video() {
    throw new Error("unused")
  },
  async catalog() {
    throw new Error("unused")
  },
  async chunks() {
    return { chunks: [], nextCursor: null }
  },
} satisfies SourceCatalog

describe("canonical candidate retrieval identity", () => {
  it("excludes source copies while retaining a distinct-titled related chapter", async () => {
    const videos = [
      video("source", "MAG1", "Magdalena"),
      video("same-title", "other-film", "Magdalena"),
      video("prefix-copy", "MAG1AD1x1", "Another cut"),
      video("chapter", "MAG15518", "A distinct chapter", ["source"]),
      video("unrelated", "different", "A different story"),
    ]
    const result = await buildCandidateRetrieval(
      catalog,
      videos,
      "2026-10-06T00:00:00.000Z",
    )
    expect(result.candidateIdsBySource.get("source")).toEqual(
      expect.arrayContaining(["chapter", "unrelated"]),
    )
    expect(result.candidateIdsBySource.get("source")).toHaveLength(2)
  })

  it("keeps related film/chapter targets and one canonical same-title target", async () => {
    const videos = [
      video("source", "source-core", "A source"),
      video("film", "film-core", "The film"),
      video("chapter", "film-core5518", "A chapter", ["film"]),
      video("a-format-copy", "film-coreAD1x1", "A format cut"),
      video("same-title-a", "first-core", "A shared title"),
      video("same-title-b", "second-core", "A shared title"),
    ]
    const result = await buildCandidateRetrieval(
      catalog,
      videos,
      "2026-10-06T00:00:00.000Z",
    )
    const pool = result.candidateIdsBySource.get("source")!
    expect(pool).toContain("film")
    expect(pool).toContain("chapter")
    expect(pool).not.toContain("a-format-copy")
    expect(pool.filter((id) => id.startsWith("same-title-"))).toEqual([
      "same-title-a",
    ])
  })

  it("prefers a source relation over a higher-ranked same-title copy", async () => {
    const videos = [
      video("source", "source-core", "Source story"),
      {
        ...video("a-lexical", "lexical-core", "Shared title"),
        description: "Source story Source story",
      },
      video("z-related", "related-core", "Shared title", ["source"]),
    ]
    const result = await buildCandidateRetrieval(
      catalog,
      videos,
      "2026-10-06T00:00:00.000Z",
    )
    expect(result.candidateIdsBySource.get("source")).toEqual(["z-related"])
  })
})
