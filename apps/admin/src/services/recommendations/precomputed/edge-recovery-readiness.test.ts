import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { loadQualifiedManualEdgeRecovery } from "./edge-ledger"

const generationId = "subscription-astra-budget2-20261008-v4"
const originalCallId = "8ab8a620-1608-4115-812e-200bb2fb4b6d"
const replacementCallId = "c0f9dd99-1111-4111-8111-111111111111"
const sourceIds = ["cmokmj8ka0njkqsccfvhbto3g", "cmokmjc390nk2qscc79tyun6g"]
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

function rows() {
  const members = sourceIds.map((sourceVideoId) => {
    const candidates = Array.from({ length: 4 }, (_, poolRank) => ({
      poolRank,
      targetVideoId: `target-${sourceVideoId}-${poolRank}`,
      targetProfileKey: "a".repeat(64),
    }))
    return {
      sourceVideoId,
      pageIndex: 0,
      sourceProfileKey: "b".repeat(64),
      sourceCandidateCount: 4,
      sourceCandidateDigest: "c".repeat(64),
      historicalRefDigest: "d".repeat(64),
      candidatePageDigest: digest([
        sourceVideoId,
        0,
        candidates.map((candidate) => [
          candidate.poolRank,
          candidate.targetVideoId,
          candidate.targetProfileKey,
        ]),
      ]),
      candidates,
      applicationState: "acknowledged_unknown",
      appliedRevision: null,
    }
  })
  const original = {
    generationId,
    callId: originalCallId,
    attemptId: "6ef8681b-1607-4ae9-b0b1-c28c41225d6b",
    modelId: "gpt-6-astra",
    backend: "codex_chatgpt_subscription",
    inputDigest:
      "d87ad22523187a6e2bdedbb6a948057fddaa9d18f7a1efe8bb3a3224587a8824",
    membershipDigest:
      "ec3d4b7ffdfad5bd1ef03d68a5577df2aa6b14969191e9de53b9a0ac8d983b72",
    selectedCorpusDigest: "e".repeat(64),
    candidatePoolDigest:
      "0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a",
    captureRefDigest:
      "8edf8cce9a1ed5abf1ad847c47dd7f3389a9d1e431f8690ad9b3f0450b3e1cc8",
    status: "pending",
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    outputDigest: null,
    errorCode: null,
    finishedAt: null,
    receiptDigest: null,
    recoveryReplacementCallId: replacementCallId,
    recoveryOperatorAccountRef: "edge-account-123",
    recoveryAcknowledgedAt: new Date("2026-10-12T00:00:00.000Z"),
    recoveryOldProcessExitedAttested: true,
    executionAttempt: { endedAt: new Date("2026-10-11T23:00:00.000Z") },
    members,
  }
  const replacement = {
    ...original,
    callId: replacementCallId,
    attemptId: "fa8c59b6-1111-4111-8111-111111111111",
    status: "succeeded",
    outputDigest: "1".repeat(64),
    inputTokens: 33_110,
    outputTokens: 1_496,
    finishedAt: new Date("2026-10-12T00:02:00.000Z"),
    receiptDigest: "f".repeat(64),
    recoveryReplacementCallId: null,
    executionAttempt: {
      endedAt: new Date("2026-10-12T00:03:00.000Z"),
      accountRef: "edge-account-123",
      billingBasis: "included_subscription",
      backend: "codex_chatgpt_subscription",
      modelId: "gpt-6-astra",
      authMethod: "chatgpt",
    },
    members: members.map((member) => ({
      ...member,
      applicationState: "applied_edges",
      appliedRevision: 2,
    })),
  }
  return { original, replacement }
}

function db(
  data: ReturnType<typeof rows>,
  generationInputDigest = "36d168040f404b12e12be8d4ecdf8b75c102fe459bcefb22753f434fe29443b9",
) {
  const findUnique = vi
    .fn()
    .mockImplementation(({ where }) =>
      Promise.resolve(
        where.generationId_callId.callId === originalCallId
          ? data.original
          : where.generationId_callId.callId === replacementCallId
            ? data.replacement
            : null,
      ),
    )
  return {
    db: {
      recommendationPrecomputedGeneration: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ inputDigest: generationInputDigest }),
      },
      recommendationPrecomputedEdgeBatchCall: { findUnique },
    } as unknown as PrismaClient,
    findUnique,
  }
}

