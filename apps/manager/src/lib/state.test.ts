import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildJobUpdateData,
  getJob,
  listJobSummaries,
  mergeArtifactEntries,
  normalizeJobArtifacts,
  toJobRecord,
} from "@/lib/state"
import { getEmbeddingSyncReport } from "@/lib/embedding-sync-report"

const { mutateMock, queryMock, cmsPostMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  queryMock: vi.fn(),
  cmsPostMock: vi.fn(),
}))

vi.mock("@/cms/client", () => ({
  default: () => ({
    mutate: mutateMock,
    query: queryMock,
  }),
}))

vi.mock("@/services/cmsClient", () => ({
  cmsPost: cmsPostMock,
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

describe("toJobRecord", () => {
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
      } as Parameters<typeof toJobRecord>[0]),
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
      } as Parameters<typeof toJobRecord>[0]),
    ).toMatchObject({
      sourceLanguageId: "529",
      sourceLanguageCode: "en",
      sourceSelectionReason: "requested",
    })
  })
})
