import { describe, expect, it, vi } from "vitest"

import { createContentProfilePersistence } from "./content-profile-client"
import type { ProfilePersistencePort } from "./content-profile-executor"

const registration: Parameters<ProfilePersistencePort["register"]>[0] = {
  action: "profile_register",
  generationId: "profile-client-fixture",
  generationInputDigest: "1".repeat(64),
  attemptId: "11111111-1111-4111-8111-111111111111",
  cacheKey: "2".repeat(64),
  videoId: "source",
  modelId: "gpt-6-astra",
  backend: "codex_chatgpt_subscription",
  promptVersion: "complete-profile-v1",
  schemaVersion: "profile-schema-v1",
  metadataDigest: "3".repeat(64),
  chunkDigest: "4".repeat(64),
  selectedTranscriptCount: 0,
  selectedChunkCount: 0,
  sourceTextBytes: 0,
  partDigests: [],
  coverageDigest: "5".repeat(64),
  kind: "metadata_only",
}
const call = {
  generationId: registration.generationId,
  generationInputDigest: registration.generationInputDigest,
  cacheKey: registration.cacheKey,
  attemptId: registration.attemptId,
  callId: "22222222-2222-4222-8222-222222222222",
  nodeKey: "6".repeat(64),
  stage: "map" as const,
  stagePromptVersion: "complete-profile-v1:map",
  inputDigest: "7".repeat(64),
  partIndex: 0,
}

describe("Admin content profile client", () => {
  it("refuses a ready reply belonging to a different generation", async () => {
    const client = createContentProfilePersistence(async () => ({
      generationId: "another-generation",
      cacheKey: registration.cacheKey,
      kind: "metadata_only",
      state: "ready",
      replay: false,
    }))
    await expect(client.register(registration)).rejects.toMatchObject({
      code: "profile_conflict",
    })
  })

  it("refuses status rows that omit whether a physical receipt was applied", async () => {
    const client = createContentProfilePersistence(async () => ({
      generationId: registration.generationId,
      cacheKey: registration.cacheKey,
      profile: {
        state: "in_progress",
        kind: "transcript",
        profileJson: null,
        finalCallId: null,
        coverageDigest: registration.coverageDigest,
      },
      calls: [
        {
          callId: "22222222-2222-4222-8222-222222222222",
          nodeKey: "6".repeat(64),
          stage: "map",
          inputDigest: "7".repeat(64),
          status: "pending",
          outputDigest: null,
          node: null,
        },
      ],
    }))
    await expect(
      client.status({
        action: "profile_status",
        generationId: registration.generationId,
        generationInputDigest: registration.generationInputDigest,
        cacheKey: registration.cacheKey,
      }),
    ).rejects.toMatchObject({ code: "profile_conflict" })
  })

  it("refuses a reservation response for a different physical call", async () => {
    const client = createContentProfilePersistence(async () => ({
      generationId: call.generationId,
      cacheKey: call.cacheKey,
      callId: "33333333-3333-4333-8333-333333333333",
      state: "pending",
      replay: false,
    }))
    await expect(
      client.callStart({
        ...call,
        action: "profile_call_start",
        startedAt: "2026-10-08T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "profile_conflict" })
  })

  it("preserves the distinction between a stored receipt and an applied node", async () => {
    const receipt = {
      generationId: call.generationId,
      cacheKey: call.cacheKey,
      callId: call.callId,
      state: "failed",
      receiptStored: true,
      nodeApplied: false,
      replay: true,
    }
    const client = createContentProfilePersistence(async () => receipt)
    expect(
      await client.callFinish({
        ...call,
        action: "profile_call_finish",
        status: "failed",
        usage: { inputTokens: 120, outputTokens: 0 },
        errorCode: "provider_unavailable",
        finishedAt: "2026-10-08T00:00:01.000Z",
      }),
    ).toEqual(receipt)
  })

  it("never retries a mutation when its response was lost", async () => {
    const failure = new Error("lost transport response")
    const ingest = vi.fn(async () => {
      throw failure
    })
    const client = createContentProfilePersistence(ingest)
    await expect(client.register(registration)).rejects.toBe(failure)
    expect(ingest).toHaveBeenCalledTimes(1)
  })

  it("refuses an oversized request before sending it to Admin", async () => {
    const ingest = vi.fn(async () => undefined)
    const client = createContentProfilePersistence(ingest)
    await expect(
      client.register({ ...registration, promptVersion: "x".repeat(65_536) }),
    ).rejects.toMatchObject({ code: "profile_invalid" })
    expect(ingest).not.toHaveBeenCalled()
  })

  it("does not expose an oversized untrusted response in its error", async () => {
    const untrusted = "private-response-".repeat(40_000)
    const client = createContentProfilePersistence(async () => untrusted)
    await expect(client.register(registration)).rejects.toMatchObject({
      code: "profile_conflict",
      message: "profile_conflict",
    })
  })
})
