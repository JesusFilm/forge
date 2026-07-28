import { describe, expect, it } from "vitest"

import {
  buildCollectionDownloadOptions,
  buildCollectionDownloadOptionsFromDescendants,
  buildCollectionDownloadQueue,
} from "./collection-download-options"

const episodes = [
  { documentId: "v1", slug: "one", title: "One" },
  { documentId: "v2", slug: "two", title: "Two" },
  { documentId: "v3", slug: "three", title: "Three" },
]

function buildQueueForTitles(titles: string[]) {
  const options = buildCollectionDownloadOptions(
    titles.map((title, index) => ({
      documentId: `v${index + 1}`,
      slug: `episode-${index + 1}`,
      title,
    })),
    titles.map((_, index) => ({
      documentId: `dub-${index + 1}`,
      videoId: `v${index + 1}`,
      downloads: [
        {
          documentId: `download-${index + 1}`,
          height: 720,
          quality: "high" as const,
          size: 100,
        },
      ],
    })),
  )

  return buildCollectionDownloadQueue({
    candidates: options.candidates,
    tier: "highest",
    languageCode: "eng",
    languageName: "English",
    languageSlug: "english",
  })
}

describe("collection download options", () => {
  it("returns an empty quality list when no episodes are downloadable", () => {
    expect(buildCollectionDownloadOptions(episodes, [])).toEqual({
      candidates: [],
      skipped: episodes,
      commonTiers: [],
    })
  })

  it("keeps episode order, reports skipped children, and intersects tiers", () => {
    const result = buildCollectionDownloadOptions(episodes, [
      {
        documentId: "dub-2",
        videoId: "v2",
        downloads: [
          { documentId: "d2h", height: 1080, quality: "high", size: 200 },
          { documentId: "d2l", height: 360, quality: "low", size: 20 },
        ],
      },
      {
        documentId: "dub-1",
        videoId: "v1",
        downloads: [
          { documentId: "d1h", height: 1080, quality: "high", size: 200 },
          { documentId: "d1m", height: 720, quality: "sd", size: 100 },
          { documentId: "d1l", height: 360, quality: "low", size: 20 },
        ],
      },
    ])

    expect(result.candidates.map((item) => item.documentId)).toEqual([
      "v1",
      "v2",
    ])
    expect(result.skipped.map((item) => item.documentId)).toEqual(["v3"])
    expect(result.commonTiers).toEqual(["highest", "low"])
  })

  it("uses recursive leaf order and preserves explicitly skipped leaves", () => {
    const result = buildCollectionDownloadOptionsFromDescendants(
      [
        {
          documentId: "leaf-2",
          slug: "second",
          title: "Second",
          thumbnailUrl: null,
          ordinal: 2,
          variantId: "dub-2",
          downloads: [
            { documentId: "download-2", height: 720, quality: "high", size: 2 },
          ],
        },
        {
          documentId: "leaf-1",
          slug: "first",
          title: "First",
          thumbnailUrl: null,
          ordinal: 1,
          variantId: "dub-1",
          downloads: [
            { documentId: "download-1", height: 720, quality: "high", size: 1 },
          ],
        },
      ],
      [
        {
          documentId: "leaf-3",
          slug: "third",
          title: "Third",
          thumbnailUrl: null,
        },
      ],
    )

    expect(result.candidates.map((candidate) => candidate.documentId)).toEqual([
      "leaf-1",
      "leaf-2",
    ])
    expect(result.skipped.map((leaf) => leaf.documentId)).toEqual(["leaf-3"])
  })

  it("builds compatible opaque proxy queue items", () => {
    const options = buildCollectionDownloadOptions(episodes.slice(0, 1), [
      {
        documentId: "dub-1",
        videoId: "v1",
        downloads: [
          { documentId: "download-1", height: 720, quality: "high", size: 100 },
        ],
      },
    ])
    const [item] = buildCollectionDownloadQueue({
      candidates: options.candidates,
      tier: "highest",
      languageCode: "eng",
      languageName: "English",
      languageSlug: "english",
    })

    expect(item.filename).toBe("One_English_eng_720p.mp4")
    expect(item.url).toContain("/watch/api/download?")
    expect(item.url).toContain("downloadId=download-1")
    expect(item.url).not.toContain("stream.mux.com")
  })

  it("gives episodes with duplicate normalized titles unique filenames", () => {
    const queue = buildQueueForTitles(["Same title", "Same-title"])

    expect(queue.map(({ filename }) => filename)).toEqual([
      "Same-title_English_eng_720p.mp4",
      "Same-title_English_eng_720p_2.mp4",
    ])
    for (const item of queue) {
      expect(
        new URL(item.url, "https://watch.example").searchParams.get("filename"),
      ).toBe(item.filename)
    }
  })

  it("keeps truncation-collision filenames unique and within 200 characters", () => {
    const queue = buildQueueForTitles(["A".repeat(250), `${"A".repeat(249)}B`])
    const filenames = queue.map(({ filename }) => filename)

    expect(new Set(filenames).size).toBe(2)
    expect(filenames.every((filename) => filename.length <= 200)).toBe(true)
    expect(filenames[1]).toMatch(/_2\.mp4$/)
    expect(
      new URL(queue[1].url, "https://watch.example").searchParams.get(
        "filename",
      ),
    ).toBe(filenames[1])
  })
})
