import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  afterMock,
  authenticateRequestMock,
  clientQueryMock,
  createJobMock,
  ensureGeneratedSubtitlesForAssetMock,
  isAudioCleanupConfiguredMock,
  materializeEnrichmentTargetForJobMock,
  runVideoEnrichmentMock,
  startMock,
  updateJobMock,
} = vi.hoisted(() => ({
  afterMock: vi.fn(),
  authenticateRequestMock: vi.fn(),
  clientQueryMock: vi.fn(),
  createJobMock: vi.fn(),
  ensureGeneratedSubtitlesForAssetMock: vi.fn(),
  isAudioCleanupConfiguredMock: vi.fn(),
  materializeEnrichmentTargetForJobMock: vi.fn(),
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
  GET_VIDEOS_WITH_MUX,
  mapWithConcurrencyLimit,
} from "@/app/api/enrich/route"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"

type QueryNode = {
  kind?: string
  name?: { value?: string }
  arguments?: Array<{
    name?: { value?: string }
    value?: {
      kind?: string
      fields?: Array<{
        name?: { value?: string }
        value?: { kind?: string; value?: string }
      }>
    }
  }>
  selectionSet?: { selections?: QueryNode[] }
}

function findField(
  selections: QueryNode[] | undefined,
  fieldName: string,
): QueryNode | undefined {
  for (const selection of selections ?? []) {
    if (selection.kind !== "Field") continue
    if (selection.name?.value === fieldName) return selection

    const nestedMatch = findField(selection.selectionSet?.selections, fieldName)
    if (nestedMatch) return nestedMatch
  }

  return undefined
}

function getLimitArgumentValue(field: QueryNode | undefined): string | null {
  const pagination = field?.arguments?.find(
    (argument) => argument.name?.value === "pagination",
  )
  if (!pagination?.value || pagination.value.kind !== "ObjectValue") {
    return null
  }

  const limit = pagination.value.fields?.find(
    (entry) => entry.name?.value === "limit",
  )
  if (!limit) {
    return null
  }

  return limit.value?.kind === "IntValue" ? (limit.value.value ?? null) : null
}

describe("GET_VIDEOS_WITH_MUX", () => {
  it("requests all nested variants explicitly", () => {
    const document = GET_VIDEOS_WITH_MUX as QueryNode & {
      definitions?: QueryNode[]
    }
    const operation = document.definitions?.[0]

    expect(operation?.kind).toBe("OperationDefinition")
    if (operation?.kind !== "OperationDefinition" || !operation.selectionSet) {
      return
    }

    const videosField = findField(operation.selectionSet.selections, "videos")
    const variantsField = findField(
      videosField?.selectionSet?.selections,
      "variants",
    )
    const downloadsField = findField(
      variantsField?.selectionSet?.selections,
      "downloads",
    )

    expect(getLimitArgumentValue(variantsField)).toBe("-1")
    expect(getLimitArgumentValue(downloadsField)).toBe("-1")
  })
})

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

  it("dispatches enrichment jobs through workflow start()", async () => {
    const result = await createEnrichmentJobs({
      videoIds: ["video-1"],
      targetLanguageIds: ["6414"],
    })

    expect(result).toMatchObject({
      created: 1,
      failed: 0,
      jobs: [{ videoId: "video-1", jobId: "job-1" }],
    })
    dispatch.expectDispatched(runVideoEnrichment, [
      expect.objectContaining({
        jobId: "job-1",
        assetId: "mux-target-1",
        muxAssetId: "mux-target-1",
        playbackId: "mux-target-playback-1",
        language: "en",
        translateTo: ["fr"],
        runAudioCleanup: true,
        videoDocumentId: "video-doc-1",
        requestedTranscriptionProvider: "automatic",
      }),
    ])
    expect(dispatch.spy).toHaveBeenCalledTimes(1)
    expect(runVideoEnrichment).not.toHaveBeenCalled()
  })

  it("reports per-video launch failures as batch errors", async () => {
    startMock.mockReset()
    startMock.mockRejectedValueOnce(new Error("workflow offline"))

    const result = await createEnrichmentJobs({
      videoIds: ["video-1"],
      targetLanguageIds: ["6414"],
    })

    expect(result).toMatchObject({
      created: 0,
      failed: 1,
      jobs: [],
      errors: [
        {
          videoId: "video-1",
          error: "Failed to launch enrichment workflow.",
        },
      ],
    })
    expect(updateJobMock).toHaveBeenCalledWith("job-1", { status: "failed" })
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(runVideoEnrichment).not.toHaveBeenCalled()
  })
})

describe("POST /api/enrich", () => {
  const dispatch = wrapStartSpy(startMock)

  beforeEach(() => {
    vi.clearAllMocks()
    authenticateRequestMock.mockResolvedValue(null)
  })

  it("rejects unauthorized requests before dispatch", async () => {
    authenticateRequestMock.mockResolvedValueOnce(
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const response = await POST(
      new Request("https://manager.test/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: ["video-1"] }),
      }),
    )

    expect(response.status).toBe(401)
    dispatch.expectNotDispatched()
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
    dispatch.expectNotDispatched()
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it("keeps a batch 201 response while surfacing per-video launch failures", async () => {
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
    materializeEnrichmentTargetForJobMock.mockResolvedValueOnce({
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
    ensureGeneratedSubtitlesForAssetMock.mockResolvedValueOnce(undefined)
    isAudioCleanupConfiguredMock.mockReturnValueOnce(true)
    createJobMock.mockResolvedValueOnce({
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
    updateJobMock.mockImplementation(async (_id, updates) => ({
      id: "job-1",
      muxAssetId: "mux-target-1",
      muxPlaybackId: "mux-target-playback-1",
      languages: ["fr"],
      options: {},
      status: updates.status ?? "pending",
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
    startMock.mockRejectedValueOnce(new Error("workflow offline"))

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

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      created: 0,
      failed: 1,
      jobs: [],
      errors: [
        {
          videoId: "video-1",
          error: "Failed to launch enrichment workflow.",
        },
      ],
    })
    expect(updateJobMock).toHaveBeenCalledWith("job-1", { status: "failed" })
    expect(startMock).toHaveBeenCalledTimes(1)
  })
})
