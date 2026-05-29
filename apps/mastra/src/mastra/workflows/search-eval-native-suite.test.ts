import type { DatasetItem, DatasetRecord } from "@mastra/core/storage"
import { describe, expect, it, vi } from "vitest"

import {
  _internal,
  handleSearchEvalNativeSuiteRouteRequest,
  runSearchEvalNativeSuiteWorkflow,
} from "./search-eval-native-suite"
import type { NativeSearchEvalMastra } from "../../services/offline-search-eval/native-evaluation"

function fakeMastra(): NativeSearchEvalMastra & {
  records: DatasetRecord[]
  items: DatasetItem[]
} {
  const now = new Date("2026-05-28T00:00:00.000Z")
  const records: DatasetRecord[] = []
  const items: DatasetItem[] = []
  const scorers: Record<string, unknown> = {}
  async function addItems(input: {
    items: Array<{
      input: unknown
      groundTruth?: unknown
      metadata?: Record<string, unknown>
    }>
  }) {
    const added = input.items.map((item, index) => ({
      id: `item-${index + 1}`,
      datasetId: "dataset-1",
      datasetVersion: 1,
      input: item.input,
      groundTruth: item.groundTruth,
      metadata: item.metadata,
      createdAt: now,
      updatedAt: now,
    }))
    items.push(...added)
    return added
  }

  async function updateItem(input: { itemId: string }) {
    const item = items.find((candidate) => candidate.id === input.itemId)
    if (!item) throw new Error("not expected")
    return item
  }

  const dataset = {
    id: "dataset-1",
    addItems,
    updateItem,
    async listItems() {
      return { items }
    },
    async listExperiments() {
      return { experiments: [] }
    },
    async startExperiment() {
      throw new Error("not expected")
    },
  }

  return {
    records,
    items,
    datasets: {
      async list() {
        return { datasets: records }
      },
      async get() {
        return dataset
      },
      async create(input) {
        records.push({
          id: "dataset-1",
          name: input.name,
          metadata: input.metadata,
          targetType: "workflow",
          targetIds: ["offline-search-eval"],
          scorerIds: ["search-result-pairwise-judge"],
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        return dataset
      },
    },
    listScorers() {
      return scorers
    },
    addScorer(scorer, key) {
      scorers[key ?? "unknown"] = scorer
    },
  } as NativeSearchEvalMastra & {
    records: DatasetRecord[]
    items: DatasetItem[]
  }
}

describe("search eval native suite workflow", () => {
  it("syncs promoted candidates through Admin HTTP with promoted filters", async () => {
    const listClient = vi.fn(async () => ({
      ok: true as const,
      result: {
        candidates: [],
        generatedAt: "2026-05-28T00:00:00.000Z",
      },
    }))
    const result = await runSearchEvalNativeSuiteWorkflow(
      { action: "sync-promoted", promotedLimit: 7, environmentLabel: "local" },
      {
        mastra: fakeMastra(),
        adminBearer: "eval-key",
        candidateUrl:
          "https://admin.internal/api/internal/search-eval/candidates",
        listClient,
        runId: "run-native",
      },
    )

    expect(result).toMatchObject({
      ok: true,
      action: "sync-promoted",
      dataset: expect.objectContaining({
        name: "search-eval:local:promoted-regression",
      }),
    })
    expect(listClient).toHaveBeenCalledWith(
      expect.objectContaining({
        bearer: "eval-key",
        url: "https://admin.internal/api/internal/search-eval/candidates",
        filters: { statuses: ["promoted"], limit: 7 },
      }),
    )
  })

  it("rejects sample data creation for production-like environment labels", async () => {
    await expect(
      runSearchEvalNativeSuiteWorkflow(
        { action: "create-sample-report", environmentLabel: "production" },
        { mastra: fakeMastra(), runId: "run-native" },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "sample_not_allowed",
      retryable: false,
      reportPath: undefined,
      adminStatus: undefined,
      adminReason: undefined,
    })
  })

  it("requires service bearer auth on the route", async () => {
    const outcome = await handleSearchEvalNativeSuiteRouteRequest({
      authHeader: null,
      serviceKeys: ["service-key"],
      readJson: async () => ({ action: "sync-promoted" }),
    })

    expect(outcome).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
  })

  it("ignores malformed workflow failure envelopes", () => {
    expect(
      _internal.workflowFailureFromUnknown(
        new Error("SEARCH_EVAL_NATIVE_SUITE_FAILED:{not-json"),
      ),
    ).toBeNull()
  })
})
