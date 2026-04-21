import { describe, expect, it } from "vitest"
import {
  buildReviewPlayerState,
  type JobReviewContextResult,
} from "@/features/jobs/review-player/review-player-presenter"
import type { JobRecord } from "@/types/job"

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    languages: [],
    sourceLanguageCode: "en",
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:01:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

function buildReadyContext(): JobReviewContextResult {
  return {
    status: "ready",
    context: {
      playbackUrl: "https://stream.mux.com/playback-1.m3u8",
      before: {
        subtitles: {
          status: "available",
          tracks: [
            {
              languageCode: "en",
              label: "EN",
              src: "https://stream.mux.com/playback-1/text/track-en.vtt",
              source: "mux",
              isGenerated: false,
            },
          ],
        },
        metadata: {
          status: "available",
          value: {
            title: "Live title",
            description: "Live description",
          },
        },
        chapters: {
          status: "unavailable",
          reason: "no_live_chapters",
        },
      },
      after: {
        subtitles: {
          status: "available",
          tracks: [
            {
              languageCode: "es",
              label: "ES",
              src: "/api/jobs/job-1/artifacts/subtitles-es",
              source: "artifact",
              isGenerated: true,
            },
            {
              languageCode: "fr",
              label: "FR",
              src: "/api/jobs/job-1/artifacts/subtitles-fr",
              source: "artifact",
              isGenerated: true,
            },
          ],
        },
        metadata: {
          status: "available",
          value: {
            title: "Generated title",
            description: "Generated description",
            tags: ["hope"],
          },
        },
        chapters: {
          status: "available",
          value: {
            chapters: [
              {
                title: "Opening",
                startSeconds: 0,
                endSeconds: 42,
                summary: "Intro section",
              },
            ],
            track: {
              languageCode: "en",
              label: "Generated chapters",
              src: "/api/jobs/job-1/artifacts/chapters-vtt",
              source: "artifact",
              isGenerated: true,
            },
          },
        },
      },
      compare: {},
    },
  }
}

describe("buildReviewPlayerState", () => {
  it("defaults to the after tab and prefers the primary requested target language", () => {
    const state = buildReviewPlayerState({
      job: buildJob({
        primaryRequestedTargetLanguageCode: "fr",
        resolvedTargetLanguageCodes: ["es", "fr"],
      }),
      reviewContext: buildReadyContext(),
    })

    expect(state.status).toBe("ready")
    if (state.status !== "ready") {
      throw new Error("expected ready state")
    }

    expect(state.mode).toBe("after")
    expect(state.language).toBe("fr")
    expect(state.player.track?.src).toBe(
      "/api/jobs/job-1/artifacts/subtitles-fr",
    )
    expect(state.player.chapterTrack?.src).toBe(
      "/api/jobs/job-1/artifacts/chapters-vtt",
    )
    expect(state.metadata).toMatchObject({
      status: "available",
      value: {
        title: "Generated title",
      },
    })
  })

  it("preserves an explicit language selection across tab switches even when that tab has no track", () => {
    const state = buildReviewPlayerState({
      job: buildJob({
        primaryRequestedTargetLanguageCode: "fr",
        resolvedTargetLanguageCodes: ["es", "fr"],
      }),
      reviewContext: buildReadyContext(),
      selection: {
        mode: "before",
        language: "es",
      },
    })

    expect(state.status).toBe("ready")
    if (state.status !== "ready") {
      throw new Error("expected ready state")
    }

    expect(state.mode).toBe("before")
    expect(state.language).toBe("es")
    expect(state.player.track).toBeNull()
    expect(state.player.chapterTrack).toBeNull()
    expect(state.player.src).toBe("https://stream.mux.com/playback-1.m3u8")
    expect(state.player.emptyMessage).toContain("No subtitle track available")
    expect(state.metadata).toMatchObject({
      status: "available",
      value: {
        title: "Live title",
      },
    })
  })

  it("keeps chapter navigation independent from subtitle language selection", () => {
    const state = buildReviewPlayerState({
      job: buildJob({
        primaryRequestedTargetLanguageCode: "fr",
        resolvedTargetLanguageCodes: ["es", "fr"],
      }),
      reviewContext: buildReadyContext(),
      selection: {
        mode: "after",
        language: "es",
      },
    })

    expect(state.status).toBe("ready")
    if (state.status !== "ready") {
      throw new Error("expected ready state")
    }

    expect(state.language).toBe("es")
    expect(state.player.track?.src).toBe(
      "/api/jobs/job-1/artifacts/subtitles-es",
    )
    expect(state.player.chapterTrack).toEqual({
      languageCode: "en",
      label: "Generated chapters",
      src: "/api/jobs/job-1/artifacts/chapters-vtt",
      source: "artifact",
      isGenerated: true,
    })
  })

  it("distinguishes loaded-empty, failed, and unsupported states", () => {
    const loadedEmpty = buildReviewPlayerState({
      job: buildJob(),
      reviewContext: {
        status: "ready",
        context: {
          playbackUrl: "https://stream.mux.com/playback-1.m3u8",
          before: {
            subtitles: { status: "unavailable", reason: "missing" },
            metadata: { status: "unavailable", reason: "missing" },
            chapters: { status: "unavailable", reason: "missing" },
          },
          after: {
            subtitles: { status: "unavailable", reason: "missing" },
            metadata: { status: "unavailable", reason: "missing" },
            chapters: { status: "unavailable", reason: "missing" },
          },
          compare: {},
        },
      },
    })

    const failed = buildReviewPlayerState({
      job: buildJob(),
      reviewContext: {
        status: "failed",
        message: "Mux review lookup failed",
      },
    })

    const unsupported = buildReviewPlayerState({
      job: buildJob(),
      reviewContext: {
        status: "unsupported",
        message: "No playback source available",
      },
    })

    expect(loadedEmpty.status).toBe("loaded_empty")
    expect(failed).toMatchObject({
      status: "failed",
      message: "Mux review lookup failed",
    })
    expect(unsupported).toMatchObject({
      status: "unsupported",
      message: "No playback source available",
    })
  })
})
