import { beforeEach, describe, expect, it, vi } from "vitest"
import { AdminGraphqlClient } from "./admin-client"

const fetchMock = vi.fn()

function managerJobPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "admin-job-test",
    muxAssetId: "asset-test",
    muxPlaybackId: "playback-test",
    languages: [],
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-06T00:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

describe("AdminGraphqlClient", () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it("reads Manager video coverage from Admin with the service bearer", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            managerVideoCoverage: [
              {
                documentId: "video-doc-1",
                coreId: "core-1",
                title: "Episode 1",
                label: "episode",
                slug: "episode-1",
                aiMetadata: false,
                imageUrl: null,
                parentDocumentIds: ["collection-doc-1"],
                parentRelations: [
                  { parentDocumentId: "collection-doc-1", order: 1 },
                ],
                coverage: {
                  subtitles: { human: 1, ai: 0 },
                  audio: { human: 0, ai: 1 },
                },
              },
            ],
          },
        }),
      ),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      apiKey: "manager-service-key",
      fetchImpl: fetchMock,
    })

    await expect(client.getVideoCoverage(["529"])).resolves.toEqual([
      expect.objectContaining({
        documentId: "video-doc-1",
        coverage: {
          subtitles: { human: 1, ai: 0 },
          audio: { human: 0, ai: 1 },
        },
      }),
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      "https://admin.example/api/graphql",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer manager-service-key",
          "Content-Type": "application/json",
        }),
      }),
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      variables: { languageIds: ["529"] },
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toContain(
      "parentRelations",
    )
  })

  it("surfaces Admin GraphQL failures as transport errors", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [{ message: "access denied" }],
        }),
      ),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(client.getLanguageGeo()).rejects.toThrow("access denied")
  })

  it("reads Manager enrichment video metadata from Admin", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            managerVideosForEnrichment: [
              {
                documentId: "video-doc-1",
                coreId: "core-1",
                title: "Jesus Film",
                label: "JESUS_FILM",
                primaryLanguage: {
                  coreId: "529",
                  bcp47: "en",
                  iso3: "eng",
                },
                variants: [
                  {
                    language: {
                      coreId: "529",
                      bcp47: "en",
                      iso3: "eng",
                    },
                    muxVideo: {
                      assetId: "mux-asset-1",
                      playbackId: "mux-playback-1",
                    },
                    downloads: [
                      { url: "https://stream.mux.com/source/720p.mp4" },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      ),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      apiKey: "manager-service-key",
      fetchImpl: fetchMock,
    })

    await expect(
      client.getVideosForEnrichment(["video-doc-1"]),
    ).resolves.toEqual([
      {
        documentId: "video-doc-1",
        coreId: "core-1",
        title: "Jesus Film",
        label: "JESUS_FILM",
        primaryLanguage: {
          coreId: "529",
          bcp47: "en",
          iso3: "eng",
        },
        variants: [
          {
            language: {
              coreId: "529",
              bcp47: "en",
              iso3: "eng",
            },
            muxVideo: {
              assetId: "mux-asset-1",
              playbackId: "mux-playback-1",
            },
            downloads: [{ url: "https://stream.mux.com/source/720p.mp4" }],
          },
        ],
      },
    ])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      variables: { ids: ["video-doc-1"] },
    })
  })

  it("creates Manager jobs through the Admin job contract", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            createManagerJob: {
              id: "admin-job-1",
              muxAssetId: "asset-1",
              muxPlaybackId: "playback-1",
              videoDocumentId: "video-doc-1",
              languages: ["529"],
              sourceLanguageCode: "en",
              options: {},
              status: "pending",
              retries: 0,
              createdAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:00:00.000Z",
              artifacts: {},
              steps: [],
              errors: [],
            },
          },
        }),
      ),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(
      client.createJob({
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        videoDocumentId: "video-doc-1",
        languages: ["529"],
        sourceLanguageCode: "en",
        artifacts: {
          transcriptionRouting: {
            kind: "metadata",
            data: { sourceInputUrl: "https://cdn.example/video.mp4" },
          },
        },
        errors: [],
        steps: [],
      }),
    ).resolves.toMatchObject({
      id: "admin-job-1",
      videoDocumentId: "video-doc-1",
      sourceLanguageCode: "en",
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      variables: {
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        videoDocumentId: "video-doc-1",
        sourceLanguageCode: "en",
        artifacts: {
          transcriptionRouting: {
            kind: "metadata",
            data: { sourceInputUrl: "https://cdn.example/video.mp4" },
          },
        },
        errors: [],
      },
    })
  })

  it("returns null when Admin reports a missing Manager job as nullable data", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            managerJob: null,
          },
        }),
      ),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(client.getJob("missing-job")).resolves.toBeNull()
  })

  it("lists Manager jobs with Admin pagination and reads the independent total", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              managerJobs: [
                {
                  id: "admin-job-2",
                  muxAssetId: "asset-2",
                  muxPlaybackId: "playback-2",
                  languages: ["fr"],
                  options: {},
                  status: "running",
                  retries: 1,
                  createdAt: "2026-05-06T00:00:00.000Z",
                  updatedAt: "2026-05-06T00:01:00.000Z",
                  artifacts: {},
                  steps: [],
                  errors: [],
                },
              ],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              managerJobsTotal: 250,
            },
          }),
        ),
      )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(client.listJobs({ limit: 25, offset: 100 })).resolves.toEqual([
      expect.objectContaining({ id: "admin-job-2" }),
    ])
    await expect(client.countJobs()).resolves.toBe(250)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      variables: { limit: 25, offset: 100 },
    })
  })

  it("accepts Shorts Studio workflow steps in Manager job lists", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            managerJobs: [
              managerJobPayload({
                id: "shorts-prepare-job",
                status: "running",
                currentStep: "shorts_prepare",
                options: { shorts: { assetId: "asset-short" } },
                steps: [
                  {
                    name: "shorts_prepare",
                    status: "running",
                    retries: 0,
                    startedAt: "2026-06-12T00:00:00.000Z",
                  },
                ],
              }),
              managerJobPayload({
                id: "shorts-render-job",
                status: "running",
                currentStep: "shorts_render",
                options: { shorts: { assetId: "asset-short" } },
                steps: [
                  {
                    name: "shorts_prepare",
                    status: "completed",
                    retries: 0,
                  },
                  {
                    name: "shorts_render",
                    status: "running",
                    retries: 0,
                  },
                  {
                    name: "shorts_mux_output",
                    status: "pending",
                    retries: 0,
                  },
                ],
              }),
              managerJobPayload({
                id: "shorts-mux-job",
                status: "running",
                currentStep: "shorts_mux_output",
                options: { shorts: { assetId: "asset-short" } },
                steps: [
                  {
                    name: "shorts_render",
                    status: "completed",
                    retries: 0,
                  },
                  {
                    name: "shorts_mux_output",
                    status: "running",
                    retries: 0,
                  },
                ],
              }),
            ],
          },
        }),
      ),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(client.listJobs()).resolves.toEqual([
      expect.objectContaining({
        id: "shorts-prepare-job",
        currentStep: "shorts_prepare",
        steps: [expect.objectContaining({ name: "shorts_prepare" })],
      }),
      expect.objectContaining({
        id: "shorts-render-job",
        currentStep: "shorts_render",
        steps: expect.arrayContaining([
          expect.objectContaining({ name: "shorts_render" }),
          expect.objectContaining({ name: "shorts_mux_output" }),
        ]),
      }),
      expect.objectContaining({
        id: "shorts-mux-job",
        currentStep: "shorts_mux_output",
        steps: expect.arrayContaining([
          expect.objectContaining({ name: "shorts_mux_output" }),
        ]),
      }),
    ])
  })

  it("rejects unknown Manager job current steps in list and detail payloads", async () => {
    const invalidCurrentStepPayload = managerJobPayload({
      currentStep: "future_unknown_step",
      steps: [
        {
          name: "shorts_prepare",
          status: "running",
          retries: 0,
        },
      ],
    })

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              managerJobs: [invalidCurrentStepPayload],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              managerJob: invalidCurrentStepPayload,
            },
          }),
        ),
      )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(client.listJobs()).rejects.toThrow(
      "invalid Manager job list payload",
    )
    await expect(client.getJob("admin-job-test")).rejects.toThrow(
      "invalid Manager job payload",
    )
  })

  it("rejects unknown Manager job step entries in list and detail payloads", async () => {
    const invalidStepNamePayload = managerJobPayload({
      currentStep: "shorts_prepare",
      steps: [
        {
          name: "future_unknown_step",
          status: "running",
          retries: 0,
        },
      ],
    })

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              managerJobs: [invalidStepNamePayload],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              managerJob: invalidStepNamePayload,
            },
          }),
        ),
      )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(client.listJobs()).rejects.toThrow(
      "invalid Manager job list payload",
    )
    await expect(client.getJob("admin-job-test")).rejects.toThrow(
      "invalid Manager job payload",
    )
  })

  it("rejects invalid Manager job step statuses in list and detail payloads", async () => {
    const invalidStepStatusPayload = managerJobPayload({
      steps: [
        {
          name: "shorts_prepare",
          status: "blocked",
          retries: 0,
        },
      ],
    })

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              managerJobs: [invalidStepStatusPayload],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              managerJob: invalidStepStatusPayload,
            },
          }),
        ),
      )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(client.listJobs()).rejects.toThrow(
      "invalid Manager job list payload",
    )
    await expect(client.getJob("admin-job-test")).rejects.toThrow(
      "invalid Manager job payload",
    )
  })

  it("rejects invalid Manager job statuses in list and detail payloads", async () => {
    const invalidJobStatusPayload = managerJobPayload({
      id: "admin-job-bad",
      status: "queued",
    })

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              managerJobs: [invalidJobStatusPayload],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              managerJob: invalidJobStatusPayload,
            },
          }),
        ),
      )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(client.listJobs()).rejects.toThrow(
      "invalid Manager job list payload",
    )
    await expect(client.getJob("admin-job-bad")).rejects.toThrow(
      "invalid Manager job payload",
    )
  })

  it("updates Manager jobs with artifact-derived source fields", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            updateManagerJob: {
              id: "admin-job-3",
              muxAssetId: "asset-3",
              muxPlaybackId: "playback-3",
              languages: ["es"],
              sourceLanguageCode: "en",
              sourceSelectionReason: "fallback-en",
              options: {},
              status: "running",
              retries: 0,
              createdAt: "2026-05-06T00:00:00.000Z",
              updatedAt: "2026-05-06T00:02:00.000Z",
              artifacts: {
                materialization: {
                  kind: "metadata",
                  data: { sourceLanguageCode: "en" },
                },
              },
              steps: [],
              errors: [],
            },
          },
        }),
      ),
    )

    const client = new AdminGraphqlClient({
      graphqlUrl: "https://admin.example/api/graphql",
      fetchImpl: fetchMock,
    })

    await expect(
      client.updateJob("admin-job-3", {
        artifacts: {
          materialization: {
            kind: "metadata",
            data: { sourceLanguageCode: "en" },
          },
        },
        sourceLanguageCode: "en",
        sourceSelectionReason: "fallback-en",
      }),
    ).resolves.toMatchObject({
      id: "admin-job-3",
      sourceLanguageCode: "en",
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      variables: {
        id: "admin-job-3",
        sourceLanguageCode: "en",
        sourceSelectionReason: "fallback-en",
      },
    })
  })
})
