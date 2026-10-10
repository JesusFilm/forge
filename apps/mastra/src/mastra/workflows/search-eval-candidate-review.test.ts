import { describe, expect, it, vi } from "vitest"

import {
  _internal,
  runSearchEvalCandidateReviewWorkflow,
} from "./search-eval-candidate-review"
import type { AdminCandidateListResponse } from "../../services/admin-search-eval-client"

const candidate: AdminCandidateListResponse["candidates"][number] = {
  id: "candidate-1",
  source: "catalog",
  promotionStatus: "generated",
  locale: "en",
  queryText: "Jesus",
  expectedResultHints: [],
  sourceAnchors: [],
  labelProvenance: {},
  generationModel: "seed:v1",
  generationProvider: "mastra",
  judgeSummary: null,
  sanitizedQueryText: null,
  sanitizedExpectedResultNotes: null,
  sanitizedSourceAnchors: [],
  sanitizationStatus: "pending",
  reviewerIdentity: null,
  reviewedAt: null,
  reviewNotes: null,
  promotedAt: null,
  promotionRunContext: {},
  mastraRunId: "run-1",
  retentionExpiresAt: null,
  generatedAt: "2026-05-26T00:00:00.000Z",
  createdAt: "2026-05-26T00:00:00.000Z",
}

describe("search eval candidate review workflow", () => {
  it("lists candidates through Admin HTTP client only", async () => {
    const listClient = vi.fn(async () => ({
      ok: true as const,
      result: {
        candidates: [candidate],
        generatedAt: "2026-05-28T00:00:00.000Z",
      },
    }))

    const result = await runSearchEvalCandidateReviewWorkflow(
      {
        action: "list",
        filters: { sources: ["catalog"], statuses: ["generated"], limit: 10 },
      },
      {
        adminBearer: "eval-key",
        candidateUrl:
          "https://admin.internal/api/internal/search-eval/candidates",
        listClient,
        runId: "run-review",
      },
    )

    expect(result).toMatchObject({
      ok: true,
      action: "list",
      candidates: [candidate],
      nativeDatasetItemShape: expect.objectContaining({
        nativeWrites: expect.objectContaining({ deferredTo: "feat-142" }),
      }),
    })
    expect(listClient).toHaveBeenCalledWith(
      expect.objectContaining({
        bearer: "eval-key",
        url: "https://admin.internal/api/internal/search-eval/candidates",
        filters: {
          sources: ["catalog"],
          statuses: ["generated"],
          limit: 10,
        },
      }),
    )
  })

  it("promotes by calling Admin promote endpoint with reviewer context", async () => {
    const promoteClient = vi.fn(async () => ({
      ok: true as const,
      result: {
        candidate: {
          ...candidate,
          promotionStatus: "promoted" as const,
          queryText: "Who is Jesus?",
          sanitizedQueryText: "Who is Jesus?",
          sanitizationStatus: "sanitized" as const,
          reviewerIdentity: "nisal",
        },
      },
    }))

    const result = await runSearchEvalCandidateReviewWorkflow(
      {
        action: "promote",
        candidateId: "candidate-1",
        reviewerIdentity: "nisal",
        sanitizedQueryText: "Who is Jesus?",
        sanitizedExpectedResultNotes: "Should surface Jesus overview",
        sanitizedSourceAnchors: [{ type: "video", id: "video-1" }],
        promotionRunContext: { reportId: "report-1" },
      },
      {
        adminBearer: "eval-key",
        candidateUrl:
          "https://admin.internal/api/internal/search-eval/candidates",
        promoteClient,
        runId: "run-review",
      },
    )

    expect(result).toMatchObject({
      ok: true,
      action: "promote",
      candidate: {
        id: "candidate-1",
        promotionStatus: "promoted",
        reviewerIdentity: "nisal",
      },
    })
    expect(promoteClient).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: "candidate-1",
        payload: expect.objectContaining({
          reviewerIdentity: "nisal",
          sanitizedQueryText: "Who is Jesus?",
          sanitizationStatus: "sanitized",
          promotionRunContext: expect.objectContaining({
            reportId: "report-1",
            mastraReviewAction: "promote",
          }),
        }),
      }),
    )
  })

  it("submits seed and user prompts as pending Admin candidates", async () => {
    const storeClient = vi.fn(async () => ({
      ok: true as const,
      result: {
        storedCount: 1,
        skippedCount: 0,
        candidates: [
          { id: "candidate-1", dedupeKey: "abc", status: "created" as const },
        ],
        skipped: [],
      },
    }))

    await runSearchEvalCandidateReviewWorkflow(
      { action: "submit-seed", seedLocales: ["en"] },
      {
        adminBearer: "eval-key",
        candidateUrl:
          "https://admin.internal/api/internal/search-eval/candidates",
        storeClient,
        runId: "run-seed",
      },
    )
    await runSearchEvalCandidateReviewWorkflow(
      {
        action: "submit-user",
        userSubmission: {
          locale: "en",
          queryText: "videos for new believers",
          submittedBy: "operator",
          expectedResultHints: [{ raw: "operator-only hint" }],
          sourceAnchors: [{ raw: "operator-only source claim" }],
          notes: "operator-only submission note",
        },
      },
      {
        adminBearer: "eval-key",
        candidateUrl:
          "https://admin.internal/api/internal/search-eval/candidates",
        storeClient,
        runId: "run-user",
      },
    )

    expect(storeClient).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: expect.objectContaining({
          candidates: expect.arrayContaining([
            expect.objectContaining({
              source: "seed",
              mastraRunId: "run-seed",
            }),
          ]),
        }),
      }),
    )
    expect(storeClient).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: {
          candidates: [
            expect.objectContaining({
              source: "user_submitted",
              queryText: "videos for new believers",
              expectedResultHints: [],
              sourceAnchors: [],
              labelProvenance: expect.objectContaining({
                rawSubmissionPayloadStored: false,
              }),
              mastraRunId: "run-user",
            }),
          ],
        },
      }),
    )
    expect(JSON.stringify(storeClient.mock.calls[1])).not.toContain(
      "operator-only",
    )
  })

  it("returns typed config failure instead of using Admin DB when client config is missing", async () => {
    const result = await runSearchEvalCandidateReviewWorkflow({
      action: "list",
    })

    expect(result).toEqual({
      ok: false,
      reason: "admin_config_missing",
      retryable: false,
      adminStatus: undefined,
      adminReason: undefined,
    })
  })

  it("documents native Dataset item shape without native ids", () => {
    expect(_internal.nativeDatasetItemShape).toMatchObject({
      targetId: "offline-search-eval",
      nativeWrites: {
        datasetId: null,
        scorerIds: [],
        experimentIds: [],
        deferredTo: "feat-142",
      },
    })
  })
})
