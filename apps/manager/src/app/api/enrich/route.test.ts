import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  afterMock,
  authenticateRequestMock,
  clientQueryMock,
  createJobMock,
  ensureGeneratedSubtitlesForAssetMock,
  getJobMock,
  isAudioCleanupConfiguredMock,
  markEnrichmentDispatchedMock,
  materializeEnrichmentTargetForJobMock,
  resolveEnrichmentEngineMock,
  runVideoEnrichmentMock,
  startMock,
  updateJobMock,
} = vi.hoisted(() => ({
  afterMock: vi.fn(),
  authenticateRequestMock: vi.fn(),
  clientQueryMock: vi.fn(),
  createJobMock: vi.fn(),
  ensureGeneratedSubtitlesForAssetMock: vi.fn(),
  getJobMock: vi.fn(),
  isAudioCleanupConfiguredMock: vi.fn(),
  markEnrichmentDispatchedMock: vi.fn(),
  materializeEnrichmentTargetForJobMock: vi.fn(),
  resolveEnrichmentEngineMock: vi.fn(),
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

vi.mock("@/cms/client", () => ({
  default: () => ({
    query: clientQueryMock,
  }),
}))

vi.mock("@/lib/state", () => ({
  createJob: createJobMock,
  getJob: getJobMock,
  markEnrichmentDispatched: markEnrichmentDispatchedMock,
  updateJob: updateJobMock,
}))

vi.mock("@/lib/enrichment-engine", () => ({
  resolveEnrichmentEngine: resolveEnrichmentEngineMock,
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
  EnrichmentJobCreationError,
  mapWithConcurrencyLimit,
} from "@/app/api/enrich/route"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"

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
      sourceInputType: "mux_asset",
      targetEnvironment: "mux-production",
      reusedMuxAssetId: "source-asset-1",
      reusedMuxPlaybackId: "source-playback-1",
    })
    expect(metadata).not.toHaveProperty("sourceInputHost")
    expect(metadata).not.toHaveProperty("stageMuxAssetId")
  })
})

describe("createEnrichmentJobs", () => {
  const dispatch = wrapStartSpy(startMock)

  beforeEach(() => {
    vi.clearAllMocks()

    authenticateRequestMock.mockResolvedValue(null)
    resolveEnrichmentEngineMock.mockResolvedValue("workflow")
    afterMock.mockImplementation(async (callback: () => Promise<void>) => {
      await callback()
    })
    isAudioCleanupConfiguredMock.mockReturnValue(true)
    clientQueryMock
      .mockResolvedValueOnce({
        data: {
          videos: [
            {
              documentId: "video-doc-1",
              coreId: "video-1",
              title: "Video 1",
              primaryLanguage: {
                coreId: "529",
                bcp47: "en",
                iso3: "eng",
              },
              variants: [],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          languages: [
            {
              coreId: "6414",
              bcp47: "fr",
              iso3: "fra",
            },
          ],
        },
      })
    materializeEnrichmentTargetForJobMock.mockResolvedValue({
      status: "ready",
      materializationMode: "direct_mux_asset_reuse",
      sourceVideoCoreId: "video-1",
      sourceLanguage: { coreId: "529", bcp47: "en", iso3: "eng" },
      sourceLanguageCode: "en",
      sourceMuxAssetId: "mux-source-1",
      sourceMuxPlaybackId: "mux-source-playback-1",
      sourceInputType: "mux_asset",
      sourceSelectionReason: "fallback-en",
      sourceSelectionAttemptedCodes: ["fr", "en"],
      targetMuxAssetId: "mux-target-1",
      targetMuxPlaybackId: "mux-target-playback-1",
    })
    ensureGeneratedSubtitlesForAssetMock.mockResolvedValue(undefined)
    createJobMock.mockResolvedValue({
      id: "job-1",
      muxAssetId: "mux-target-1",
      muxPlaybackId: "mux-target-playback-1",
      languages: ["fr"],
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
      },
      steps: [],
      errors: [],
    })
    getJobMock.mockResolvedValue({
      id: "job-1",
      muxAssetId: "mux-target-1",
      muxPlaybackId: "mux-target-playback-1",
      languages: ["fr"],
      options: { engine: "workflow" },
      status: "pending",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: {},
      steps: [],
      errors: [],
    })
    updateJobMock.mockImplementation(async (_id, updates) => ({
      id: "job-1",
      muxAssetId: "mux-target-1",
      muxPlaybackId: "mux-target-playback-1",
      languages: ["fr"],
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

  it("rejects direct enrichment creation after the CMS video model is retired", async () => {
    await expect(
      createEnrichmentJobs({
        videoIds: ["video-1"],
        targetLanguageIds: ["6414"],
      }),
    ).rejects.toMatchObject({
      status: 410,
      responseBody: {
        error:
          "Direct enrichment creation from the retired CMS video model is no longer available.",
      },
    })
  })

  it("does not dispatch workflows for retired direct enrichment creation", async () => {
    await expect(
      createEnrichmentJobs({
        videoIds: ["video-1"],
        targetLanguageIds: ["6414"],
      }),
    ).rejects.toBeInstanceOf(EnrichmentJobCreationError)

    expect(dispatch.spy).not.toHaveBeenCalled()
    expect(runVideoEnrichment).not.toHaveBeenCalled()
  })
})

describe("POST /api/enrich", () => {
  beforeEach(() => {
    authenticateRequestMock.mockResolvedValue(null)
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

  it("returns 410 for retired direct enrichment creation", async () => {
    const response = await POST(
      new Request("https://manager.test/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoIds: ["video-1"],
          targetLanguageIds: ["6414"],
        }),
      }),
    )

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      error:
        "Direct enrichment creation from the retired CMS video model is no longer available.",
    })
  })
})
