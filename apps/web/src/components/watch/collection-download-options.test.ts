import { describe, expect, it } from "vitest"

import {
  buildCollectionDownloadOptions,
  buildCollectionDownloadQueue,
} from "./collection-download-options"

const episodes = [
  { documentId: "v1", slug: "one", title: "One" },
  { documentId: "v2", slug: "two", title: "Two" },
  { documentId: "v3", slug: "three", title: "Three" },
]

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
})
