import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  afterMock,
  authenticateRequestMock,
  createJobMock,
  ensureGeneratedSubtitlesForAssetMock,
  getCmsGatewayMock,
  isAudioCleanupConfiguredMock,
  materializeEnrichmentTargetForJobMock,
  readMockCmsStateMock,
  runVideoEnrichmentMock,
  startMock,
  updateJobMock,
} = vi.hoisted(() => ({
  afterMock: vi.fn(),
  authenticateRequestMock: vi.fn(),
  createJobMock: vi.fn(),
  ensureGeneratedSubtitlesForAssetMock: vi.fn(),
  getCmsGatewayMock: vi.fn(),
  isAudioCleanupConfiguredMock: vi.fn(),
  materializeEnrichmentTargetForJobMock: vi.fn(),
  readMockCmsStateMock: vi.fn(),
  runVideoEnrichmentMock: vi.fn(),
  startMock: vi.fn(),
  updateJobMock: vi.fn(),
}))

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server")

  return {
    ...actual,
    after: afterMock,
  }
})

vi.mock("workflow/api", () => ({
  start: startMock,
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/cms/gateway", () => ({
  getCmsGateway: getCmsGatewayMock,
  readMockCmsState: readMockCmsStateMock,
}))

vi.mock("@/lib/state", () => ({
  createJob: createJobMock,
  updateJob: updateJobMock,
}))

vi.mock("@/services/mux", () => ({
  ensureGeneratedSubtitlesForAsset: ensureGeneratedSubtitlesForAssetMock,
}))

vi.mock("@/services/audioCleanup", () => ({
  isAudioCleanupConfigured: isAudioCleanupConfiguredMock,
}))

vi.mock("@/services/stageClone", () => ({
  materializeEnrichmentTargetForJob: materializeEnrichmentTargetForJobMock,
}))

vi.mock("@/workflows/videoEnrichment", () => ({
  runVideoEnrichment: runVideoEnrichmentMock,
}))
import {
  POST,
  buildMaterializationMetadata,
  createEnrichmentJobs,
  ENRICH_CREATE_CONCURRENCY,
  mapWithConcurrencyLimit,
} from "@/app/api/enrich/route"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"

const ENGLISH_ADMIN_LANGUAGE_ID = "cmokkxw5v03uyqsccis58pea6"

function createAdminGatewayFixture({
  languages = [
    {
      id: ENGLISH_ADMIN_LANGUAGE_ID,
      coreId: "529",
      bcp47: "en",
      iso3: "eng",
      englishLabel: "English",
      nativeLabel: "English",
      countryIds: [],
      continentIds: [],
      countrySpeakers: {},
    },
  ],
  videos = [
    {
      documentId: "video-doc-1",
      coreId: "video-1",
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
            assetId: "mux-source-1",
            playbackId: "mux-source-playback-1",
          },
          downloads: [],
        },
      ],
    },
  ],
} = {}) {
  return {
    mode: "admin" as const,
    loginManagerUser: vi.fn(),
    verifyManagerSession: vi.fn(),
    readMockState: vi.fn(),
    updateMockState: vi.fn(),
    getLanguageGeo: vi.fn().mockResolvedValue({
      continents: [],
      countries: [],
      languages,
    }),
    getVideoCoverage: vi.fn(),
    getVideosForEnrichment: vi.fn().mockResolvedValue(videos),
    getCoverageSnapshots: vi.fn(),
  }
}

describe("mapWithConcurrencyLimit", () => {
  it("caps concurrent work while preserving result order", async () => {
    let inFlight = 0
    let maxInFlight = 0

    const results = await mapWithConcurrencyLimit(
      Array.from(
        { length: ENRICH_CREATE_CONCURRENCY + 3 },
        (_, index) => index,
      ),
      ENRICH_CREATE_CONCURRENCY,
      async (value) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)

        await new Promise((resolve) => setTimeout(resolve, 5))

        inFlight -= 1
        return value * 2
      },
    )

    expect(results).toEqual(
      Array.from(
        { length: ENRICH_CREATE_CONCURRENCY + 3 },
        (_, index) => index * 2,
      ),
    )
    expect(maxInFlight).toBe(ENRICH_CREATE_CONCURRENCY)
  })
})

