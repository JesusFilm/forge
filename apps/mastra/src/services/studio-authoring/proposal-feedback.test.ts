import { expect, it } from "vitest"
import { studioHash } from "@forge/studio-server"
import { proposalFeedback } from "./proposal-feedback"
const command = {
  projectId: "project",
  expectedRevision: 1,
  idempotencyKey: "key",
  operations: [{ kind: "set-metadata" as const, title: "Title" }],
}
const feedback = {
  valid: true,
  projectId: "project",
  revision: 1,
  effectiveSpeech: {
    version: 1,
    projectId: "project",
    baseRevision: 1,
    language: "en",
    operationsDigest: studioHash(command.operations),
    scriptDigest: "a".repeat(64),
    speechItemCount: 1,
    spokenItemCount: 1,
    suppressedItemCount: 0,
    emptyItemCount: 0,
    exactTextUtf8Bytes: 4,
    view: "inline",
    complete: true,
    items: [
      {
        itemId: "text",
        trackId: "track",
        startFrame: 0,
        durationInFrames: 30,
        role: "custom",
        suppressed: false,
        text: " hi ",
        spoken: true,
      },
    ],
  },
}
it("returns exact canonical data in a bounded native envelope without echoing QA", () => {
  const result = proposalFeedback(
    { ...feedback, quality: { coverage: [], findings: [] } },
    command,
  )
  expect(result).toEqual({
    proposed: true,
    applied: false,
    validation: feedback,
  })
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32768)
})
it("rejects mismatched, malformed and arbitrary successful envelopes without exposing data", () => {
  for (const raw of [
    null,
    { ...feedback, projectId: "another" },
    { ...feedback, revision: 2 },
    {
      ...feedback,
      effectiveSpeech: {
        ...feedback.effectiveSpeech,
        operationsDigest: "b".repeat(64),
      },
    },
    {
      ...feedback,
      effectiveSpeech: { ...feedback.effectiveSpeech, complete: false },
    },
    { ...feedback, privateData: "do not disclose" },
  ])
    expect(() => proposalFeedback(raw, command)).toThrow(
      "Canonical proposal feedback rejected",
    )
})

it("retains an explicit unavailable result and rejects misleading partial or oversized inline data", () => {
  const { items, ...header } = feedback.effectiveSpeech
  expect(items).toHaveLength(1)
  const unavailable = {
    ...header,
    view: "unavailable",
    complete: false,
    reason: "INLINE_BYTE_LIMIT",
    inlineByteLimit: 30720,
  }
  const result = proposalFeedback(
    { ...feedback, effectiveSpeech: unavailable },
    command,
  )
  expect(result.validation.effectiveSpeech).toEqual(unavailable)
  expect(result.validation.effectiveSpeech).not.toHaveProperty("items")
  for (const effectiveSpeech of [
    { ...unavailable, items: [] },
    { ...feedback.effectiveSpeech, items: [] },
    { ...feedback.effectiveSpeech, baseRevision: 2 },
    { ...feedback.effectiveSpeech, projectId: "other" },
    {
      ...feedback.effectiveSpeech,
      items: [
        { ...feedback.effectiveSpeech.items[0], text: "private".repeat(10000) },
      ],
    },
  ])
    expect(() =>
      proposalFeedback({ ...feedback, effectiveSpeech }, command),
    ).toThrow("Canonical proposal feedback rejected")
})

it("measures the final native envelope for a maximum inline transcript and long identifiers", () => {
  const longCommand = { ...command, projectId: "p".repeat(128) }
  const effectiveSpeech = {
    ...feedback.effectiveSpeech,
    projectId: longCommand.projectId,
    speechItemCount: 4,
    spokenItemCount: 4,
    exactTextUtf8Bytes: 26000,
    items: Array.from({ length: 4 }, (_, index) => ({
      ...feedback.effectiveSpeech.items[0],
      itemId: `${index}${"i".repeat(127)}`,
      trackId: "t".repeat(128),
      text: "x".repeat(6500),
    })),
  }
  const padding = 30720 - Buffer.byteLength(JSON.stringify(effectiveSpeech))
  for (let index = 0; index < padding; index++)
    effectiveSpeech.items[index % 4].text += "x"
  effectiveSpeech.exactTextUtf8Bytes += padding
  expect(Buffer.byteLength(JSON.stringify(effectiveSpeech))).toBe(30720)
  const result = proposalFeedback(
    { ...feedback, projectId: longCommand.projectId, effectiveSpeech },
    longCommand,
  )
  expect(result.validation.effectiveSpeech.view).toBe("inline")
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32768)
})
