import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildJobUpdateData,
  getJob,
  listJobSummaries,
  mergeArtifactEntries,
  mergeJobArtifacts,
  normalizeJobArtifacts,
  toJobRecord,
  updateJob,
  updateStepStatus,
} from "@/lib/state"
import { getEmbeddingSyncReport } from "@/lib/embedding-sync-report"

const { mutateMock, queryMock, cmsPostMock, publishJobEventMock } = vi.hoisted(
  () => ({
    mutateMock: vi.fn(),
    queryMock: vi.fn(),
    cmsPostMock: vi.fn(),
    publishJobEventMock: vi.fn(),
  }),
)

vi.mock("@/cms/client", () => ({
  default: () => ({
    mutate: mutateMock,
    query: queryMock,
  }),
}))

vi.mock("@/services/cmsClient", () => ({
  cmsPost: cmsPostMock,
}))

vi.mock("@/lib/job-events", () => ({
  publishJobEvent: publishJobEventMock,
}))

type GqlNode = {
  kind?: string
  name?: { value?: string }
  selectionSet?: { selections?: GqlNode[] }
  definitions?: GqlNode[]
}

function buildGraphqlJob(documentId: string) {
  return {
    documentId,
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    languages: [],
    status: "pending",
    currentStep: null,
    retries: 0,
    createdAt: "2026-04-11T00:00:00.000Z",
    updatedAt: "2026-04-11T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    artifacts: {},
    errors: [],
    steps: [],
  }
}

function getDefinition(
  document: GqlNode,
  kind: string,
  name: string,
): GqlNode | undefined {
  return document.definitions?.find(
    (definition) => definition.kind === kind && definition.name?.value === name,
  )
}

function getFieldNames(definition: GqlNode | undefined): string[] {
  return (
    definition?.selectionSet?.selections
      ?.filter((selection): selection is GqlNode => selection.kind === "Field")
      .map((selection) => selection.name?.value)
      .filter((value): value is string => Boolean(value)) ?? []
  )
}

function hasFragmentSpread(
  document: GqlNode,
  operationName: string,
  fragmentName: string,
): boolean {
  const operation = getDefinition(
    document,
    "OperationDefinition",
    operationName,
  )

  function walk(selections: GqlNode[] | undefined): boolean {
    for (const selection of selections ?? []) {
      if (
        selection.kind === "FragmentSpread" &&
        selection.name?.value === fragmentName
      ) {
        return true
      }

      if (walk(selection.selectionSet?.selections)) {
        return true
      }
    }

    return false
  }

  return walk(operation?.selectionSet?.selections)
}

