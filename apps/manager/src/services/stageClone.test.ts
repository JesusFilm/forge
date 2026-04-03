import { describe, expect, it, vi } from "vitest"
import {
  resolveStageCloneCandidate,
  createStageCloneForJob,
} from "@/services/stageClone"
import {
  hasDownloadableMp4,
  isDownloadableMp4Url,
  isTrustedStageCloneSourceUrl,
  redactSourceUrlForMetadata,
} from "@/lib/video-sources"

describe("stageClone", () => {
  it("recognizes downloadable mp4 urls", () => {
    expect(
      isDownloadableMp4Url("https://stream.mux.com/example/720p.mp4"),
    ).toBe(true)
    expect(isDownloadableMp4Url("https://stream.mux.com/example.m3u8")).toBe(
      false,
    )
    expect(isDownloadableMp4Url("notaurl")).toBe(false)
  })

  it("requires trusted https hosts for stage clone sources", () => {
    expect(
      isTrustedStageCloneSourceUrl("https://stream.mux.com/example/720p.mp4"),
    ).toBe(true)
    expect(
      isTrustedStageCloneSourceUrl(
        "https://api-media-core.jesusfilm.org/path/video.mp4",
      ),
    ).toBe(true)
    expect(
      isTrustedStageCloneSourceUrl("http://stream.mux.com/example/720p.mp4"),
    ).toBe(false)
    expect(
      isTrustedStageCloneSourceUrl("https://evil.example.com/video.mp4"),
    ).toBe(false)
  })

  it("detects when a snapshot video has a trusted downloadable mp4", () => {
    expect(
      hasDownloadableMp4([
        {
          downloads: [{ url: "https://stream.mux.com/example/video.mp4" }],
        },
      ]),
    ).toBe(true)

    expect(
      hasDownloadableMp4([
        {
          downloads: [{ url: "https://evil.example.com/video.mp4" }],
        },
      ]),
    ).toBe(false)
  })

  it("redacts query-bearing source urls for metadata persistence", () => {
    expect(
      redactSourceUrlForMetadata(
        "https://stream.mux.com/play-ru/720p.mp4?token=secret",
      ),
    ).toEqual({
      sourceInputOrigin: "https://stream.mux.com",
      sourceInputPathname: "/play-ru/720p.mp4",
    })
  })

  it("prefers a matching source language and a mux static rendition", () => {
    const candidate = resolveStageCloneCandidate(
      {
        coreId: "video-1",
        variants: [
          {
            language: { coreId: "en" },
            muxVideo: { assetId: "mux-en", playbackId: "play-en" },
            downloads: [
              { url: "https://api-media-core.jesusfilm.org/fallback.mp4" },
            ],
          },
          {
            language: { coreId: "ru" },
            muxVideo: { assetId: "mux-ru", playbackId: "play-ru" },
            downloads: [
              { url: "https://stream.mux.com/play-ru/270p.mp4" },
              { url: "https://stream.mux.com/play-ru/720p.mp4" },
            ],
          },
        ],
      },
      "ru",
    )

    expect(candidate).toEqual({
      sourceVideoCoreId: "video-1",
      sourceMuxAssetId: "mux-ru",
      sourceMuxPlaybackId: "play-ru",
      sourceInputType: "download_mp4",
      sourceInputUrl: "https://stream.mux.com/play-ru/720p.mp4",
    })
  })

  it("can resolve a trusted download-only snapshot variant", () => {
    expect(
      resolveStageCloneCandidate({
        coreId: "video-1",
        variants: [
          {
            downloads: [
              { url: "https://api-media-core.jesusfilm.org/video.mp4" },
            ],
          },
        ],
      }),
    ).toEqual({
      sourceVideoCoreId: "video-1",
      sourceInputType: "download_mp4",
      sourceInputUrl: "https://api-media-core.jesusfilm.org/video.mp4",
      sourceMuxAssetId: undefined,
      sourceMuxPlaybackId: undefined,
    })
  })

  it("returns unsupported when there is no trusted materializable source", async () => {
    await expect(
      createStageCloneForJob({
        coreId: "video-1",
        variants: [
          {
            muxVideo: { assetId: "mux-1", playbackId: "play-1" },
            downloads: [{ url: "https://evil.example.com/play-1.mp4" }],
          },
        ],
      }),
    ).resolves.toEqual({
      status: "unsupported",
      sourceVideoCoreId: "video-1",
      sourceMuxAssetId: "mux-1",
      reason: "no_materializable_source_url",
    })
  })

  it("creates a stage asset even when the snapshot row has no source mux asset", async () => {
    const createAsset = vi.fn().mockResolvedValue({
      assetId: "stage-asset-1",
      playbackId: "stage-playback-1",
      status: "preparing",
      duration: null,
    })

    await expect(
      createStageCloneForJob(
        {
          coreId: "video-1",
          variants: [
            {
              language: { coreId: "en" },
              downloads: [
                { url: "https://api-media-core.jesusfilm.org/video.mp4" },
              ],
            },
          ],
        },
        {
          preferredSourceLanguageId: "en",
          muxSubtitleLanguageCode: "en",
        },
        { createAsset },
      ),
    ).resolves.toEqual({
      status: "ready",
      sourceVideoCoreId: "video-1",
      sourceInputType: "download_mp4",
      sourceInputUrl: "https://api-media-core.jesusfilm.org/video.mp4",
      sourceMuxAssetId: undefined,
      sourceMuxPlaybackId: undefined,
      stageMuxAssetId: "stage-asset-1",
      stageMuxPlaybackId: "stage-playback-1",
    })
  })

  it("creates a fresh stage asset for the current job", async () => {
    const createAsset = vi.fn().mockResolvedValue({
      assetId: "stage-asset-1",
      playbackId: "stage-playback-1",
      status: "preparing",
      duration: null,
    })

    const result = await createStageCloneForJob(
      {
        coreId: "video-1",
        variants: [
          {
            language: { coreId: "ru" },
            muxVideo: { assetId: "mux-ru", playbackId: "play-ru" },
            downloads: [{ url: "https://stream.mux.com/play-ru/720p.mp4" }],
          },
        ],
      },
      {
        preferredSourceLanguageId: "ru",
        muxSubtitleLanguageCode: "ru",
      },
      { createAsset },
    )

    expect(createAsset).toHaveBeenCalledWith({
      inputUrl: "https://stream.mux.com/play-ru/720p.mp4",
      passthrough: "snapshot-stage-clone:video-1",
      generateSubtitles: true,
      subtitleLanguageCode: "ru",
    })
    expect(result).toEqual({
      status: "ready",
      sourceVideoCoreId: "video-1",
      sourceMuxAssetId: "mux-ru",
      sourceMuxPlaybackId: "play-ru",
      sourceInputType: "download_mp4",
      sourceInputUrl: "https://stream.mux.com/play-ru/720p.mp4",
      stageMuxAssetId: "stage-asset-1",
      stageMuxPlaybackId: "stage-playback-1",
    })
  })

  it("surfaces stage clone creation failures without throwing", async () => {
    const createAsset = vi
      .fn()
      .mockRejectedValue(new Error("Mux create failed"))

    await expect(
      createStageCloneForJob(
        {
          coreId: "video-1",
          variants: [
            {
              muxVideo: { assetId: "mux-1", playbackId: "play-1" },
              downloads: [
                { url: "https://api-media-core.jesusfilm.org/video.mp4" },
              ],
            },
          ],
        },
        {
          preferredSourceLanguageId: "en",
          muxSubtitleLanguageCode: "en",
        },
        { createAsset },
      ),
    ).resolves.toEqual({
      status: "errored",
      sourceVideoCoreId: "video-1",
      sourceMuxAssetId: "mux-1",
      message: "Mux create failed",
    })
  })

  it("keeps cms language id variant selection independent from auto mux fallback", async () => {
    const createAsset = vi.fn().mockResolvedValue({
      assetId: "stage-asset-1",
      playbackId: "stage-playback-1",
      status: "preparing",
      duration: null,
    })

    await expect(
      createStageCloneForJob(
        {
          coreId: "video-1",
          variants: [
            {
              language: { coreId: "529" },
              muxVideo: { assetId: "mux-en", playbackId: "play-en" },
              downloads: [{ url: "https://stream.mux.com/play-en/720p.mp4" }],
            },
            {
              language: { coreId: "3934" },
              muxVideo: { assetId: "mux-ru", playbackId: "play-ru" },
              downloads: [{ url: "https://stream.mux.com/play-ru/720p.mp4" }],
            },
          ],
        },
        {
          preferredSourceLanguageId: "3934",
          muxSubtitleLanguageCode: "auto",
        },
        { createAsset },
      ),
    ).resolves.toEqual({
      status: "ready",
      sourceVideoCoreId: "video-1",
      sourceMuxAssetId: "mux-ru",
      sourceMuxPlaybackId: "play-ru",
      sourceInputType: "download_mp4",
      sourceInputUrl: "https://stream.mux.com/play-ru/720p.mp4",
      stageMuxAssetId: "stage-asset-1",
      stageMuxPlaybackId: "stage-playback-1",
    })

    expect(createAsset).toHaveBeenCalledWith({
      inputUrl: "https://stream.mux.com/play-ru/720p.mp4",
      passthrough: "snapshot-stage-clone:video-1",
      generateSubtitles: true,
      subtitleLanguageCode: "auto",
    })
  })
})
