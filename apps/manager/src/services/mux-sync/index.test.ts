import { describe, expect, it, vi } from "vitest"
import {
  applySubtitleOverride,
  syncTranslatedSubtitlesToMux,
} from "@/services/mux-sync"
import type { MuxSyncReport } from "@/types/job"

describe("syncTranslatedSubtitlesToMux", () => {
  it("creates a synced report entry when Mux is missing the target subtitle track", async () => {
    const createTrack = vi.fn().mockResolvedValue({ id: "track-new" })

    const report = await syncTranslatedSubtitlesToMux(
      {
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        translationResults: [{ lang: "fr", status: "completed" }],
      },
      {
        retrieveAsset: vi.fn().mockResolvedValue({ tracks: [] }),
        createTrack,
        readArtifactText: vi
          .fn()
          .mockResolvedValue(
            "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nBonjour tout le monde",
          ),
        buildArtifactUrl: vi
          .fn()
          .mockReturnValue(
            "https://manager.example/api/jobs/job-1/artifacts/subtitles-fr",
          ),
        now: () => "2026-04-10T12:00:00.000Z",
      },
    )

    expect(createTrack).toHaveBeenCalledWith("mux-1", {
      languageCode: "fr",
      url: "https://manager.example/api/jobs/job-1/artifacts/subtitles-fr",
      name: "FR subtitles",
    })
    expect(report).toEqual({
      comparisons: [
        expect.objectContaining({
          artifactKey: "subtitles-fr",
          targetLanguage: "fr",
          status: "synced",
          muxTrackId: "track-new",
          generatedPreview: "Bonjour tout le monde",
        }),
      ],
      overrideHistory: [],
      updatedAt: "2026-04-10T12:00:00.000Z",
    })
  })

  it("skips syncing and includes generated-vs-mux previews when a language already exists", async () => {
    const report = await syncTranslatedSubtitlesToMux(
      {
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        translationResults: [{ lang: "es", status: "completed" }],
      },
      {
        retrieveAsset: vi.fn().mockResolvedValue({
          tracks: [
            {
              id: "track-es",
              type: "text",
              text_type: "subtitles",
              language_code: "es",
              status: "ready",
              url: "https://stream.mux.com/text-es.vtt",
            },
          ],
        }),
        createTrack: vi.fn(),
        readArtifactText: vi
          .fn()
          .mockResolvedValue(
            "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHola desde Forge",
          ),
        readTrackText: vi
          .fn()
          .mockResolvedValue(
            "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHola desde Mux",
          ),
        now: () => "2026-04-10T12:00:00.000Z",
      },
    )

    expect(report.comparisons).toEqual([
      expect.objectContaining({
        artifactKey: "subtitles-es",
        targetLanguage: "es",
        status: "skipped_existing_mux_data",
        muxTrackId: "track-es",
        canOverride: true,
        generatedPreview: "Hola desde Forge",
        muxPreview: "Hola desde Mux",
      }),
    ])
  })

  it("reports skipped_missing_generated_data when translation output is unavailable", async () => {
    const report = await syncTranslatedSubtitlesToMux(
      {
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        translationResults: [
          { lang: "de", status: "failed", error: "translator failed" },
        ],
      },
      {
        retrieveAsset: vi.fn().mockResolvedValue({ tracks: [] }),
        now: () => "2026-04-10T12:00:00.000Z",
      },
    )

    expect(report.comparisons).toEqual([
      expect.objectContaining({
        artifactKey: "subtitles-de",
        status: "skipped_missing_generated_data",
        explanation:
          "Generated subtitle artifact is unavailable: translator failed",
      }),
    ])
  })
})