beforeEach(() => {
  mutateMock.mockReset()
  queryMock.mockReset()
  cmsPostMock.mockReset()
  publishJobEventMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("buildJobUpdateData", () => {
  it("serializes explicit currentStep clearing as null", () => {
    expect(
      buildJobUpdateData({
        status: "failed",
        currentStep: undefined,
      }),
    ).toEqual({
      status: "failed",
      currentStep: null,
    })
  })

  it("serializes explicit errors clearing as an empty array", () => {
    expect(
      buildJobUpdateData({
        errors: [],
      }),
    ).toEqual({
      errors: [],
    })
  })

  it("merges new artifact manifest entries without dropping metadata", () => {
    expect(
      mergeArtifactEntries(
        {
          materialization: {
            kind: "metadata",
            data: { sourceVideoCoreId: "video-1" },
          },
          transcript: { kind: "downloadable" },
        },
        {
          chapters: { kind: "downloadable" },
          metadata: { kind: "downloadable" },
        },
      ),
    ).toEqual({
      materialization: {
        kind: "metadata",
        data: { sourceVideoCoreId: "video-1" },
      },
      transcript: { kind: "downloadable" },
      chapters: { kind: "downloadable" },
      metadata: { kind: "downloadable" },
    })
  })

  it("normalizes legacy artifact values into the new manifest shape", () => {
    expect(
      normalizeJobArtifacts({
        transcript: "/api/jobs/job-1/artifacts/transcript",
        materialization:
          '{"mode":"snapshot_to_stage_clone","sourceVideoCoreId":"video-1"}',
      }),
    ).toEqual({
      transcript: { kind: "downloadable" },
      materialization: {
        kind: "metadata",
        data: {
          mode: "snapshot_to_stage_clone",
          sourceVideoCoreId: "video-1",
        },
      },
    })
  })

  it("preserves embedding sync metadata artifacts for downstream UI parsing", () => {
    const artifacts = normalizeJobArtifacts({
      embeddingSync: {
        kind: "metadata",
        data: {
          domain: "embeddings",
          status: "skipped_existing",
          videoDocumentId: "video-doc-1",
          generated: {
            model: "openai/text-embedding-3-small",
            dimensions: 1536,
            chunkCount: 2,
            contentFingerprint: "sha256:generated",
            hasMetadataEmbedding: false,
          },
          cms: {
            resolvedVideoId: 42,
            hasEmbeddings: true,
            chunkCount: 2,
            contentFingerprint: "sha256:cms",
          },
        },
      },
    })

    expect(getEmbeddingSyncReport(artifacts)).toMatchObject({
      status: "skipped_existing",
      videoDocumentId: "video-doc-1",
      cms: {
        resolvedVideoId: 42,
      },
    })
  })
})

describe("job read models", () => {
  it("keeps artifacts in summary queries so unresolved routing failures stay visible", async () => {
    queryMock.mockResolvedValue({
      data: {
        enrichmentJobs: [buildGraphqlJob("job-1")],
      },
    })

    await listJobSummaries()

    const document = queryMock.mock.calls[0]?.[0]?.query as GqlNode
    const summaryFields = getDefinition(
      document,
      "FragmentDefinition",
      "JobSummaryFields",
    )

    expect(getFieldNames(summaryFields)).toContain("artifacts")
    expect(getFieldNames(summaryFields)).toContain("errors")
  })

  it("includes source fields when polling a job so source titles do not disappear", async () => {
    queryMock.mockResolvedValue({
      data: {
        enrichmentJob: {
          ...buildGraphqlJob("job-1"),
          video: {
            title: "Main feature",
            parents: [{ title: "Collection A" }],
          },
        },
      },
    })

    await getJob("job-1")

    const document = queryMock.mock.calls[0]?.[0]?.query as GqlNode

    expect(
      hasFragmentSpread(document, "GetEnrichmentJob", "JobSourceFields"),
    ).toBe(true)
  })
})

describe("live job event publishing", () => {
  it("publishes the normalized job after updateJob succeeds", async () => {
    mutateMock.mockResolvedValue({
      data: {
        updateEnrichmentJob: {
          ...buildGraphqlJob("job-10"),
          status: "running",
          currentStep: "transcription",
        },
      },
    })

    const updatedJob = await updateJob("job-10", {
      status: "running",
      currentStep: "transcription",
    })

    expect(updatedJob).toMatchObject({
      id: "job-10",
      status: "running",
      currentStep: "transcription",
    })
    expect(publishJobEventMock).toHaveBeenCalledWith(updatedJob)
  })

  it("publishes the merged job after mergeJobArtifacts succeeds", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        enrichmentJob: {
          ...buildGraphqlJob("job-11"),
          artifacts: {
            materialization: {
              sourceLanguageCode: "en",
            },
          },
        },
      },
    })
    mutateMock.mockResolvedValueOnce({
      data: {
        updateEnrichmentJob: {
          ...buildGraphqlJob("job-11"),
          artifacts: {
            materialization: {
              sourceLanguageCode: "en",
            },
            transcript: true,
          },
        },
      },
    })

    const updatedJob = await mergeJobArtifacts("job-11", {
      transcript: { kind: "downloadable" },
    })

    expect(updatedJob?.artifacts).toMatchObject({
      transcript: { kind: "downloadable" },
    })
    expect(publishJobEventMock).toHaveBeenCalledWith(updatedJob)
  })

  it("publishes the normalized job after updateStepStatus succeeds", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        enrichmentJob: {
          ...buildGraphqlJob("job-12"),
          steps: [
            {
              name: "transcription",
              status: "pending",
              retries: 0,
              startedAt: null,
              finishedAt: null,
              error: null,
              details: null,
            },
          ],
        },
      },
    })
    mutateMock.mockResolvedValueOnce({
      data: {
        updateEnrichmentJob: {
          ...buildGraphqlJob("job-12"),
          steps: [
            {
              name: "transcription",
              status: "completed",
              retries: 0,
              startedAt: "2026-04-11T00:00:10.000Z",
              finishedAt: "2026-04-11T00:00:20.000Z",
              error: null,
              details: null,
            },
          ],
        },
      },
    })

    const updatedJob = await updateStepStatus(
      "job-12",
      "transcription",
      "completed",
    )

    expect(updatedJob?.steps[0]).toMatchObject({
      name: "transcription",
      status: "completed",
    })
    expect(publishJobEventMock).toHaveBeenCalledWith(updatedJob)
  })
})

