import { describe, expect, it, vi } from "vitest"
import {
  createStageCloneForJob,
  materializeEnrichmentTargetForJob,
  resolveEnrichmentSource,
  resolveStageCloneCandidate,
} from "@/services/stageClone"
import { buildMuxSourceLanguagePriority } from "@/lib/mux-language"
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
      sourceInputHost: "stream.mux.com",
    })
  })

  it("prefers the requested supported language and best rendition", () => {
    const candidate = resolveStageCloneCandidate(
      {
        coreId: "video-1",
        variants: [
          {
            language: { coreId: "529", bcp47: "en", iso3: "eng" },
            muxVideo: { assetId: "mux-en", playbackId: "play-en" },
            downloads: [
              { url: "https://api-media-core.jesusfilm.org/fallback.mp4" },
            ],
          },
          {
            language: { coreId: "3934", bcp47: "ru", iso3: "rus" },
            muxVideo: { assetId: "mux-ru", playbackId: "play-ru" },
            downloads: [
              { url: "https://stream.mux.com/play-ru/270p.mp4" },
              { url: "https://stream.mux.com/play-ru/720p.mp4" },
            ],
          },
        ],
      },
      {
        sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("ru"),
        requestedTargetLanguageCode: "ru",
      },
    )

    expect(candidate).toEqual({
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "3934", bcp47: "ru", iso3: "rus" },
      sourceLanguageCode: "ru",
      sourceMuxAssetId: "mux-ru",
      sourceMuxPlaybackId: "play-ru",
      sourceInputType: "download_mp4",
      sourceInputUrl: "https://stream.mux.com/play-ru/720p.mp4",
      sourceSelectionReason: "requested",
      sourceSelectionAttemptedCodes: buildMuxSourceLanguagePriority("ru"),
    })
  })

  it("falls back to english when the requested language is not mux-supported", () => {
    const candidate = resolveStageCloneCandidate(
      {
        coreId: "video-1",
        variants: [
          {
            language: { coreId: "fil", bcp47: "fil", iso3: "fil" },
            downloads: [
              { url: "https://api-media-core.jesusfilm.org/fil.mp4" },
            ],
          },
          {
            language: { coreId: "529", bcp47: "en", iso3: "eng" },
            downloads: [
              { url: "https://api-media-core.jesusfilm.org/video.mp4" },
            ],
          },
        ],
      },
      {
        sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("fil"),
        requestedTargetLanguageCode: "fil",
      },
    )

    expect(candidate).toEqual({
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      sourceLanguageCode: "en",
      sourceInputType: "download_mp4",
      sourceInputUrl: "https://api-media-core.jesusfilm.org/video.mp4",
      sourceMuxAssetId: undefined,
      sourceMuxPlaybackId: undefined,
      sourceSelectionReason: "fallback-en",
      sourceSelectionAttemptedCodes: buildMuxSourceLanguagePriority("fil"),
    })
  })

  it("falls back from english to spanish and then french", () => {
    const candidate = resolveStageCloneCandidate(
      {
        coreId: "video-1",
        variants: [
          {
            language: { coreId: "4507", bcp47: "es", iso3: "spa" },
            downloads: [{ url: "https://stream.mux.com/es/720p.mp4" }],
          },
          {
            language: { coreId: "496", bcp47: "fr", iso3: "fra" },
            downloads: [{ url: "https://stream.mux.com/fr/720p.mp4" }],
          },
        ],
      },
      {
        sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("pl"),
        requestedTargetLanguageCode: "pl",
      },
    )

    expect(candidate?.sourceLanguageCode).toBe("es")
    expect(candidate?.sourceSelectionReason).toBe("fallback-es")
  })

  it("falls back to another mux-supported language after en/es/fr are absent", () => {
    const candidate = resolveStageCloneCandidate(
      {
        coreId: "video-1",
        variants: [
          {
            language: { coreId: "3934", bcp47: "ru", iso3: "rus" },
            downloads: [{ url: "https://stream.mux.com/ru/720p.mp4" }],
          },
          {
            language: { coreId: "6464", bcp47: "hi", iso3: "hin" },
            downloads: [{ url: "https://stream.mux.com/hi/720p.mp4" }],
          },
        ],
      },
      {
        sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("fil"),
        requestedTargetLanguageCode: "fil",
      },
    )

    expect(candidate?.sourceLanguageCode).toBe("ru")
    expect(candidate?.sourceSelectionReason).toBe("fallback-supported")
  })

  it("resolves a direct-reuse source from the existing mux asset without requiring downloads", () => {
    const candidate = resolveEnrichmentSource(
      {
        coreId: "video-1",
        variants: [
          {
            language: { coreId: "3934", bcp47: "ru", iso3: "rus" },
            muxVideo: { assetId: "mux-ru", playbackId: "play-ru" },
          },
        ],
      },
      {
        materializationTarget: "direct",
        sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("ru"),
        requestedTargetLanguageCode: "ru",
      },
    )

    expect(candidate).toEqual({
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "3934", bcp47: "ru", iso3: "rus" },
      sourceLanguageCode: "ru",
      sourceMuxAssetId: "mux-ru",
      sourceMuxPlaybackId: "play-ru",
      sourceInputType: "mux_asset",
      sourceSelectionReason: "requested",
      sourceSelectionAttemptedCodes: buildMuxSourceLanguagePriority("ru"),
    })
  })

  it("returns unsupported when there is no mux-supported materializable source", async () => {
    await expect(
      createStageCloneForJob({
        coreId: "video-1",
        variants: [
          {
            language: { coreId: "6464", bcp47: "hi", iso3: "hin" },
            muxVideo: { assetId: "mux-1", playbackId: "play-1" },
            downloads: [{ url: "https://stream.mux.com/play-1.mp4" }],
          },
        ],
      }),
    ).resolves.toEqual({
      status: "unsupported",
      sourceVideoCoreId: "video-1",
      sourceMuxAssetId: "mux-1",
      reason: "no_mux_supported_downloadable_source",
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
              language: { coreId: "529", bcp47: "en", iso3: "eng" },
              downloads: [
                { url: "https://api-media-core.jesusfilm.org/video.mp4" },
              ],
            },
          ],
        },
        {
          sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("en"),
          requestedTargetLanguageCode: "en",
        },
        { createAsset },
      ),
    ).resolves.toEqual({
      status: "ready",
      materializationMode: "snapshot_to_stage_clone",
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      sourceLanguageCode: "en",
      sourceInputType: "download_mp4",
      sourceInputUrl: "https://api-media-core.jesusfilm.org/video.mp4",
      sourceMuxAssetId: undefined,
      sourceMuxPlaybackId: undefined,
      sourceSelectionReason: "requested",
      sourceSelectionAttemptedCodes: buildMuxSourceLanguagePriority("en"),
      targetMuxAssetId: "stage-asset-1",
      targetMuxPlaybackId: "stage-playback-1",
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
            language: { coreId: "3934", bcp47: "ru", iso3: "rus" },
            muxVideo: { assetId: "mux-ru", playbackId: "play-ru" },
            downloads: [{ url: "https://stream.mux.com/play-ru/720p.mp4" }],
          },
        ],
      },
      {
        sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("ru"),
        requestedTargetLanguageCode: "ru",
      },
      { createAsset },
    )

    expect(createAsset).toHaveBeenCalledWith({
      inputUrl: "https://stream.mux.com/play-ru/720p.mp4",
      passthrough: "snapshot-stage-clone:video-1",
    })
    expect(result).toEqual({
      status: "ready",
      materializationMode: "snapshot_to_stage_clone",
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "3934", bcp47: "ru", iso3: "rus" },
      sourceLanguageCode: "ru",
      sourceMuxAssetId: "mux-ru",
      sourceMuxPlaybackId: "play-ru",
      sourceInputType: "download_mp4",
      sourceInputUrl: "https://stream.mux.com/play-ru/720p.mp4",
      sourceSelectionReason: "requested",
      sourceSelectionAttemptedCodes: buildMuxSourceLanguagePriority("ru"),
      targetMuxAssetId: "stage-asset-1",
      targetMuxPlaybackId: "stage-playback-1",
    })
  })

  it("reuses the existing mux asset directly and preserves a static MP4 source when clone mode is disabled", async () => {
    const getAsset = vi.fn().mockResolvedValue({
      assetId: "mux-ru",
      playbackId: "play-ru",
      publicPlaybackId: "play-ru",
      status: "ready",
      duration: 123,
      staticRenditions: [
        {
          name: "360p.mp4",
          status: "ready",
          width: 640,
          height: 360,
          type: "advanced",
        },
        {
          name: "480p.mp4",
          status: "ready",
          width: 854,
          height: 480,
          type: "advanced",
        },
      ],
    })

    const result = await materializeEnrichmentTargetForJob(
      {
        coreId: "video-1",
        variants: [
          {
            language: { coreId: "3934", bcp47: "ru", iso3: "rus" },
            muxVideo: { assetId: "mux-ru", playbackId: "play-ru" },
          },
        ],
      },
      {
        materializationTarget: "direct",
        sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("ru"),
        requestedTargetLanguageCode: "ru",
      },
      { getAsset },
    )

    expect(result).toEqual({
      status: "ready",
      materializationMode: "direct_mux_asset_reuse",
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "3934", bcp47: "ru", iso3: "rus" },
      sourceLanguageCode: "ru",
      sourceMuxAssetId: "mux-ru",
      sourceMuxPlaybackId: "play-ru",
      sourceInputType: "mux_asset",
      sourceInputUrl: "https://stream.mux.com/play-ru/480p.mp4",
      sourceSelectionReason: "requested",
      sourceSelectionAttemptedCodes: buildMuxSourceLanguagePriority("ru"),
      targetMuxAssetId: "mux-ru",
      targetMuxPlaybackId: "play-ru",
    })
    expect(getAsset).toHaveBeenCalledWith("mux-ru")
  })

  it("recovers a missing playback id from live mux state for direct reuse", async () => {
    const getAsset = vi.fn().mockResolvedValue({
      assetId: "mux-en",
      playbackId: "play-en",
      publicPlaybackId: "play-en",
      status: "ready",
      duration: 123,
      staticRenditions: [
        {
          name: "270p.mp4",
          status: "ready",
          width: 480,
          height: 270,
          type: "basic",
        },
      ],
    })

    await expect(
      materializeEnrichmentTargetForJob(
        {
          coreId: "video-1",
          variants: [
            {
              language: { coreId: "529", bcp47: "en", iso3: "eng" },
              muxVideo: { assetId: "mux-en" },
            },
          ],
        },
        {
          materializationTarget: "direct",
          sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("en"),
          requestedTargetLanguageCode: "en",
        },
        { getAsset },
      ),
    ).resolves.toEqual({
      status: "ready",
      materializationMode: "direct_mux_asset_reuse",
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      sourceLanguageCode: "en",
      sourceMuxAssetId: "mux-en",
      sourceMuxPlaybackId: "play-en",
      sourceInputType: "mux_asset",
      sourceInputUrl: "https://stream.mux.com/play-en/270p.mp4",
      sourceSelectionReason: "requested",
      sourceSelectionAttemptedCodes: buildMuxSourceLanguagePriority("en"),
      targetMuxAssetId: "mux-en",
      targetMuxPlaybackId: "play-en",
    })

    expect(getAsset).toHaveBeenCalledWith("mux-en")
  })

  it("keeps direct reuse available when static rendition lookup fails but playback is known", async () => {
    const getAsset = vi.fn().mockRejectedValue(new Error("Mux lookup failed"))

    await expect(
      materializeEnrichmentTargetForJob(
        {
          coreId: "video-1",
          variants: [
            {
              language: { coreId: "529", bcp47: "en", iso3: "eng" },
              muxVideo: { assetId: "mux-en", playbackId: "play-en" },
            },
          ],
        },
        {
          materializationTarget: "direct",
          sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("en"),
          requestedTargetLanguageCode: "en",
        },
        { getAsset },
      ),
    ).resolves.toEqual({
      status: "ready",
      materializationMode: "direct_mux_asset_reuse",
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      sourceLanguageCode: "en",
      sourceMuxAssetId: "mux-en",
      sourceMuxPlaybackId: "play-en",
      sourceInputType: "mux_asset",
      sourceSelectionReason: "requested",
      sourceSelectionAttemptedCodes: buildMuxSourceLanguagePriority("en"),
      targetMuxAssetId: "mux-en",
      targetMuxPlaybackId: "play-en",
    })
  })

  it("surfaces direct-mode unsupported results when no reusable mux asset exists", async () => {
    await expect(
      materializeEnrichmentTargetForJob(
        {
          coreId: "video-1",
          variants: [
            {
              language: { coreId: "529", bcp47: "en", iso3: "eng" },
            },
          ],
        },
        {
          materializationTarget: "direct",
          sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("en"),
          requestedTargetLanguageCode: "en",
        },
      ),
    ).resolves.toEqual({
      status: "unsupported",
      sourceVideoCoreId: "video-1",
      sourceMuxAssetId: undefined,
      reason: "no_variant_with_mux",
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
              language: { coreId: "529", bcp47: "en", iso3: "eng" },
              muxVideo: { assetId: "mux-1", playbackId: "play-1" },
              downloads: [
                { url: "https://api-media-core.jesusfilm.org/video.mp4" },
              ],
            },
          ],
        },
        {
          sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("en"),
          requestedTargetLanguageCode: "en",
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

  it("does not pick a non-mux-supported language even when it has the best download", async () => {
    const createAsset = vi.fn().mockResolvedValue({
      assetId: "stage-asset-en",
      playbackId: "stage-playback-en",
      status: "preparing",
      duration: null,
    })

    const result = await createStageCloneForJob(
      {
        coreId: "video-1",
        variants: [
          {
            language: { coreId: "6464", bcp47: "hi", iso3: "hin" },
            downloads: [{ url: "https://stream.mux.com/play-hi/1080p.mp4" }],
          },
          {
            language: { coreId: "529", bcp47: "en", iso3: "eng" },
            downloads: [{ url: "https://stream.mux.com/play-en/720p.mp4" }],
          },
        ],
      },
      {
        sourceLanguagePriorityCodes: buildMuxSourceLanguagePriority("hi"),
        requestedTargetLanguageCode: "hi",
      },
      { createAsset },
    )

    expect(createAsset).toHaveBeenCalledWith({
      inputUrl: "https://stream.mux.com/play-en/720p.mp4",
      passthrough: "snapshot-stage-clone:video-1",
    })

    expect(result).toEqual({
      status: "ready",
      materializationMode: "snapshot_to_stage_clone",
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      sourceLanguageCode: "en",
      sourceMuxAssetId: undefined,
      sourceMuxPlaybackId: undefined,
      sourceInputType: "download_mp4",
      sourceInputUrl: "https://stream.mux.com/play-en/720p.mp4",
      sourceSelectionReason: "fallback-en",
      sourceSelectionAttemptedCodes: buildMuxSourceLanguagePriority("hi"),
      targetMuxAssetId: "stage-asset-en",
      targetMuxPlaybackId: "stage-playback-en",
    })
  })
})