describe("buildMaterializationMetadata", () => {
  it("builds clone-mode metadata with stage target fields", () => {
    const metadata = buildMaterializationMetadata({
      materialization: {
        status: "ready",
        materializationMode: "snapshot_to_stage_clone",
        sourceVideoCoreId: "video-1",
        sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
        sourceLanguageCode: "en",
        sourceMuxAssetId: "source-asset-1",
        sourceMuxPlaybackId: "source-playback-1",
        sourceInputUrl: "https://stream.mux.com/source/720p.mp4?token=secret",
        sourceInputType: "download_mp4",
        sourceSelectionReason: "requested",
        sourceSelectionAttemptedCodes: ["en", "es", "fr"],
        targetMuxAssetId: "stage-asset-1",
        targetMuxPlaybackId: "stage-playback-1",
      },
      actualSourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      actualSourceLanguageCode: "en",
      primaryRequestedTargetLanguageCode: "ru",
      requestedTargetLanguageIds: ["3934"],
      resolvedTargetLanguageCodes: ["ru"],
    })

    expect(metadata).toMatchObject({
      mode: "snapshot_to_stage_clone",
      sourceInputHost: "stream.mux.com",
      sourceInputType: "download_mp4",
      targetEnvironment: "mux-stage",
      stageMuxAssetId: "stage-asset-1",
      stageMuxPlaybackId: "stage-playback-1",
    })
  })

  it("builds direct-mode metadata with reused asset fields", () => {
    const metadata = buildMaterializationMetadata({
      materialization: {
        status: "ready",
        materializationMode: "direct_mux_asset_reuse",
        sourceVideoCoreId: "video-1",
        sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
        sourceLanguageCode: "en",
        sourceMuxAssetId: "source-asset-1",
        sourceMuxPlaybackId: "source-playback-1",
        sourceInputUrl: "https://stream.mux.com/source-playback-1/480p.mp4",
        sourceInputType: "mux_asset",
        sourceSelectionReason: "fallback-en",
        sourceSelectionAttemptedCodes: ["ru", "en", "es", "fr"],
        targetMuxAssetId: "source-asset-1",
        targetMuxPlaybackId: "source-playback-1",
      },
      actualSourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      actualSourceLanguageCode: "en",
      primaryRequestedTargetLanguageCode: "ru",
      requestedTargetLanguageIds: ["3934"],
      resolvedTargetLanguageCodes: ["ru"],
    })

    expect(metadata).toMatchObject({
      mode: "direct_mux_asset_reuse",
      sourceInputHost: "stream.mux.com",
      sourceInputType: "mux_asset",
      targetEnvironment: "mux-production",
      reusedMuxAssetId: "source-asset-1",
      reusedMuxPlaybackId: "source-playback-1",
    })
    expect(metadata).not.toHaveProperty("sourceInputUrl")
    expect(metadata).not.toHaveProperty("stageMuxAssetId")
  })
})

