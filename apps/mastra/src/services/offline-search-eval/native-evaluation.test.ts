import type {
  DatasetItem,
  DatasetRecord,
  Experiment,
} from "@mastra/core/storage"
import { describe, expect, it } from "vitest"

import type { AdminCandidateListResponse } from "../admin-search-eval-client"
import {
  NativeSearchEvalInputSchema,
  createSampleSearchEvalReport,
  scoreForOutcomeKind,
  searchResultPairwiseJudgeScorer,
  syncPromotedCandidatesToNativeDataset,
  syncSearchEvalReportToNativeEvaluation,
  type NativeSearchEvalMastra,
} from "./native-evaluation"

function fakeRecord(input: {
  id: string
  name: string
  metadata?: Record<string, unknown>
}): DatasetRecord {
  const now = new Date("2026-05-28T00:00:00.000Z")
  return {
    id: input.id,
    name: input.name,
    metadata: input.metadata,
    targetType: "workflow",
    targetIds: ["offline-search-eval"],
    scorerIds: ["search-result-pairwise-judge"],
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function createFakeMastra(): NativeSearchEvalMastra & {
  records: DatasetRecord[]
  datasetsById: Map<string, FakeDataset>
  scorers: Record<string, unknown>
} {
  const records: DatasetRecord[] = []
  const datasetsById = new Map<string, FakeDataset>()
  const scorers: Record<string, unknown> = {}
  const mastra = {
    records,
    datasetsById,
    scorers,
    datasets: {
      async list(args?: { page?: number; perPage?: number }) {
        return { datasets: paginate(records, args) }
      },
      async get({ id }: { id: string }) {
        const dataset = datasetsById.get(id)
        if (!dataset) throw new Error(`missing dataset ${id}`)
        return dataset
      },
      async create(input: {
        name: string
        metadata?: Record<string, unknown>
      }) {
        const id = `dataset-${records.length + 1}`
        const record = fakeRecord({
          id,
          name: input.name,
          metadata: input.metadata,
        })
        records.push(record)
        const dataset = new FakeDataset(record)
        datasetsById.set(id, dataset)
        return dataset
      },
    },
    listScorers() {
      return scorers
    },
    addScorer(scorer: unknown, key?: string) {
      scorers[key ?? "unknown"] = scorer
    },
  }
  return mastra as NativeSearchEvalMastra & {
    records: DatasetRecord[]
    datasetsById: Map<string, FakeDataset>
    scorers: Record<string, unknown>
  }
}

class FakeDataset {
  readonly id: string
  readonly items: DatasetItem[] = []
  readonly experiments: Experiment[] = []

  constructor(private readonly record: DatasetRecord) {
    this.id = record.id
  }

  async update(input: { name?: string; metadata?: Record<string, unknown> }) {
    if (input.name) this.record.name = input.name
    if (input.metadata) this.record.metadata = input.metadata
    return this.record
  }

  async addItems(input: {
    items: Array<{
      input: unknown
      groundTruth?: unknown
      metadata?: Record<string, unknown>
    }>
  }) {
    const now = new Date("2026-05-28T00:00:00.000Z")
    const added = input.items.map((item, index) => ({
      id: `item-${this.items.length + index + 1}`,
      datasetId: this.id,
      datasetVersion: 1,
      input: item.input,
      groundTruth: item.groundTruth,
      metadata: item.metadata,
      createdAt: now,
      updatedAt: now,
    }))
    this.items.push(...added)
    return added
  }

  async updateItem(input: {
    itemId: string
    input?: unknown
    groundTruth?: unknown
    metadata?: Record<string, unknown>
  }) {
    const item = this.items.find((candidate) => candidate.id === input.itemId)
    if (!item) throw new Error(`missing item ${input.itemId}`)
    item.input = input.input
    item.groundTruth = input.groundTruth
    item.metadata = input.metadata
    return item
  }

  async listItems(args?: { page?: number; perPage?: number }) {
    return { items: paginate(this.items, args) }
  }

  async listExperiments(args?: { page?: number; perPage?: number }) {
    return { experiments: paginate(this.experiments, args) }
  }

  async startExperiment(config: {
    name?: string
    targetType?: "workflow"
    targetId?: string
    metadata?: Record<string, unknown>
    task?: (args: {
      input: unknown
      groundTruth?: unknown
      metadata?: Record<string, unknown>
    }) => Promise<unknown> | unknown
  }) {
    for (const item of this.items) {
      await config.task?.({
        input: item.input,
        groundTruth: item.groundTruth,
        metadata: item.metadata,
      })
    }
    const now = new Date("2026-05-28T00:00:00.000Z")
    const experiment: Experiment = {
      id: `experiment-${this.experiments.length + 1}`,
      name: config.name,
      metadata: config.metadata,
      datasetId: this.id,
      datasetVersion: 1,
      targetType: config.targetType ?? "workflow",
      targetId: config.targetId ?? "offline-search-eval",
      status: "completed",
      totalItems: this.items.length,
      succeededCount: this.items.length,
      failedCount: 0,
      skippedCount: 0,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    this.experiments.push(experiment)
    return {
      experimentId: experiment.id,
      status: experiment.status,
      totalItems: experiment.totalItems,
      succeededCount: experiment.succeededCount,
      failedCount: experiment.failedCount,
      skippedCount: experiment.skippedCount,
    }
  }
}

function paginate<T>(
  records: T[],
  args?: { page?: number; perPage?: number },
): T[] {
  if (args?.perPage == null) return records
  const page = args.page ?? 0
  const start = page * args.perPage
  return records.slice(start, start + args.perPage)
}

describe("native search eval projection", () => {
  it("maps search outcome categories to native numeric scores with reasons", async () => {
    expect(scoreForOutcomeKind("win")).toBe(1)
    expect(scoreForOutcomeKind("tie")).toBe(0.5)
    expect(scoreForOutcomeKind("both-irrelevant")).toBe(0.5)
    expect(scoreForOutcomeKind("judge-disagreement")).toBe(0.5)
    expect(scoreForOutcomeKind("loss")).toBe(0)
    expect(scoreForOutcomeKind("judge-failure")).toBe(0)
    expect(scoreForOutcomeKind("search-failure")).toBe(0)

    const result = await searchResultPairwiseJudgeScorer.run({
      input: NativeSearchEvalInputSchema.parse({
        query: "Who is Jesus?",
        locale: "en",
        source: "seed",
        searchOptions: { limit: 5, mode: "hybrid", contentType: "all" },
      }),
      output: {
        outcomeKind: "judge-disagreement",
        caseId: "seed-1",
        locale: "en",
        query: "Who is Jesus?",
        baselineTopResults: [],
        currentTopResults: [],
        rationale: "The swapped comparison disagreed with the forward pass.",
        verdicts: ["clearly-A-better", "tie"],
        failureCode: null,
      },
    })

    expect(result.score).toBe(0.5)
    expect(result.reason).toContain("judge-disagreement")
  })

  it("preserves semantic-only mode and source-key identity in native records", async () => {
    const mastra = createFakeMastra()
    const sample = createSampleSearchEvalReport({
      runId: "sample-run-1",
      now: new Date("2026-05-28T00:00:00.000Z"),
    })
    const report = {
      ...sample,
      metadata: {
        ...sample.metadata,
        search: {
          ...sample.metadata.search,
          mode: "semantic-only",
        },
      },
    }

    await syncSearchEvalReportToNativeEvaluation({
      mastra,
      report,
      environmentLabel: "local",
    })

    const item = mastra.datasetsById.get("dataset-1")?.items[0]
    expect(item?.input).toMatchObject({
      searchOptions: { mode: "semantic-only" },
    })
    expect(item?.metadata).toMatchObject({
      forgeSearchEval: {
        sourceKey: expect.stringContaining("mode:semantic-only"),
      },
    })
  })

  it("keeps different requested modes in separate native datasets", async () => {
    const mastra = createFakeMastra()
    const hybridReport = createSampleSearchEvalReport({
      runId: "sample-run-hybrid",
      now: new Date("2026-05-28T00:00:00.000Z"),
    })
    const semanticOnlyReport = {
      ...createSampleSearchEvalReport({
        runId: "sample-run-semantic",
        now: new Date("2026-05-28T00:01:00.000Z"),
      }),
      metadata: {
        ...hybridReport.metadata,
        mastraRunId: "sample-run-semantic",
        search: {
          ...hybridReport.metadata.search,
          mode: "semantic-only",
        },
      },
    }

    const first = await syncSearchEvalReportToNativeEvaluation({
      mastra,
      report: hybridReport,
      environmentLabel: "local",
    })
    const second = await syncSearchEvalReportToNativeEvaluation({
      mastra,
      report: semanticOnlyReport,
      environmentLabel: "local",
    })

    expect(first.dataset.nativeKey).toContain("mode:hybrid")
    expect(second.dataset.nativeKey).toContain("mode:semantic-only")
    expect(second.dataset.datasetId).not.toBe(first.dataset.datasetId)
    expect(mastra.records.map((record) => record.name)).toEqual([
      "search-eval:local:local-smoke:hybrid",
      "search-eval:local:local-smoke:semantic-only",
    ])
  })

  it("syncs a report into native records idempotently", async () => {
    const mastra = createFakeMastra()
    const report = createSampleSearchEvalReport({
      runId: "sample-run-1",
      now: new Date("2026-05-28T00:00:00.000Z"),
    })

    const first = await syncSearchEvalReportToNativeEvaluation({
      mastra,
      report,
      reportPath: ".mastra/storage/search-eval/reports/sample-run-1.json",
      environmentLabel: "local",
    })
    const second = await syncSearchEvalReportToNativeEvaluation({
      mastra,
      report,
      reportPath: ".mastra/storage/search-eval/reports/sample-run-1.json",
      environmentLabel: "local",
    })

    expect(first.projection.integrationStatus).toBe("native_synced")
    expect(first.dataset.status).toBe("created")
    expect(first.dataset.createdItems).toBe(3)
    expect(first.experiment.status).toBe("created")
    expect(second.dataset.status).toBe("updated")
    expect(second.dataset.createdItems).toBe(0)
    expect(second.dataset.updatedItems).toBe(3)
    expect(second.experiment.status).toBe("reused")
    expect(mastra.records).toHaveLength(1)
    expect(mastra.datasetsById.get("dataset-1")?.items).toHaveLength(3)
    expect(mastra.datasetsById.get("dataset-1")?.experiments).toHaveLength(1)
  })

  it("reuses native records beyond the first list page", async () => {
    const mastra = createFakeMastra()
    for (let index = 0; index < 200; index++) {
      mastra.records.push(
        fakeRecord({
          id: `unrelated-${index}`,
          name: `unrelated-${index}`,
          metadata: {
            forgeSearchEval: { nativeKey: `unrelated:${index}` },
          },
        }),
      )
    }
    const report = createSampleSearchEvalReport({
      runId: "sample-run-1",
      now: new Date("2026-05-28T00:00:00.000Z"),
    })

    const first = await syncSearchEvalReportToNativeEvaluation({
      mastra,
      report,
      environmentLabel: "local",
    })
    const second = await syncSearchEvalReportToNativeEvaluation({
      mastra,
      report,
      environmentLabel: "local",
    })

    expect(first.dataset.status).toBe("created")
    expect(second.dataset.datasetId).toBe(first.dataset.datasetId)
    expect(second.dataset.status).toBe("updated")
    expect(mastra.records).toHaveLength(201)
  })

  it("keeps report Dataset items stable across repeated sample reports", async () => {
    const mastra = createFakeMastra()
    const firstReport = createSampleSearchEvalReport({
      runId: "sample-run-1",
      now: new Date("2026-05-28T00:00:00.000Z"),
    })
    const secondReport = createSampleSearchEvalReport({
      runId: "sample-run-2",
      now: new Date("2026-05-28T00:01:00.000Z"),
    })

    const first = await syncSearchEvalReportToNativeEvaluation({
      mastra,
      report: firstReport,
      environmentLabel: "local",
    })
    const second = await syncSearchEvalReportToNativeEvaluation({
      mastra,
      report: secondReport,
      environmentLabel: "local",
    })

    expect(second.dataset.datasetId).toBe(first.dataset.datasetId)
    expect(second.dataset.createdItems).toBe(0)
    expect(second.dataset.updatedItems).toBe(3)
    expect(mastra.records).toHaveLength(1)
    expect(mastra.datasetsById.get("dataset-1")?.items).toHaveLength(3)
    expect(mastra.datasetsById.get("dataset-1")?.experiments).toHaveLength(2)
  })

  it("preserves report outcome language context in native Dataset items", async () => {
    const mastra = createFakeMastra()
    const sample = createSampleSearchEvalReport({
      runId: "sample-run-1",
      now: new Date("2026-05-28T00:00:00.000Z"),
    })
    const report = {
      ...sample,
      outcomes: sample.outcomes.map((outcome) => ({
        ...outcome,
        languageSlug: "spanish-castilian",
        websiteLocale: "en",
      })),
    }

    await syncSearchEvalReportToNativeEvaluation({
      mastra,
      report,
      environmentLabel: "local",
    })

    const item = mastra.datasetsById.get("dataset-1")?.items[0]
    expect(item?.input).toMatchObject({
      languageSlug: "spanish-castilian",
      websiteLocale: "en",
    })
    expect(item?.metadata).toMatchObject({
      forgeSearchEval: {
        languageSlug: "spanish-castilian",
        websiteLocale: "en",
      },
    })
  })

  it("keeps only sanitized promoted candidates in native datasets", async () => {
    const mastra = createFakeMastra()
    const candidates = [
      {
        id: "candidate-1",
        source: "trace",
        promotionStatus: "promoted",
        locale: "en",
        queryText: "raw trace query",
        expectedResultHints: [],
        sourceAnchors: [{ raw: true }],
        labelProvenance: {},
        generationModel: "model",
        generationProvider: null,
        judgeSummary: null,
        sanitizedQueryText: "safe promoted query",
        sanitizedExpectedResultNotes: "Expect a Jesus Film result.",
        sanitizedSourceAnchors: [{ type: "video", id: "video-1" }],
        sanitizationStatus: "sanitized",
        reviewerIdentity: "operator@example.com",
        reviewedAt: "2026-05-28T00:00:00.000Z",
        reviewNotes: null,
        promotedAt: "2026-05-28T00:01:00.000Z",
        promotionRunContext: { safeKey: "safe value" },
        mastraRunId: "run-1",
        retentionExpiresAt: null,
        generatedAt: "2026-05-28T00:00:00.000Z",
        createdAt: "2026-05-28T00:00:00.000Z",
      },
      {
        id: "candidate-2",
        source: "catalog",
        promotionStatus: "generated",
        locale: "en",
        queryText: "pending generated query",
        expectedResultHints: [],
        sourceAnchors: [],
        labelProvenance: {},
        generationModel: "model",
        generationProvider: null,
        judgeSummary: null,
        mastraRunId: "run-2",
        retentionExpiresAt: null,
        generatedAt: "2026-05-28T00:00:00.000Z",
        createdAt: "2026-05-28T00:00:00.000Z",
      },
      {
        id: "candidate-3",
        source: "catalog",
        promotionStatus: "promoted",
        locale: "en",
        queryText: "unsafe promoted query",
        expectedResultHints: [],
        sourceAnchors: [],
        labelProvenance: {},
        generationModel: "model",
        generationProvider: null,
        judgeSummary: null,
        sanitizedQueryText: null,
        sanitizedExpectedResultNotes: null,
        sanitizedSourceAnchors: [],
        sanitizationStatus: "unsafe",
        reviewerIdentity: null,
        reviewedAt: null,
        reviewNotes: null,
        promotedAt: null,
        promotionRunContext: {},
        mastraRunId: "run-3",
        retentionExpiresAt: null,
        generatedAt: "2026-05-28T00:00:00.000Z",
        createdAt: "2026-05-28T00:00:00.000Z",
      },
    ] satisfies AdminCandidateListResponse["candidates"]

    const result = await syncPromotedCandidatesToNativeDataset({
      mastra,
      candidates,
      environmentLabel: "local",
    })
    const item = mastra.datasetsById.get("dataset-1")?.items[0]

    expect(result.dataset.createdItems).toBe(1)
    expect(result.skipped).toEqual([
      { candidateId: "candidate-2", reason: "not_promoted" },
      { candidateId: "candidate-3", reason: "not_sanitized" },
    ])
    expect(item?.input).toMatchObject({
      query: "safe promoted query",
      source: "generated_trace",
    })
    expect(JSON.stringify(item?.metadata)).not.toContain("raw trace query")
    expect(JSON.stringify(item?.metadata)).not.toContain("safe value")
  })
})
