import { createHash } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { profileActionSchema, submitProfileAction } from "./profile-ledger"
import { submitEdgeAction } from "./edge-ledger"
import { subscriptionModelIdSchema } from "./subscription-model"
import { submitDurablePrecomputedRecommendation } from "./durable-build"

vi.mock("@/auth/mastra-ingest-bearer", () => ({
  isValidMastraRecommendationIngestBearer: () => true,
}))
const hash = "a".repeat(64)
const uuid = "11111111-1111-4111-8111-111111111111"
const now = new Date().toISOString()
const profile = {
  action: "profile_register",
  generationId: "sol-generation",
  generationInputDigest: hash,
  attemptId: uuid,
  cacheKey: hash,
  videoId: "video",
  modelId: "gpt-6.1-sol",
  backend: "codex_chatgpt_subscription",
  promptVersion: "complete-profile-v6",
  schemaVersion: "complete-profile-schema-v1",
  metadataDigest: hash,
  chunkDigest: hash,
  selectedTranscriptCount: 0,
  selectedChunkCount: 0,
  sourceTextBytes: 0,
  partDigests: [],
  coverageDigest: hash,
  kind: "metadata_only",
}
const generation = {
  id: "sol-generation",
  status: "incomplete",
  input_digest: hash,
  protocol_version: 4,
  input_mode: "content_only",
  input_snapshot_mode: "observed_fenced",
  execution_backend: "codex_chatgpt_subscription",
  model_id: "gpt-6.1-sol",
  historical_qualification: null,
  capacity_preflight: null,
}
function fakeDb() {
  const tx = {
    $executeRaw: vi.fn(),
    recommendationPrecomputedBuildSource: {
      findUnique: vi.fn(async () => null),
    },
  }
  const prisma = {
    $transaction: async (
      fn: (db: Prisma.TransactionClient) => Promise<unknown>,
    ) => fn(tx as unknown as Prisma.TransactionClient),
  } as unknown as PrismaClient
  return { tx, prisma }
}
function profileGuards(modelId: string) {
  return {
    checkedGeneration: async () => ({ ...generation, model_id: modelId }),
    requireCapacityFresh: vi.fn(),
    capacityIsFresh: () => true,
    reserveBudget: vi.fn(),
    hasOpenSubscriptionAttempt: async () => true,
  }
}

describe("subscription model persistence boundaries", () => {
  it("admits exact Sol and Astra profile identities, never aliases", () => {
    expect(profileActionSchema.safeParse(profile).success).toBe(true)
    expect(
      profileActionSchema.safeParse({ ...profile, modelId: "gpt-6-astra" })
        .success,
    ).toBe(true)
    expect(
      profileActionSchema.safeParse({ ...profile, modelId: "sol" }).success,
    ).toBe(false)
    expect(subscriptionModelIdSchema.safeParse("gpt-5.6-sol").success).toBe(
      false,
    )
  })
  it("rejects a Sol profile on an immutable Astra generation before touching its cache", async () => {
    const { tx, prisma } = fakeDb()
    await expect(
      submitProfileAction(prisma, profile, profileGuards("gpt-6-astra")),
    ).rejects.toThrow("Profile model differs from generation")
    expect(
      tx.recommendationPrecomputedBuildSource.findUnique,
    ).not.toHaveBeenCalled()
  })
  it("passes a matching Sol profile through model validation to ordinary catalog validation", async () => {
    const { tx, prisma } = fakeDb()
    const cacheKey = createHash("sha256")
      .update(
        JSON.stringify({
          revision: "complete-selected-profile-plan-v1",
          videoId: profile.videoId,
          metadataDigest: hash,
          chunkDigest: hash,
          modelId: profile.modelId,
          backend: profile.backend,
          promptVersion: profile.promptVersion,
          schemaVersion: profile.schemaVersion,
          partDigests: [],
        }),
      )
      .digest("hex")
    await expect(
      submitProfileAction(
        prisma,
        { ...profile, cacheKey },
        profileGuards("gpt-6.1-sol"),
      ),
    ).rejects.toThrow("Video is outside the frozen generation manifest")
    expect(
      tx.recommendationPrecomputedBuildSource.findUnique,
    ).toHaveBeenCalledTimes(1)
  })
  it("rejects cross-model edges before reserving a physical call", async () => {
    const { prisma } = fakeDb()
    const guards = { ...profileGuards("gpt-6-astra"), saveChoice: vi.fn() }
    const edge = {
      action: "edge_batch_start",
      generationId: "sol-generation",
      generationInputDigest: hash,
      attemptId: uuid,
      callId: uuid,
      modelId: "gpt-6.1-sol",
      backend: "codex_chatgpt_subscription",
      promptVersion: "shared-edge-v1",
      schemaVersion: "shared-edge-schema-v1",
      inputDigest: hash,
      membershipDigest: hash,
      selectedCorpusDigest: hash,
      candidatePoolDigest: hash,
      captureRefDigest: null,
      spanOfferDigest: hash,
      startedAt: now,
      members: [
        {
          sourceVideoId: "video",
          leaseToken: uuid,
          checkpointRevision: 0,
          pageIndex: 0,
          candidatePageDigest: hash,
          sourceCandidateDigest: hash,
          sourceCandidateCount: 1,
          sourceProfileKey: hash,
          historicalRefDigest: hash,
          candidates: [
            { targetVideoId: "target", poolRank: 0, targetProfileKey: hash },
          ],
        },
      ],
      spanOffers: [],
    }
    await expect(submitEdgeAction(prisma, edge, guards)).rejects.toThrow(
      "Edge model differs from generation",
    )
    expect(guards.reserveBudget).not.toHaveBeenCalled()
  })
  it("refuses mismatched generation/attempt identity before database writes", async () => {
    const prisma = { $transaction: vi.fn() } as unknown as PrismaClient
    await expect(
      submitDurablePrecomputedRecommendation(
        prisma,
        {
          action: "start",
          generationId: "new-sol",
          protocolVersion: 4,
          modelId: "gpt-6.1-sol",
          promptVersion: "subscription-profile-edge-v1",
          inputMode: "content_only",
          inputDigest: hash,
          sourceSetDigest: hash,
          inputCutoff: now,
          expectedSourceCount: 1,
          executionAttempt: {
            attemptId: uuid,
            invocation: "start",
            accountRef: "operator-123",
            backend: "codex_chatgpt_subscription",
            billingBasis: "included_subscription",
            authMethod: "chatgpt",
            modelId: "gpt-6-astra",
            identityObservedAt: now,
            allowanceObservedAt: now,
            weeklyRemainingPercent: 70,
            fiveHour: { kind: "not_applicable" },
          },
        },
        "Bearer test",
      ),
    ).rejects.toThrow("matching supported model")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