describe("createEnrichmentJobs", () => {
  const dispatch = wrapStartSpy(startMock)
  let adminGateway: ReturnType<typeof createAdminGatewayFixture>

  beforeEach(() => {
    vi.clearAllMocks()

    adminGateway = createAdminGatewayFixture()
    getCmsGatewayMock.mockReturnValue(adminGateway)
    readMockCmsStateMock.mockResolvedValue(null)
    authenticateRequestMock.mockResolvedValue(null)
    afterMock.mockImplementation(async (callback: () => Promise<void>) => {
      await callback()
    })
    isAudioCleanupConfiguredMock.mockReturnValue(true)
    materializeEnrichmentTargetForJobMock.mockResolvedValue({
      status: "ready",
      materializationMode: "direct_mux_asset_reuse",
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      sourceLanguageCode: "en",
      sourceMuxAssetId: "mux-source-1",
      sourceMuxPlaybackId: "mux-source-playback-1",
      sourceInputUrl: "https://stream.mux.com/mux-source-playback-1/480p.mp4",
      sourceInputType: "mux_asset",
      sourceSelectionReason: "fallback-en",
      sourceSelectionAttemptedCodes: ["fr", "en"],
      targetMuxAssetId: "mux-target-1",
      targetMuxPlaybackId: "mux-target-playback-1",
    })
    ensureGeneratedSubtitlesForAssetMock.mockResolvedValue(undefined)
    createJobMock.mockImplementation(
      async (_assetId, _playbackId, languages, options) => ({
        id: "job-1",
        muxAssetId: "mux-target-1",
        muxPlaybackId: "mux-target-playback-1",
        languages,
        options: {},
        status: "pending",
        retries: 0,
        createdAt: "",
        updatedAt: "",
        artifacts: options?.initialArtifacts ?? {},
        steps: [],
        errors: [],
      }),
    )
    updateJobMock.mockImplementation(async (_id, updates) => ({
      id: "job-1",
      muxAssetId: "mux-target-1",
      muxPlaybackId: "mux-target-playback-1",
      languages: ["en"],
      options: {},
      status: "pending",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: {
        transcriptionRouting: {
          kind: "metadata",
          data: { attempts: [] },
        },
        ...(updates.artifacts ?? {}),
      },
      steps: [],
      errors: [],
    }))
    dispatch.mockReturnValue({
      assetId: "mux-target-1",
      transcript: "Transcript",
      language: "en",
      chapters: [],
      tags: [],
    })
  })

  it("creates enrichment jobs from Admin-backed coverage selections", async () => {
    const result = await createEnrichmentJobs({
      videoIds: ["video-doc-1"],
      targetLanguageIds: [ENGLISH_ADMIN_LANGUAGE_ID],
    })

    expect(adminGateway.getVideosForEnrichment).toHaveBeenCalledWith([
      "video-doc-1",
    ])
    expect(materializeEnrichmentTargetForJobMock).toHaveBeenCalledWith(
      {
        coreId: "video-1",
        variants: [
          {
            language: {
              id: null,
              coreId: "529",
              bcp47: "en",
              iso3: "eng",
            },
            muxVideo: {
              assetId: "mux-source-1",
              playbackId: "mux-source-playback-1",
            },
            downloads: [],
          },
        ],
      },
      expect.objectContaining({
        requestedTargetLanguageCode: "en",
      }),
    )
    expect(createJobMock).toHaveBeenCalledWith(
      "mux-target-1",
      "mux-target-playback-1",
      ["en"],
      expect.objectContaining({
        videoDocumentId: "video-doc-1",
        sourceMediaTitle: "Jesus Film",
        initialArtifacts: expect.objectContaining({
          transcriptionRouting: expect.objectContaining({
            kind: "metadata",
            data: expect.objectContaining({
              sourceInputUrl:
                "https://stream.mux.com/mux-source-playback-1/480p.mp4",
              sourceInputHost: "stream.mux.com",
              attempts: [],
            }),
          }),
        }),
      }),
    )
    dispatch.expectDispatched(runVideoEnrichment, [
      expect.objectContaining({
        jobId: "job-1",
        assetId: "mux-target-1",
        muxAssetId: "mux-target-1",
        playbackId: "mux-target-playback-1",
        language: "en",
        translateTo: ["en"],
        runAudioCleanup: true,
        videoDocumentId: "video-doc-1",
        videoTitle: "Jesus Film",
        videoLabel: "JESUS_FILM",
        requestedTranscriptionProvider: "automatic",
        initialArtifacts: expect.objectContaining({
          transcriptionRouting: expect.objectContaining({
            kind: "metadata",
            data: expect.objectContaining({
              sourceInputUrl:
                "https://stream.mux.com/mux-source-playback-1/480p.mp4",
            }),
          }),
        }),
      }),
    ])
    expect(runVideoEnrichment).not.toHaveBeenCalled()
    expect(result).toEqual({
      created: 1,
      failed: 0,
      jobs: [{ videoId: "video-doc-1", jobId: "job-1" }],
      errors: undefined,
    })
  })

  it("rejects unresolved Admin language selections before dispatch", async () => {
    await expect(
      createEnrichmentJobs({
        videoIds: ["video-doc-1"],
        targetLanguageIds: ["unknown-admin-language-id"],
      }),
    ).rejects.toMatchObject({
      status: 400,
      responseBody: {
        error: "Could not resolve one or more requested target languages",
        unresolvedTargetLanguageIds: ["unknown-admin-language-id"],
      },
    })

    expect(createJobMock).not.toHaveBeenCalled()
    expect(dispatch.spy).not.toHaveBeenCalled()
    expect(runVideoEnrichment).not.toHaveBeenCalled()
  })

  it("reports missing Admin videos as per-video failures", async () => {
    adminGateway.getVideosForEnrichment.mockResolvedValueOnce([])

    await expect(
      createEnrichmentJobs({
        videoIds: ["missing-video-doc"],
        targetLanguageIds: [ENGLISH_ADMIN_LANGUAGE_ID],
      }),
    ).resolves.toEqual({
      created: 0,
      failed: 1,
      jobs: [],
      errors: [{ videoId: "missing-video-doc", error: "Video not found" }],
    })

    expect(createJobMock).not.toHaveBeenCalled()
    expect(dispatch.spy).not.toHaveBeenCalled()
    expect(runVideoEnrichment).not.toHaveBeenCalled()
  })

  it("reports materialization failures without dispatching workflows", async () => {
    materializeEnrichmentTargetForJobMock.mockResolvedValueOnce({
      status: "unsupported",
      sourceVideoCoreId: "video-1",
      reason: "no_reusable_mux_asset",
    })

    await expect(
      createEnrichmentJobs({
        videoIds: ["video-doc-1"],
        targetLanguageIds: [ENGLISH_ADMIN_LANGUAGE_ID],
      }),
    ).resolves.toEqual({
      created: 0,
      failed: 1,
      jobs: [],
      errors: [
        {
          videoId: "video-doc-1",
          error: "No reusable Mux asset available for direct enrichment",
        },
      ],
    })

    expect(createJobMock).not.toHaveBeenCalled()
    expect(dispatch.spy).not.toHaveBeenCalled()
    expect(runVideoEnrichment).not.toHaveBeenCalled()
  })
})