describe("applySubtitleOverride", () => {
  it("replaces an existing subtitle track and appends an audit entry", async () => {
    const previousReport: MuxSyncReport = {
      comparisons: [
        {
          artifactKey: "subtitles-it",
          targetLanguage: "it",
          muxTargetType: "text_track",
          muxTargetKey: "it",
          status: "skipped_existing_mux_data",
          explanation: "Mux already has it subtitles",
          muxTrackId: "track-old",
          canOverride: true,
          updatedAt: "2026-04-10T11:00:00.000Z",
        },
      ],
      overrideHistory: [],
      updatedAt: "2026-04-10T11:00:00.000Z",
    }

    const deleteTrack = vi.fn().mockResolvedValue(undefined)
    const updateTrack = vi.fn().mockResolvedValue(undefined)
    const createTrack = vi.fn().mockResolvedValue({ id: "track-new" })

    const report = await applySubtitleOverride(
      {
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        artifactKey: "subtitles-it",
        targetLanguage: "it",
        previousReport,
      },
      {
        retrieveAsset: vi.fn().mockResolvedValue({
          tracks: [
            {
              id: "track-old",
              type: "text",
              text_type: "subtitles",
              language_code: "it",
              status: "ready",
              url: "https://stream.mux.com/text-it.vtt",
            },
          ],
        }),
        deleteTrack,
        updateTrack,
        createTrack,
        readArtifactText: vi
          .fn()
          .mockResolvedValue(
            "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nCiao da Forge",
          ),
        readTrackText: vi
          .fn()
          .mockResolvedValue(
            "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nCiao da Mux",
          ),
        buildArtifactUrl: vi
          .fn()
          .mockReturnValue(
            "https://manager.example/api/jobs/job-1/artifacts/subtitles-it",
          ),
        now: () => "2026-04-10T12:30:00.000Z",
      },
    )

    expect(createTrack).toHaveBeenCalledWith("mux-1", {
      languageCode: "it",
      url: "https://manager.example/api/jobs/job-1/artifacts/subtitles-it",
      name: "IT subtitles (override job-1)",
    })
    expect(deleteTrack).toHaveBeenCalledWith("mux-1", "track-old")
    expect(updateTrack).toHaveBeenCalledWith("mux-1", "track-new", {
      languageCode: "it",
      name: "IT subtitles",
    })
    expect(createTrack.mock.invocationCallOrder[0]).toBeLessThan(
      deleteTrack.mock.invocationCallOrder[0],
    )
    expect(report.comparisons).toEqual([
      expect.objectContaining({
        artifactKey: "subtitles-it",
        status: "override_applied",
        muxTrackId: "track-new",
        generatedPreview: "Ciao da Forge",
        muxPreview: "Ciao da Mux",
      }),
    ])
    expect(report.overrideHistory).toEqual([
      {
        artifactKey: "subtitles-it",
        targetLanguage: "it",
        at: "2026-04-10T12:30:00.000Z",
        action: "override_subtitle_track",
      },
    ])
  })

  it("does not delete the original subtitle when replacement creation fails", async () => {
    const deleteTrack = vi.fn().mockResolvedValue(undefined)

    await expect(
      applySubtitleOverride(
        {
          jobId: "job-1",
          assetId: "asset-1",
          muxAssetId: "mux-1",
          artifactKey: "subtitles-it",
          targetLanguage: "it",
          previousReport: {
            comparisons: [
              {
                artifactKey: "subtitles-it",
                targetLanguage: "it",
                muxTargetType: "text_track",
                muxTargetKey: "it",
                status: "override_pending",
                explanation: "Override requested for it subtitles.",
                muxTrackId: "track-old",
                canOverride: false,
                updatedAt: "2026-04-10T12:00:00.000Z",
              },
            ],
            overrideHistory: [],
            updatedAt: "2026-04-10T12:00:00.000Z",
          },
        },
        {
          retrieveAsset: vi.fn().mockResolvedValue({
            tracks: [
              {
                id: "track-old",
                type: "text",
                text_type: "subtitles",
                language_code: "it",
                status: "ready",
                url: "https://stream.mux.com/text-it.vtt",
              },
            ],
          }),
          createTrack: vi
            .fn()
            .mockRejectedValue(new Error("Mux create failed")),
          deleteTrack,
          buildArtifactUrl: vi
            .fn()
            .mockReturnValue(
              "https://manager.example/api/jobs/job-1/artifacts/subtitles-it",
            ),
          readArtifactText: vi
            .fn()
            .mockResolvedValue(
              "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nCiao da Forge",
            ),
        },
      ),
    ).rejects.toThrow("Mux create failed")

    expect(deleteTrack).not.toHaveBeenCalled()
  })

  it("resumes an interrupted override by finishing the pending replacement", async () => {
    const deleteTrack = vi.fn().mockResolvedValue(undefined)
    const updateTrack = vi.fn().mockResolvedValue(undefined)

    const report = await applySubtitleOverride(
      {
        jobId: "job-1",
        assetId: "asset-1",
        muxAssetId: "mux-1",
        artifactKey: "subtitles-it",
        targetLanguage: "it",
        previousReport: {
          comparisons: [
            {
              artifactKey: "subtitles-it",
              targetLanguage: "it",
              muxTargetType: "text_track",
              muxTargetKey: "it",
              status: "override_pending",
              explanation: "Override requested for it subtitles.",
              muxTrackId: "track-old",
              muxPreview: "Ciao da Mux",
              canOverride: false,
              updatedAt: "2026-04-10T12:00:00.000Z",
            },
          ],
          overrideHistory: [],
          updatedAt: "2026-04-10T12:00:00.000Z",
        },
      },
      {
        retrieveAsset: vi.fn().mockResolvedValue({
          tracks: [
            {
              id: "track-temp",
              type: "text",
              text_type: "subtitles",
              language_code: "it",
              status: "ready",
              name: "IT subtitles (override job-1)",
              url: "https://stream.mux.com/text-it-new.vtt",
            },
          ],
        }),
        createTrack: vi.fn(),
        deleteTrack,
        updateTrack,
        buildArtifactUrl: vi
          .fn()
          .mockReturnValue(
            "https://manager.example/api/jobs/job-1/artifacts/subtitles-it",
          ),
        readArtifactText: vi
          .fn()
          .mockResolvedValue(
            "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nCiao da Forge",
          ),
        now: () => "2026-04-10T12:30:00.000Z",
      },
    )

    expect(deleteTrack).not.toHaveBeenCalled()
    expect(updateTrack).toHaveBeenCalledWith("mux-1", "track-temp", {
      languageCode: "it",
      name: "IT subtitles",
    })
    expect(report.comparisons).toEqual([
      expect.objectContaining({
        artifactKey: "subtitles-it",
        status: "override_applied",
        muxTrackId: "track-temp",
      }),
    ])
  })
})
