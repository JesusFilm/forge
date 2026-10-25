/**
 * U1 verification — confirms `@mastra/core@1.33.1`'s scores-store
 * surface matches the `chat-thumb-rating` contract this module
 * encodes. Round-trips a saveScore + listScoresByScorerId against
 * `InMemoryStore` so a future bump that breaks `SaveScorePayload` or
 * the scores-domain accessor fails this test first instead of
 * surfacing at runtime in production.
 *
 * Uses the real `MastraCompositeStore` surface; no hand-rolled mocks.
 */

import { describe, expect, it } from "vitest"
import { InMemoryStore } from "@mastra/core/storage"

import {
  CHAT_RATING_ENTITY_KIND,
  CHAT_RATING_SCORE_DOWN,
  CHAT_RATING_SCORE_UP,
  CHAT_THUMB_RATING_SCORER_ID,
  CHAT_THUMB_RATING_SCORER_NAME,
  chatThumbRatingScorerDescriptor,
} from "./chat-thumb-rating"

describe("chat-thumb-rating scorer module", () => {
  it("exports stable id + descriptor constants", () => {
    expect(CHAT_THUMB_RATING_SCORER_ID).toBe("chat-thumb-rating")
    expect(CHAT_THUMB_RATING_SCORER_NAME).toBe("Chat thumb rating")
    expect(chatThumbRatingScorerDescriptor).toEqual({
      id: "chat-thumb-rating",
      name: "Chat thumb rating",
    })
    expect(CHAT_RATING_ENTITY_KIND).toBe("experience_chat_message")
    expect(CHAT_RATING_SCORE_UP).toBe(1)
    expect(CHAT_RATING_SCORE_DOWN).toBe(0)
  })

  it("round-trips a saveScore via the composite-store scores domain", async () => {
    const storage = new InMemoryStore()
    const scores = await storage.getStore("scores")
    if (!scores) throw new Error("scores domain unavailable on InMemoryStore")

    const messageId = "msg-cuid-1"
    const raterUserId = "user-cuid-1"
    const producedBy = "multi-step-draft"
    const runId = "workflow-run-1"

    const saveResult = await scores.saveScore({
      scorerId: CHAT_THUMB_RATING_SCORER_ID,
      scorer: { ...chatThumbRatingScorerDescriptor },
      source: "LIVE",
      runId,
      entityId: messageId,
      entity: { messageId, producedBy },
      score: CHAT_RATING_SCORE_UP,
      output: { messageId },
      metadata: {
        raterUserId,
        comment: "great draft",
        producedBy,
        entityKind: CHAT_RATING_ENTITY_KIND,
      },
    })

    expect(saveResult.score.scorerId).toBe(CHAT_THUMB_RATING_SCORER_ID)
    expect(saveResult.score.score).toBe(1)
    expect(saveResult.score.entityId).toBe(messageId)
    expect(saveResult.score.runId).toBe(runId)
  })

  it("listScoresByScorerId returns every record for the scorer", async () => {
    const storage = new InMemoryStore()
    const scores = await storage.getStore("scores")
    if (!scores) throw new Error("scores domain unavailable")

    const base = {
      scorerId: CHAT_THUMB_RATING_SCORER_ID,
      scorer: { ...chatThumbRatingScorerDescriptor },
      source: "LIVE" as const,
      entity: { messageId: "m" },
      output: {},
      metadata: { entityKind: CHAT_RATING_ENTITY_KIND },
    }
    await scores.saveScore({
      ...base,
      runId: "r1",
      entityId: "m1",
      entity: { messageId: "m1" },
      score: CHAT_RATING_SCORE_UP,
    })
    await scores.saveScore({
      ...base,
      runId: "r2",
      entityId: "m2",
      entity: { messageId: "m2" },
      score: CHAT_RATING_SCORE_DOWN,
    })

    const listed = await scores.listScoresByScorerId({
      scorerId: CHAT_THUMB_RATING_SCORER_ID,
      pagination: { page: 0, perPage: 100 },
    })

    expect(listed.scores).toHaveLength(2)
    expect(listed.scores.map((s) => s.score).sort()).toEqual([0, 1])
  })

  it("listScoresByScorerId+entityId filters to a single message (production read path)", async () => {
    const storage = new InMemoryStore()
    const scores = await storage.getStore("scores")
    if (!scores) throw new Error("scores domain unavailable")

    // Two ratings on different messages.
    for (const [entityId, score] of [
      ["m1", CHAT_RATING_SCORE_UP],
      ["m2", CHAT_RATING_SCORE_DOWN],
    ] as const) {
      await scores.saveScore({
        scorerId: CHAT_THUMB_RATING_SCORER_ID,
        scorer: { ...chatThumbRatingScorerDescriptor },
        source: "LIVE",
        runId: entityId,
        entityId,
        entity: { messageId: entityId },
        score,
        output: {},
        metadata: { entityKind: CHAT_RATING_ENTITY_KIND },
      })
    }

    // `listScoresByEntityId` requires Mastra's closed `entityType`
    // enum (AGENT | WORKFLOW | ...) which we can't persist on these
    // records. The production read path uses `listScoresByScorerId`
    // with an optional `entityId` filter — same outcome, no
    // entityType dependency.
    const onlyM1 = await scores.listScoresByScorerId({
      scorerId: CHAT_THUMB_RATING_SCORER_ID,
      entityId: "m1",
      pagination: { page: 0, perPage: 100 },
    })

    expect(onlyM1.scores.map((s) => s.entityId)).toEqual(["m1"])
  })

  it("stores metadata.cleared on clear-rating records (latest-wins clear semantics)", async () => {
    const storage = new InMemoryStore()
    const scores = await storage.getStore("scores")
    if (!scores) throw new Error("scores domain unavailable")

    const baseEntityId = "msg-clear-1"
    const raterUserId = "user-rater-1"
    const common = {
      scorerId: CHAT_THUMB_RATING_SCORER_ID,
      scorer: { ...chatThumbRatingScorerDescriptor },
      source: "LIVE" as const,
      entityId: baseEntityId,
      entity: { messageId: baseEntityId },
      output: {},
    }
    // 👍 then cleared.
    await scores.saveScore({
      ...common,
      runId: "r-thumb-up",
      score: CHAT_RATING_SCORE_UP,
      metadata: {
        raterUserId,
        entityKind: CHAT_RATING_ENTITY_KIND,
      },
    })
    await scores.saveScore({
      ...common,
      runId: "r-cleared",
      // Score field must be a number per saveScorePayloadSchema; the
      // sentinel for "cleared" lives in metadata, not in the score.
      score: 0,
      metadata: {
        raterUserId,
        entityKind: CHAT_RATING_ENTITY_KIND,
        cleared: true,
      },
    })

    const all = await scores.listScoresByScorerId({
      scorerId: CHAT_THUMB_RATING_SCORER_ID,
      entityId: baseEntityId,
      pagination: { page: 0, perPage: 100 },
    })
    expect(all.scores).toHaveLength(2)
    // Both writes happen in the same tick, so `createdAt` may tie.
    // What matters for the rating-service contract is that the
    // cleared record carries `metadata.cleared === true` (the read
    // path resolves "current" by picking the latest of these — see
    // chat-rating.service in U4).
    const clearedRecord = all.scores.find(
      (s) =>
        (s.metadata as { cleared?: boolean } | undefined)?.cleared === true,
    )
    const thumbUpRecord = all.scores.find(
      (s) =>
        (s.metadata as { cleared?: boolean } | undefined)?.cleared !== true,
    )
    expect(clearedRecord).toBeDefined()
    expect(thumbUpRecord).toBeDefined()
    expect(clearedRecord!.score).toBe(0)
    expect(thumbUpRecord!.score).toBe(1)
  })
})