describe("POST /api/enrich", () => {
  const dispatch = wrapStartSpy(startMock)
  let adminGateway: ReturnType<typeof createAdminGatewayFixture>

  beforeEach(() => {
    vi.clearAllMocks()

    adminGateway = createAdminGatewayFixture()
    getCmsGatewayMock.mockReturnValue(adminGateway)
    readMockCmsStateMock.mockResolvedValue(null)
    authenticateRequestMock.mockResolvedValue(null)
    isAudioCleanupConfiguredMock.mockReturnValue(true)
    materializeEnrichmentTargetForJobMock.mockResolvedValue({
      status: "ready",
      materializationMode: "direct_mux_asset_reuse",
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      sourceLanguageCode: "en",
      sourceMuxAssetId: "mux-source-1",
      sourceMuxPlaybackId: "mux-source-playback-1",
      sourceInputUrl: "https://stream.mux.com/mux-source-playback-1/480p.mp4",
      sourceInputType: "mux_asset",
      sourceSelectionReason: "fallback-en",
      sourceSelectionAttemptedCodes: ["en"],
      targetMuxAssetId: "mux-target-1",
      targetMuxPlaybackId: "mux-target-playback-1",
    })
    ensureGeneratedSubtitlesForAssetMock.mockResolvedValue(undefined)
    createJobMock.mockImplementation(
      async (_assetId, _playbackId, languages, options) => ({
        id: "job-1",
        muxAssetId: "mux-target-1",
        muxPlaybackId: "mux-target-playback-1",
        languages,
        options: {},
        status: "pending",
        retries: 0,
        createdAt: "",
        updatedAt: "",
        artifacts: options?.initialArtifacts ?? {},
        steps: [],
        errors: [],
      }),
    )
    updateJobMock.mockImplementation(async (_id, updates) => ({
      id: "job-1",
      muxAssetId: "mux-target-1",
      muxPlaybackId: "mux-target-playback-1",
      languages: ["en"],
      options: {},
      status: "pending",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: {
        transcriptionRouting: {
          kind: "metadata",
          data: { attempts: [] },
        },
        ...(updates.artifacts ?? {}),
      },
      steps: [],
      errors: [],
    }))
    dispatch.mockReturnValue({
      assetId: "mux-target-1",
      transcript: "Transcript",
      language: "en",
      chapters: [],
      tags: [],
    })
  })

  it("rejects unauthorized requests before dispatch", async () => {
    authenticateRequestMock.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    )

    const response = await POST(
      new Request("https://manager.test/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: ["video-1"] }),
      }),
    )

    expect(response.status).toBe(401)
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid payloads without dispatching", async () => {
    const response = await POST(
      new Request("https://manager.test/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: [] }),
      }),
    )

    expect(response.status).toBe(400)
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it("accepts Admin language IDs and creates enrichment jobs", async () => {
    const response = await POST(
      new Request("https://manager.test/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoIds: ["video-doc-1"],
          targetLanguageIds: [ENGLISH_ADMIN_LANGUAGE_ID],
        }),
      }),
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      created: 1,
      failed: 0,
      jobs: [{ videoId: "video-doc-1", jobId: "job-1" }],
    })
    expect(adminGateway.getVideosForEnrichment).toHaveBeenCalledWith([
      "video-doc-1",
    ])
    dispatch.expectDispatched(runVideoEnrichment, [
      expect.objectContaining({
        jobId: "job-1",
        translateTo: ["en"],
        videoDocumentId: "video-doc-1",
        videoTitle: "Jesus Film",
        videoLabel: "JESUS_FILM",
      }),
    ])
  })
})
