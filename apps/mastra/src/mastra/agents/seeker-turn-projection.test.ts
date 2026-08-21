/**
 * Colocated suite for the shared turn-attachment projection — created with
 * feat-366's `followUps` addition. The sources/video halves predate this file
 * and stay covered by the two caller suites (`seeker-route.test.ts`,
 * `ai-chat-history-replay-attachments.test.ts`); these cases pin the
 * follow-ups resolution both callers now share (KTD3: one projection is the
 * single re-validation point for the live and replay paths).
 */

import { describe, expect, it } from "vitest"

import {
  FOLLOW_UPS_QUESTION_MAX_UNITS,
  SUGGEST_FOLLOW_UPS_TOOL_NAME,
} from "../seeker-follow-ups"

import {
  resolveStoredFollowUps,
  resolveTurnAttachments,
  type SeekerToolChunk,
} from "./seeker-turn-projection"

function followUpsChunk(result: unknown): SeekerToolChunk {
  return { toolName: SUGGEST_FOLLOW_UPS_TOOL_NAME, result }
}

describe("resolveStoredFollowUps (KTD3)", () => {
  it("resolves questions from the last suggestFollowUps chunk — last wins", () => {
    const chunks = [
      followUpsChunk({ questions: ["Stale question?"] }),
      followUpsChunk({ questions: ["Fresh question?", "Second fresh?"] }),
    ]
    expect(resolveStoredFollowUps(chunks)).toEqual([
      "Fresh question?",
      "Second fresh?",
    ])
  })

  it("re-validates through the shared projection on every read (Covers AE6)", () => {
    const chunks = [
      followUpsChunk({
        questions: [
          "w".repeat(FOLLOW_UPS_QUESTION_MAX_UNITS + 30),
          "bad\u0000ctl",
          "Why pray?",
          "why PRAY?",
        ],
      }),
    ]
    // Offending items DROP — never repaired, truncated, or errored.
    expect(resolveStoredFollowUps(chunks)).toEqual(["Why pray?"])
  })

  it("returns empty for junk chunk shapes, total", () => {
    for (const junk of [
      undefined,
      null,
      "error string",
      { questions: "not an array" },
      { notQuestions: ["x"] },
    ]) {
      expect(resolveStoredFollowUps([followUpsChunk(junk)])).toEqual([])
    }
    expect(resolveStoredFollowUps([])).toEqual([])
  })
})

describe("resolveTurnAttachments — followUps integration", () => {
  it("carries followUps beside sources/grounded in one pass", () => {
    const attachments = resolveTurnAttachments([
      {
        toolName: "retrieveAnswer",
        result: { status: "ok", sources: [] },
      },
      followUpsChunk({ questions: ["Why pray?"] }),
    ])
    expect(attachments.grounded).toBe(true)
    expect(attachments.followUps).toEqual(["Why pray?"])
  })

  it("yields empty followUps on a turn with no suggestFollowUps chunk", () => {
    const attachments = resolveTurnAttachments([
      { toolName: "retrieveAnswer", result: { status: "ok", sources: [] } },
    ])
    expect(attachments.followUps).toEqual([])
  })

  it("never counts a suggestFollowUps chunk as video-tool use (E7 signal untouched)", () => {
    const attachments = resolveTurnAttachments([
      followUpsChunk({ questions: ["Why pray?"] }),
    ])
    expect(attachments.ungroundedVideoTurn).toBe(false)
  })
})
