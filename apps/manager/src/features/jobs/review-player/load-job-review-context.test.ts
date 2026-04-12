import { describe, expect, it } from "vitest"
import { loadJobReviewContext } from "@/features/jobs/review-player/load-job-review-context"
import type { JobRecord } from "@/types/job"

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    videoDocumentId: "video-doc-1",
    sourceLanguageCode: "en",
    resolvedTargetLanguageCodes: ["fr"],
    languages: [],
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:01:00.000Z",
    artifacts: {
      metadata: { kind: "downloadable" },
      chapters: { kind: "downloadable" },
      "subtitles-fr": { kind: "downloadable" },
      subtitles: { kind: "downloadable" },
    },
    steps: [],
    errors: [],
    ...overrides,
  }
}

describe("loadJobReviewContext", () => {
  it("loads live CMS metadata, live Mux subtitle tracks, and generated artifact tracks", async () => {
    const result = await loadJobReviewContext(buildJob(), {
      loadVideoReviewSource: async () => ({
        title: "Live title",
        description: "Live description",
        subtitles: [
          {
            languageCode: "en",
            label: "English",
            src: "https://cdn.jesusfilm.org/subtitles/live-en.vtt",
            source: "cms",
            isGenerated: false,
          },
        ],
      }),
      loadMuxSubtitleTracks: async () => [
        {
          languageCode: "en",
          label: "EN",
          src: "https://stream.mux.com/playback-1/text/track-en.vtt",
          source: "mux",
          isGenerated: false,
        },
      ],
      readArtifactJson: async (_assetId, artifactKey) => {
        if (artifactKey === "metadata") {
          return {
            title: "Generated title",
            description: "Generated description",
            tags: ["hope"],
            topics: ["parable"],
            speakers: ["Jesus"],
            language: "French",
          }
        }

        if (artifactKey === "chapters") {
          return {
            chapters: [
              {
                title: "Opening",
                startSeconds: 0,
                summary: "Intro",
              },
            ],
          }
        }

        throw new Error(`Unexpected artifact ${artifactKey}`)
      },
      buildArtifactHref: (jobId, artifactKey) =>
        `/api/jobs/${jobId}/artifacts/${artifactKey}`,
    })

    expect(result.status).toBe("ready")
    if (result.status !== "ready") {
      throw new Error("expected ready result")
    }

    expect(result.context.before.metadata).toMatchObject({
      status: "available",
      value: {
        title: "Live title",
      },
    })
    expect(result.context.before.subtitles).toMatchObject({
      status: "available",
      tracks: [
        expect.objectContaining({
          languageCode: "en",
          source: "mux",
          src: "https://stream.mux.com/playback-1/text/track-en.vtt",
        }),
      ],
    })
    expect(result.context.after.subtitles).toMatchObject({
      status: "available",
      tracks: [
        expect.objectContaining({
          languageCode: "fr",
          src: "/api/jobs/job-1/artifacts/subtitles-fr",
          isGenerated: true,
        }),
      ],
    })
    expect(result.context.after.metadata).toMatchObject({
      status: "available",
      value: {
        title: "Generated title",
        description: "Generated description",
        tags: ["hope"],
        topics: ["parable"],
        speakers: ["Jesus"],
        language: "French",
      },
    })
  })

  it("drops unsafe CMS subtitle URLs while keeping approved tracks", async () => {
    const result = await loadJobReviewContext(buildJob(), {
      loadVideoReviewSource: async () => ({
        title: "Live title",
        description: "Live description",
        subtitles: [
          {
            languageCode: "en",
            label: "English",
            src: "https://cdn.jesusfilm.org/subtitles/live-en.vtt",
            source: "cms",
            isGenerated: false,
          },
          {
            languageCode: "es",
            label: "Spanish",
            src: "https://api-media-core.jesusfilm.org/subtitles/live-es.vtt",
            source: "cms",
            isGenerated: false,
          },
          {
            languageCode: "fr",
            label: "French",
            src: "http://evil.test/bad.vtt",
            source: "cms",
            isGenerated: false,
          },
          {
            languageCode: "de",
            label: "German",
            src: "javascript:alert(1)",
            source: "cms",
            isGenerated: false,
          },
        ],
      }),
      loadMuxSubtitleTracks: async () => [],
      readArtifactJson: async (_assetId, artifactKey) => {
        if (artifactKey === "metadata") {
          return {
            title: "Generated title",
            description: "Generated description",
          }
        }

        if (artifactKey === "chapters") {
          return {
            chapters: [],
          }
        }

        throw new Error(`Unexpected artifact ${artifactKey}`)
      },
      buildArtifactHref: (jobId, artifactKey) =>
        `/api/jobs/${jobId}/artifacts/${artifactKey}`,
    })

    expect(result.status).toBe("ready")
    if (result.status !== "ready") {
      throw new Error("expected ready result")
    }

    expect(result.context.before.subtitles).toMatchObject({
      status: "available",
      tracks: [
        expect.objectContaining({
          languageCode: "en",
          src: "https://cdn.jesusfilm.org/subtitles/live-en.vtt",
        }),
        expect.objectContaining({
          languageCode: "es",
          src: "https://api-media-core.jesusfilm.org/subtitles/live-es.vtt",
        }),
      ],
    })
    expect(result.context.before.subtitles).toMatchObject({
      status: "available",
      tracks: expect.not.arrayContaining([
        expect.objectContaining({
          languageCode: "fr",
        }),
        expect.objectContaining({
          languageCode: "de",
        }),
      ]),
    })
  })

  it("marks live chapters unavailable and preserves after-chapter empty states explicitly", async () => {
    const result = await loadJobReviewContext(
      buildJob({
        artifacts: {
          metadata: { kind: "downloadable" },
          "subtitles-fr": { kind: "downloadable" },
        },
      }),
      {
        loadVideoReviewSource: async () => ({
          title: "Live title",
          description: "Live description",
          subtitles: [],
        }),
        loadMuxSubtitleTracks: async () => [],
        readArtifactJson: async (_assetId, artifactKey) => {
          if (artifactKey === "metadata") {
            return {
              title: "Generated title",
              description: "Generated description",
            }
          }

          throw new Error(`Unexpected artifact ${artifactKey}`)
        },
        buildArtifactHref: (jobId, artifactKey) =>
          `/api/jobs/${jobId}/artifacts/${artifactKey}`,
      },
    )

    expect(result.status).toBe("ready")
    if (result.status !== "ready") {
      throw new Error("expected ready result")
    }

    expect(result.context.before.chapters).toEqual({
      status: "unavailable",
      reason: "no_live_chapters",
    })
    expect(result.context.after.chapters).toEqual({
      status: "unavailable",
      reason: "artifact_missing",
    })
  })

  it("keeps after metadata failed while leaving the rest of the review context usable", async () => {
    const result = await loadJobReviewContext(buildJob(), {
      loadVideoReviewSource: async () => ({
        title: "Live title",
        description: "Live description",
        subtitles: [],
      }),
      loadMuxSubtitleTracks: async () => [],
      readArtifactJson: async (_assetId, artifactKey) => {
        if (artifactKey === "metadata") {
          throw new Error("metadata artifact unreadable")
        }

        if (artifactKey === "chapters") {
          return {
            chapters: [],
          }
        }

        throw new Error(`Unexpected artifact ${artifactKey}`)
      },
      buildArtifactHref: (jobId, artifactKey) =>
        `/api/jobs/${jobId}/artifacts/${artifactKey}`,
    })

    expect(result.status).toBe("ready")
    if (result.status !== "ready") {
      throw new Error("expected ready result")
    }

    expect(result.context.after.metadata).toMatchObject({
      status: "failed",
      message: "metadata artifact unreadable",
    })
    expect(result.context.after.chapters).toMatchObject({
      status: "available",
      value: {
        chapters: [],
      },
    })
  })

  it("keeps the review context ready when live Mux subtitle lookup fails", async () => {
    const result = await loadJobReviewContext(buildJob(), {
      loadVideoReviewSource: async () => ({
        title: "Live title",
        description: "Live description",
        subtitles: [
          {
            languageCode: "en",
            label: "English",
            src: "https://cdn.jesusfilm.org/subtitles/live-en.vtt",
            source: "cms",
            isGenerated: false,
          },
        ],
      }),
      loadMuxSubtitleTracks: async () => {
        throw new Error("Mux subtitle lookup exploded")
      },
      readArtifactJson: async (_assetId, artifactKey) => {
        if (artifactKey === "metadata") {
          return {
            title: "Generated title",
            description: "Generated description",
          }
        }

        if (artifactKey === "chapters") {
          return {
            chapters: [
              {
                title: "Opening",
                startSeconds: 0,
              },
            ],
          }
        }

        throw new Error(`Unexpected artifact ${artifactKey}`)
      },
      buildArtifactHref: (jobId, artifactKey) =>
        `/api/jobs/${jobId}/artifacts/${artifactKey}`,
    })

    expect(result.status).toBe("ready")
    if (result.status !== "ready") {
      throw new Error("expected ready result")
    }

    expect(result.context.before.subtitles).toEqual({
      status: "available",
      tracks: [
        expect.objectContaining({
          languageCode: "en",
          src: "https://cdn.jesusfilm.org/subtitles/live-en.vtt",
        }),
      ],
    })
    expect(result.context.after.metadata).toEqual({
      status: "available",
      value: {
        title: "Generated title",
        description: "Generated description",
        tags: undefined,
        topics: undefined,
        speakers: undefined,
        language: undefined,
      },
    })
    expect(result.context.after.chapters).toEqual({
      status: "available",
      value: {
        chapters: [
          {
            title: "Opening",
            startSeconds: 0,
            endSeconds: null,
            summary: undefined,
          },
        ],
      },
    })
  })

  it("treats a metadata artifact with only language as available", async () => {
    const result = await loadJobReviewContext(buildJob(), {
      loadVideoReviewSource: async () => ({
        title: "Live title",
        description: "Live description",
        subtitles: [],
      }),
      loadMuxSubtitleTracks: async () => [],
      readArtifactJson: async (_assetId, artifactKey) => {
        if (artifactKey === "metadata") {
          return {
            title: "",
            description: "",
            topics: [],
            speakers: [],
            tags: [],
            language: "French",
          }
        }

        if (artifactKey === "chapters") {
          return {
            chapters: [],
          }
        }

        throw new Error(`Unexpected artifact ${artifactKey}`)
      },
      buildArtifactHref: (jobId, artifactKey) =>
        `/api/jobs/${jobId}/artifacts/${artifactKey}`,
    })

    expect(result.status).toBe("ready")
    if (result.status !== "ready") {
      throw new Error("expected ready result")
    }

    expect(result.context.after.metadata).toEqual({
      status: "available",
      value: {
        title: undefined,
        description: undefined,
        tags: undefined,
        topics: undefined,
        speakers: undefined,
        language: "French",
      },
    })
  })
})