describe("toJobRecord", () => {
  it("keeps source titles when a live job read includes the rich video shape", async () => {
    queryMock.mockResolvedValue({
      data: {
        enrichmentJob: {
          documentId: "job-3",
          muxAssetId: "asset-3",
          muxPlaybackId: "playback-3",
          languages: ["en"],
          status: "completed",
          currentStep: "metadata",
          retries: 0,
          createdAt: "2026-04-09T00:00:00.000Z",
          updatedAt: "2026-04-09T00:01:00.000Z",
          startedAt: "2026-04-09T00:00:10.000Z",
          completedAt: "2026-04-09T00:01:00.000Z",
          artifacts: {},
          errors: [],
          steps: [],
          video: {
            documentId: "video-doc-1",
            title: "Live title",
            parents: [{ title: "Collection A" }, { title: "Collection B" }],
          },
        },
      },
    })

    await expect(getJob("job-3")).resolves.toMatchObject({
      sourceMediaTitle: "Live title",
      sourceCollectionTitle: "Collection A, Collection B",
    })

    const queryDocument = queryMock.mock.calls[0]?.[0]?.query as {
      definitions?: Array<{
        kind?: string
        name?: { value?: string }
        selectionSet?: { selections?: unknown[] }
      }>
    }
    const jobCoreFragment = queryDocument.definitions?.find(
      (definition) =>
        definition.kind === "FragmentDefinition" &&
        definition.name?.value === "JobCoreFields",
    )

    const collectFieldNames = (selectionSet: {
      selections?: unknown[]
    }): string[] =>
      (selectionSet.selections ?? []).flatMap((selection) => {
        if (
          typeof selection !== "object" ||
          selection == null ||
          !("kind" in selection)
        ) {
          return []
        }

        const node = selection as {
          kind: string
          name?: { value?: string }
          selectionSet?: { selections?: unknown[] }
        }

        if (node.kind !== "Field") {
          return []
        }

        const names = [node.name?.value].filter(
          (value): value is string => typeof value === "string",
        )
        if (node.selectionSet) {
          names.push(...collectFieldNames(node.selectionSet))
        }

        return names
      })

    expect(
      collectFieldNames(jobCoreFragment?.selectionSet ?? { selections: [] }),
    ).toEqual(
      expect.arrayContaining(["documentId", "video", "title", "parents"]),
    )
  })

  it("promotes the related CMS video document id when present", () => {
    expect(
      toJobRecord({
        documentId: "job-3",
        muxAssetId: "asset-3",
        muxPlaybackId: "playback-3",
        languages: ["en"],
        status: "completed",
        currentStep: "metadata",
        retries: 0,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:01:00.000Z",
        startedAt: "2026-04-09T00:00:10.000Z",
        completedAt: "2026-04-09T00:01:00.000Z",
        artifacts: {},
        errors: [],
        steps: [],
        video: {
          documentId: "video-doc-1",
          title: "Live title",
          parents: [],
        },
      } as unknown as Parameters<typeof toJobRecord>[0]),
    ).toMatchObject({
      videoDocumentId: "video-doc-1",
      sourceMediaTitle: "Live title",
    })
  })

  it("derives source-language fields from materialization metadata", () => {
    expect(
      toJobRecord({
        documentId: "job-1",
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        languages: ["ru"],
        status: "completed",
        currentStep: "translation",
        retries: 0,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:01:00.000Z",
        startedAt: "2026-04-09T00:00:10.000Z",
        completedAt: "2026-04-09T00:01:00.000Z",
        artifacts: {
          materialization: {
            sourceLanguageId: "529",
            sourceLanguageCode: "en",
            sourceSelectionReason: "fallback-en",
            primaryRequestedTargetLanguageCode: "ru",
            resolvedTargetLanguageCodes: ["ru"],
          },
        },
        errors: [],
        steps: [],
      } as unknown as Parameters<typeof toJobRecord>[0]),
    ).toMatchObject({
      sourceLanguageId: "529",
      sourceLanguageCode: "en",
      sourceSelectionReason: "fallback-en",
      primaryRequestedTargetLanguageCode: "ru",
      resolvedTargetLanguageCodes: ["ru"],
      artifacts: {
        materialization: {
          kind: "metadata",
          data: {
            sourceLanguageId: "529",
            sourceLanguageCode: "en",
            sourceSelectionReason: "fallback-en",
            primaryRequestedTargetLanguageCode: "ru",
            resolvedTargetLanguageCodes: ["ru"],
          },
        },
      },
    })
  })

  it("derives source-language fields from legacy stringified materialization metadata", () => {
    expect(
      toJobRecord({
        documentId: "job-2",
        muxAssetId: "asset-2",
        muxPlaybackId: "playback-2",
        languages: ["en"],
        status: "completed",
        currentStep: "transcription",
        retries: 0,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:01:00.000Z",
        startedAt: "2026-04-09T00:00:10.000Z",
        completedAt: "2026-04-09T00:01:00.000Z",
        artifacts: {
          materialization:
            '{"sourceLanguageId":"529","sourceLanguageCode":"en","sourceSelectionReason":"requested"}',
        },
        errors: [],
        steps: [],
      } as unknown as Parameters<typeof toJobRecord>[0]),
    ).toMatchObject({
      sourceLanguageId: "529",
      sourceLanguageCode: "en",
      sourceSelectionReason: "requested",
    })
  })
})
