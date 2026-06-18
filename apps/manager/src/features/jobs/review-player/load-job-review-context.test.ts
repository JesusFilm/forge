import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"

const { getCmsGatewayMock } = vi.hoisted(() => ({
  getCmsGatewayMock: vi.fn(),
}))

vi.mock("@/cms/gateway", async () => {
  const actual =
    await vi.importActual<typeof import("@/cms/gateway")>("@/cms/gateway")
  return {
    ...actual,
    getCmsGateway: getCmsGatewayMock,
  }
})

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
  beforeEach(() => {
    getCmsGatewayMock.mockReset()
    getCmsGatewayMock.mockReturnValue({ mode: "live" })
  })

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

  it("exposes subtitle validation summaries and artifacts for review automation", async () => {
    const result = await loadJobReviewContext(
      buildJob({
        artifacts: {
          metadata: { kind: "downloadable" },
          chapters: { kind: "downloadable" },
          "subtitles-fr": { kind: "downloadable" },
          "subtitle-validation-fr": { kind: "downloadable" },
        },
        steps: [
          {
            name: "translation",
            status: "completed",
            retries: 0,
            details: {
              subtitleValidation: {
                highestVerdict: "needs_review",
                languagesChecked: 1,
                modelOnlyLanguages: ["fr"],
                unavailableLanguages: [],
                warningCount: 0,
                needsReviewCount: 1,
                results: [
                  {
                    lang: "fr",
                    verdict: "needs_review",
                    basis: "model_knowledge",
                    confidence: 0.82,
                    checkedReferenceCount: 1,
                    warningCount: 0,
                    needsReviewCount: 1,
                    fallbackReason: "provider_config_missing",
                    unavailableReason: "artifact_write_failed",
                  },
                ],
              },
            },
          },
        ],
      }),
      {
        loadVideoReviewSource: async () => ({
          subtitles: [],
        }),
        loadMuxSubtitleTracks: async () => [],
        readArtifactJson: async (_assetId, artifactKey) => {
          if (artifactKey === "metadata") return { title: "Generated title" }
          if (artifactKey === "chapters") return { chapters: [] }
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

    expect(result.context.after.validation).toEqual({
      status: "available",
      summary: {
        highestVerdict: "needs_review",
        languagesChecked: 1,
        modelOnlyLanguages: ["fr"],
        unavailableLanguages: [],
        warningCount: 0,
        needsReviewCount: 1,
        results: [
          {
            lang: "fr",
            verdict: "needs_review",
            basis: "model_knowledge",
            confidence: 0.82,
            checkedReferenceCount: 1,
            warningCount: 0,
            needsReviewCount: 1,
            fallbackReason: "provider_config_missing",
            unavailableReason: "artifact_write_failed",
          },
        ],
      },
      artifacts: [
        {
          key: "subtitle-validation-fr",
          href: "/api/jobs/job-1/artifacts/subtitle-validation-fr",
          languageCode: "fr",
        },
      ],
    })
  })

  it("loads mock review sources without calling live CMS or Mux", async () => {
    const mockState = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)

    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      readMockState: vi.fn(async () => mockState),
    })

    const result = await loadJobReviewContext(
      buildJob({
        id: "mock-job-1",
        muxAssetId: "mock_asset_1",
        muxPlaybackId: "mockplayback1",
        videoDocumentId: "video-doc-episode-1",
      }),
      {
        buildArtifactHref: (jobId, artifactKey) =>
          `/api/jobs/${jobId}/artifacts/${artifactKey}`,
      },
    )

    expect(result.status).toBe("ready")
    if (result.status !== "ready") {
      throw new Error("expected ready result")
    }

    expect(result.context.before.metadata).toMatchObject({
      status: "available",
      value: {
        title: "Episode 1",
      },
    })
    expect(result.context.before.subtitles).toMatchObject({
      status: "available",
      tracks: [
        expect.objectContaining({
          languageCode: "en",
          src: "https://media.jesusfilm.org/subtitles/mock-episode-1-en.vtt",
        }),
      ],
    })
    expect(result.context.after.subtitles).toMatchObject({
      status: "available",
      tracks: [
        expect.objectContaining({
          languageCode: "fr",
          src: "/api/jobs/mock-job-1/artifacts/subtitles-fr",
        }),
      ],
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

  it("surfaces an after-only generated chapter track when chapters-vtt is downloadable", async () => {
    const readArtifactJson = async (_assetId: string, artifactKey: string) => {
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
              summary: "Intro",
            },
          ],
        }
      }

      throw new Error(`Unexpected artifact ${artifactKey}`)
    }
    const deps = {
      loadVideoReviewSource: async () => ({
        title: "Live title",
        description: "Live description",
        subtitles: [],
      }),
      loadMuxSubtitleTracks: async () => [],
      readArtifactJson,
      buildArtifactHref: (jobId: string, artifactKey: string) =>
        `/api/jobs/${jobId}/artifacts/${artifactKey}`,
    }

    const withVtt = await loadJobReviewContext(
      buildJob({
        artifacts: {
          metadata: { kind: "downloadable" },
          chapters: { kind: "downloadable" },
          "chapters-vtt": { kind: "downloadable" },
          "subtitles-fr": { kind: "downloadable" },
        },
      }),
      deps,
    )

    expect(withVtt.status).toBe("ready")
    if (withVtt.status !== "ready") {
      throw new Error("expected ready result")
    }

    expect(withVtt.context.before.chapters).toEqual({
      status: "unavailable",
      reason: "no_live_chapters",
    })
    expect(withVtt.context.after.chapters).toEqual({
      status: "available",
      value: {
        chapters: [
          {
            title: "Opening",
            startSeconds: 0,
            endSeconds: null,
            summary: "Intro",
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
    })

    const jsonOnly = await loadJobReviewContext(
      buildJob({
        artifacts: {
          metadata: { kind: "downloadable" },
          chapters: { kind: "downloadable" },
          "subtitles-fr": { kind: "downloadable" },
        },
      }),
      deps,
    )

    expect(jsonOnly.status).toBe("ready")
    if (jsonOnly.status !== "ready") {
      throw new Error("expected ready result")
    }

    expect(jsonOnly.context.after.chapters).toEqual({
      status: "available",
      value: {
        chapters: [
          {
            title: "Opening",
            startSeconds: 0,
            endSeconds: null,
            summary: "Intro",
          },
        ],
      },
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
