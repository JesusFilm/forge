import {
  buildEpisodeRequest,
  type BuildRequestContext,
} from "../seriesDownloadEnqueue"
import type { SeriesEpisodeResolution } from "../seriesDownloadResolver"

// U1: seriesSlug/seriesTitle/enqueuedAt are batch-level constants;
// seriesEpisodeIndex/durationSeconds vary per episode — buildEpisodeRequest
// is the seam merging the two sources into one StartDownloadRequest.

function resolvedEpisode(
  overrides: Partial<SeriesEpisodeResolution> = {},
): SeriesEpisodeResolution {
  return {
    slug: "episode-2",
    title: "Episode 2",
    posterUrl: "poster-2",
    status: "resolved",
    dubDocumentId: "dub-2",
    rendition: {
      documentId: "rend-2",
      quality: "Highest",
      size: "1000",
      url: "https://cdn.example/e2.mp4",
    },
    resolvedTier: "Highest",
    subtitleUrl: null,
    seriesEpisodeIndex: 2,
    durationSeconds: 725,
    ...overrides,
  }
}

const ctx: BuildRequestContext = {
  subtitleLanguageSlug: null,
  allowCellular: true,
  seriesSlug: "storyclubs",
  seriesTitle: "StoryClubs",
  enqueuedAt: 1_753_000_000_000,
}

describe("buildEpisodeRequest — series/ordering metadata (U1)", () => {
  it("attaches batch-level seriesSlug/seriesTitle/enqueuedAt from ctx", () => {
    const request = buildEpisodeRequest(resolvedEpisode(), ctx)
    expect(request?.seriesSlug).toBe("storyclubs")
    expect(request?.seriesTitle).toBe("StoryClubs")
    expect(request?.enqueuedAt).toBe(1_753_000_000_000)
  })

  it("attaches per-episode seriesEpisodeIndex/durationSeconds from the resolution, not ctx", () => {
    const request = buildEpisodeRequest(
      resolvedEpisode({ seriesEpisodeIndex: 5, durationSeconds: 300 }),
      ctx,
    )
    expect(request?.seriesEpisodeIndex).toBe(5)
    expect(request?.durationSeconds).toBe(300)
  })

  it("varies per episode while seriesSlug/seriesTitle stay constant across a batch", () => {
    const a = buildEpisodeRequest(
      resolvedEpisode({
        slug: "a",
        seriesEpisodeIndex: 1,
        durationSeconds: 100,
      }),
      ctx,
    )
    const b = buildEpisodeRequest(
      resolvedEpisode({
        slug: "b",
        seriesEpisodeIndex: 2,
        durationSeconds: 200,
      }),
      ctx,
    )
    expect(a?.seriesEpisodeIndex).toBe(1)
    expect(b?.seriesEpisodeIndex).toBe(2)
    expect(a?.seriesSlug).toBe(b?.seriesSlug)
    expect(a?.seriesTitle).toBe(b?.seriesTitle)
  })

  it("returns null for a non-resolved episode without needing ctx's series fields", () => {
    expect(
      buildEpisodeRequest(
        resolvedEpisode({
          status: "skipped-no-rendition",
          rendition: undefined,
        }),
        ctx,
      ),
    ).toBeNull()
  })
})