describe("exact manual edge recovery readiness", () => {
  it("qualifies one immutable unknown call only after its linked replacement succeeds and applies both members", async () => {
    const data = rows()
    const { db: client } = db(data)
    const first = await loadQualifiedManualEdgeRecovery(client, generationId)
    expect(first).toMatchObject({
      qualifiedAcknowledgedUnknownCount: 1,
      qualifiedAcknowledgmentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(await loadQualifiedManualEdgeRecovery(client, generationId)).toEqual(
      first,
    )
    expect(data.original).toMatchObject({
      status: "pending",
      inputTokens: null,
      outputTokens: null,
    })
  })

  it.each([
    [
      "unacknowledged",
      (data: ReturnType<typeof rows>) => {
        Object.assign(data.original, { recoveryAcknowledgedAt: null })
      },
    ],
    [
      "old attempt still open",
      (data: ReturnType<typeof rows>) => {
        Object.assign(data.original.executionAttempt, { endedAt: null })
      },
    ],
    [
      "old output digest appears",
      (data: ReturnType<typeof rows>) => {
        Object.assign(data.original, { outputDigest: "f".repeat(64) })
      },
    ],
    [
      "old error code appears",
      (data: ReturnType<typeof rows>) => {
        Object.assign(data.original, { errorCode: "unknown_error" })
      },
    ],
    [
      "pending replacement",
      (data: ReturnType<typeof rows>) => {
        data.replacement.status = "pending"
      },
    ],
    [
      "failed replacement",
      (data: ReturnType<typeof rows>) => {
        data.replacement.status = "failed"
      },
    ],
    [
      "unknown replacement usage",
      (data: ReturnType<typeof rows>) => {
        Object.assign(data.replacement, { inputTokens: null })
      },
    ],
    [
      "malformed replacement usage",
      (data: ReturnType<typeof rows>) => {
        data.replacement.inputTokens = Number.NaN
      },
    ],
    [
      "malformed receipt digest",
      (data: ReturnType<typeof rows>) => {
        data.replacement.receiptDigest = "invalid"
      },
    ],
    [
      "missing output digest",
      (data: ReturnType<typeof rows>) => {
        Object.assign(data.replacement, { outputDigest: null })
      },
    ],
    [
      "wrong operator account",
      (data: ReturnType<typeof rows>) => {
        data.replacement.executionAttempt.accountRef = "another-account"
      },
    ],
    [
      "replacement attempt still open",
      (data: ReturnType<typeof rows>) => {
        Object.assign(data.replacement.executionAttempt, { endedAt: null })
      },
    ],
    [
      "unapplied member",
      (data: ReturnType<typeof rows>) => {
        data.replacement.members[0]!.applicationState = "stale_unapplied"
      },
    ],
    [
      "changed frozen page",
      (data: ReturnType<typeof rows>) => {
        data.replacement.members[0]!.candidatePageDigest = "0".repeat(64)
      },
    ],
  ])("rejects %s", async (_case, mutate) => {
    const data = rows()
    mutate(data)
    expect(
      await loadQualifiedManualEdgeRecovery(db(data).db, generationId),
    ).toEqual({
      qualifiedAcknowledgedUnknownCount: 0,
      qualifiedAcknowledgmentDigest: null,
    })
  })

  it("never qualifies another generation", async () => {
    const fake = db(rows())
    expect(
      await loadQualifiedManualEdgeRecovery(fake.db, "another-generation"),
    ).toEqual({
      qualifiedAcknowledgedUnknownCount: 0,
      qualifiedAcknowledgmentDigest: null,
    })
    expect(fake.findUnique).not.toHaveBeenCalled()
  })

  it("rejects a generation with a different frozen input", async () => {
    expect(
      await loadQualifiedManualEdgeRecovery(
        db(rows(), "0".repeat(64)).db,
        generationId,
      ),
    ).toEqual({
      qualifiedAcknowledgedUnknownCount: 0,
      qualifiedAcknowledgmentDigest: null,
    })
  })
})
