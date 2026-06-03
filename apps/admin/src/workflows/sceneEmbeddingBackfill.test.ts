import { beforeEach, describe, expect, it, vi } from "vitest"

const queryRawMock = vi.fn()
const loadMappingMock = vi.fn()
const loadSceneArtifactMock = vi.fn()
const launchMastraSceneEmbeddingMock = vi.fn()

vi.mock("@/db/client", () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}))

vi.mock("@/services/core-id-mapping.service", () => ({
  loadCoreIdMapping: loadMappingMock,
}))

vi.mock("./_steps/load-manager-artifact", () => ({
  stepLoadSceneAnalysisArtifact: loadSceneArtifactMock,
}))

vi.mock("@/services/mastra-scene-embedding-client", () => ({
  launchMastraSceneEmbedding: launchMastraSceneEmbeddingMock,
}))

const { ManagerArtifactError } =
  await import("@/services/manager-artifacts.service")
const { runSceneEmbeddingBackfill, _internals } =
  await import("./sceneEmbeddingBackfill")

const ARTIFACT = {
  scenes: [
    {
      sceneIndex: 0,
      startSeconds: 0,
      endSeconds: 2,
      chapterTitle: "Opening",
      description: "Jesus teaches.",
      themes: ["teaching"],
      bibleVerses: [],
      demographics: [],
      spiritualContext: [],
    },
  ],
  totalInputTokens: 10,
  totalOutputTokens: 12,
}

function mapping() {
  return {
    generatedAt: "2026-05-26T00:00:00.000Z",
    byCoreId: new Map([
      ["core-1", 42],
      ["core-2", 84],
    ]),
  }
}

function targetRows() {
  return [
    {
      video_id: "video-1",
      video_edition_id: "edition-1",
      core_id: "core-1",
      bcp47: "en",
      primary_bcp47: "en",
    },
    {
      video_id: "video-1",
      video_edition_id: "edition-1",
      core_id: "core-1",
      bcp47: "es",
      primary_bcp47: "en",
    },
  ]
}

describe("runSceneEmbeddingBackfill", () => {
  beforeEach(() => {
    queryRawMock.mockReset()
    loadMappingMock.mockReset()
    loadSceneArtifactMock.mockReset()
    launchMastraSceneEmbeddingMock.mockReset()
    loadMappingMock.mockResolvedValue(mapping())
    queryRawMock.mockResolvedValue(targetRows())
    loadSceneArtifactMock.mockResolvedValue(ARTIFACT)
    launchMastraSceneEmbeddingMock.mockResolvedValue({
      ok: true,
      status: "created",
      scenes: 1,
      providerTokens: 4,
      model: "openai/text-embedding-3-small",
      provider: "openai",
      dimensions: 1536,
      mastraRunId: "run-1",
      sourceContentHash: "sha256:scene",
    })
  })

  it("loads the exact scene-analysis artifact for each locale before launching Mastra", async () => {
    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      mode: "force",
    })

    expect(loadSceneArtifactMock).toHaveBeenCalledTimes(2)
    expect(loadSceneArtifactMock).toHaveBeenNthCalledWith(1, 42, null)
    expect(loadSceneArtifactMock).toHaveBeenNthCalledWith(2, 42, "es")
    expect(launchMastraSceneEmbeddingMock).toHaveBeenCalledTimes(2)
    expect(launchMastraSceneEmbeddingMock).toHaveBeenCalledWith({
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
      },
      locale: "en",
      assetId: 42,
      sceneAnalysis: ARTIFACT,
      sourceArtifactLocale: null,
      mode: "force",
    })
    expect(launchMastraSceneEmbeddingMock).toHaveBeenCalledWith({
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
      },
      locale: "es",
      assetId: 42,
      sceneAnalysis: ARTIFACT,
      sourceArtifactLocale: "es",
      mode: "force",
    })
    expect(report).toMatchObject({
      totalTargets: 2,
      succeeded: 2,
      skipped: 0,
      failed: 0,
      missingArtifacts: [],
    })
  })

  it("enumerates locale targets from primary language, subtitles, and dubs before launching Mastra", async () => {
    queryRawMock.mockResolvedValueOnce([
      {
        video_id: "video-1",
        video_edition_id: "edition-1",
        core_id: "core-1",
        bcp47: "es",
        primary_bcp47: "en",
      },
      {
        video_id: "video-1",
        video_edition_id: "edition-1",
        core_id: "core-1",
        bcp47: "fr",
        primary_bcp47: "en",
      },
      {
        video_id: "video-1",
        video_edition_id: "edition-1",
        core_id: "core-1",
        bcp47: "pt-BR",
        primary_bcp47: "en",
      },
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      mode: "force",
    })

    const [queryParts] = queryRawMock.mock.calls[0] as [
      ReadonlyArray<string>,
      ...unknown[],
    ]
    const queryText = queryParts.join("?")
    expect(queryText).toContain("v.primary_language_id")
    expect(queryText).toContain("JOIN video_subtitle s")
    expect(queryText).toContain("JOIN language l ON l.id = d.language_id")
    expect(launchMastraSceneEmbeddingMock).toHaveBeenCalledTimes(3)
    expect(
      launchMastraSceneEmbeddingMock.mock.calls.map(
        ([payload]) => payload.locale,
      ),
    ).toEqual(["es", "fr", "pt-BR"])
    expect(report).toMatchObject({
      totalTargets: 3,
      succeeded: 3,
      skipped: 0,
      failed: 0,
    })
  })

  it("keeps missing scene-analysis artifacts as operator-actionable skipped outcomes", async () => {
    loadSceneArtifactMock.mockRejectedValue(
      new ManagerArtifactError("artifact_missing", "missing"),
    )

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(launchMastraSceneEmbeddingMock).not.toHaveBeenCalled()
    expect(report.skipped).toBe(2)
    expect(report.missingArtifacts).toEqual([
      { assetId: 42, coreId: "core-1", kind: "scene-analysis" },
      {
        assetId: 42,
        coreId: "core-1",
        targetLocale: "es",
        kind: "scene-analysis",
      },
    ])
  })

  it("treats Mastra launch failures as failed outcomes without leaking payloads", async () => {
    launchMastraSceneEmbeddingMock.mockResolvedValueOnce({
      ok: false,
      reason: "provider_failed",
      retryable: true,
      mastraRunId: "run-failed",
    })

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      locales: ["en"],
    })

    expect(report.failed).toBe(1)
    expect(report.outcomes[0]).toMatchObject({
      status: "failed",
      reason: "provider_failed",
    })
    expect(JSON.stringify(report)).not.toContain("embedding")
  })

  it("reconciles retry targets against current enumeration", async () => {
    const targets = [
      {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
        cmsVideoId: 42,
        primaryLanguageBcp47: "en",
        locale: "en",
      },
    ]

    expect(
      _internals.reconcileRetryTargets(targets, [
        { coreId: "core-1", videoEditionId: "edition-1", locale: "en" },
        { coreId: "core-1", videoEditionId: "edition-1", locale: "fr" },
      ]),
    ).toEqual({
      requested: 2,
      matched: 1,
      unmatched: 1,
      unmatchedRetryTargets: [
        { coreId: "core-1", videoEditionId: "edition-1", locale: "fr" },
      ],
    })
  })
})
