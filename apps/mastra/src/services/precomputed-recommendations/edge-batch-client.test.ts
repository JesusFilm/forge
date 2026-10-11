import { describe, expect, it, vi } from "vitest"

import { createEdgeBatchPersistence } from "./edge-batch-client"
import type { EdgeBatchPersistencePort } from "./edge-batch-executor"

const scope = {
  generationId: "edge-client-fixture",
  generationInputDigest: "1".repeat(64),
}
const start: Parameters<EdgeBatchPersistencePort["start"]>[0] = {
  action: "edge_batch_start",
  ...scope,
  attemptId: "11111111-1111-4111-8111-111111111111",
  callId: "22222222-2222-4222-8222-222222222222",
  modelId: "gpt-6-astra",
  backend: "codex_chatgpt_subscription",
  promptVersion: "edge-v1",
  schemaVersion: "edge-schema-v1",
  inputDigest: "2".repeat(64),
  membershipDigest: "3".repeat(64),
  selectedCorpusDigest: "4".repeat(64),
  candidatePoolDigest: "5".repeat(64),
  captureRefDigest: null,
  spanOfferDigest: "6".repeat(64),
  startedAt: "2026-10-08T00:00:00.000Z",
  spanOffers: [],
  members: ["source-a", "source-b"].map((sourceVideoId) => ({
    sourceVideoId,
    leaseToken: "33333333-3333-4333-8333-333333333333",
    checkpointRevision: 0,
    pageIndex: 0,
    sourceProfileKey: "7".repeat(64),
    candidates: [
      {
        targetVideoId: "target",
        targetProfileKey: "8".repeat(64),
        poolRank: 0,
      },
    ],
    candidatePageDigest: "9".repeat(64),
    sourceCandidateCount: 1,
    sourceCandidateDigest: "a".repeat(64),
    historicalRefDigest: "b".repeat(64),
  })),
}
const finish: Parameters<EdgeBatchPersistencePort["finish"]>[0] = {
  action: "edge_batch_finish",
  ...scope,
  attemptId: start.attemptId,
  callId: start.callId,
  inputDigest: start.inputDigest,
  membershipDigest: start.membershipDigest,
  spanOfferDigest: start.spanOfferDigest,
  status: "failed",
  errorCode: "provider_unavailable",
  usage: { inputTokens: 100, outputTokens: 0 },
  finishedAt: "2026-10-08T00:00:01.000Z",
}
const pendingMembers = start.members.map(({ sourceVideoId }) => ({
  sourceVideoId,
  applicationState: "pending",
  appliedRevision: null,
  checkpointRevision: 0,
}))

describe("Admin shared edge client", () => {
  it("refuses a reservation that silently omits a source member", async () => {
    const client = createEdgeBatchPersistence(async () => ({
      generationId: scope.generationId,
      callId: start.callId,
      state: "pending",
      replay: false,
      members: pendingMembers.slice(0, 1),
    }))
    await expect(client.start(start)).rejects.toMatchObject({
      code: "batch_unavailable",
    })
  })

  it("refuses a receipt belonging to another physical invocation", async () => {
    const client = createEdgeBatchPersistence(async () => ({
      generationId: scope.generationId,
      callId: "44444444-4444-4444-8444-444444444444",
      state: "failed",
      receiptStored: true,
      replay: false,
      members: pendingMembers.map((member) => ({
        ...member,
        applicationState: "rejected_unapplied",
      })),
    }))
    await expect(client.finish(finish)).rejects.toMatchObject({
      code: "batch_unavailable",
    })
  })

  it("preserves a single stored receipt with independently applied and stale members", async () => {
    const receipt = {
      generationId: scope.generationId,
      callId: start.callId,
      state: "succeeded",
      receiptStored: true,
      replay: true,
      members: [
        {
          sourceVideoId: "source-a",
          applicationState: "applied_empty",
          appliedRevision: 1,
          checkpointRevision: 1,
        },
        {
          sourceVideoId: "source-b",
          applicationState: "stale_unapplied",
          appliedRevision: null,
          checkpointRevision: 0,
        },
      ],
    }
    const client = createEdgeBatchPersistence(async () => receipt)
    expect(
      await client.finish({
        ...finish,
        status: "succeeded",
        errorCode: undefined,
        outputDigest: "c".repeat(64),
        results: start.members.map(({ sourceVideoId }) => ({
          sourceVideoId,
          choices: [],
        })),
      }),
    ).toEqual(receipt)
  })

  it("refuses an applied member without its applied revision", async () => {
    const client = createEdgeBatchPersistence(async () => ({
      generationId: scope.generationId,
      callId: start.callId,
      state: "succeeded",
      receiptStored: true,
      replay: true,
      members: [{ ...pendingMembers[0], applicationState: "applied_empty" }],
    }))
    await expect(client.finish(finish)).rejects.toMatchObject({
      code: "batch_unavailable",
    })
  })

  it("refuses source status from a different generation", async () => {
    const client = createEdgeBatchPersistence(async () => ({
      generationId: "different-generation",
      sourceVideoId: "source-a",
      sourceState: "claimed",
      checkpointRevision: 0,
      sourceCandidateCount: null,
      sourceCandidateDigest: null,
      calls: [],
      nextCursor: null,
    }))
    await expect(
      client.status({
        action: "edge_batch_status",
        ...scope,
        sourceVideoId: "source-a",
      }),
    ).rejects.toMatchObject({ code: "batch_unavailable" })
  })

  it("refuses an empty finalization that claims accepted edges", async () => {
    const client = createEdgeBatchPersistence(async () => ({
      generationId: scope.generationId,
      sourceVideoId: "source-a",
      sourceState: "complete_empty",
      acceptedCount: 1,
      checkpointRevision: 1,
      replay: false,
    }))
    await expect(
      client.finalizeSource({
        action: "edge_source_finalize",
        ...scope,
        attemptId: start.attemptId,
        sourceVideoId: "source-a",
        leaseToken: start.members[0]!.leaseToken,
        expectedRevision: 1,
        sourceProfileKey: start.members[0]!.sourceProfileKey,
        sourceCandidateCount: 1,
        sourceCandidateDigest: start.members[0]!.sourceCandidateDigest,
      }),
    ).rejects.toMatchObject({ code: "batch_unavailable" })
  })

  it("never retries a finish when the transport loses its response", async () => {
    const lost = new Error("lost response")
    const ingest = vi.fn(async () => {
      throw lost
    })
    await expect(
      createEdgeBatchPersistence(ingest).finish(finish),
    ).rejects.toBe(lost)
    expect(ingest).toHaveBeenCalledOnce()
  })

  it("refuses oversized requests before sending them", async () => {
    const ingest = vi.fn(async () => undefined)
    await expect(
      createEdgeBatchPersistence(ingest).start({
        ...start,
        promptVersion: "x".repeat(65_536),
      }),
    ).rejects.toMatchObject({ code: "input_invalid" })
    expect(ingest).not.toHaveBeenCalled()
  })

  it("sanitizes oversized replies without echoing their contents", async () => {
    const client = createEdgeBatchPersistence(async () =>
      "private-response-".repeat(40_000),
    )
    await expect(client.start(start)).rejects.toMatchObject({
      code: "batch_unavailable",
      message: "batch_unavailable",
    })
  })
})
