import { expect, it } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import { streamCalendarPlan } from "./calendar-planner"
const frozen = {
  effective: "Suggest hope titles.",
  agentVersionId: "planner-v1",
  agentDigest: "a".repeat(64),
  blockVersionId: "planner-block-v1",
  blockDigest: "b".repeat(64),
  digest: "c".repeat(64),
}
const input = {
  calendarId: "calendar",
  version: 1,
  language: "english",
  slots: [
    {
      date: "2026-09-22",
      version: 0,
      packRevisionIds: ["pack"],
      weeklyTheme: "",
    },
  ],
  packs: [
    {
      revisionId: "pack",
      document: { title: "Hope", guidance: "Titles about hope", sources: [] },
    },
  ],
}
function modelFor(text: string) {
  let calls = 0
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      calls++
      expect(options.tools ?? []).toHaveLength(0)
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] })
            controller.enqueue({ type: "text-start", id: "text" })
            controller.enqueue({ type: "text-delta", id: "text", delta: text })
            controller.enqueue({ type: "text-end", id: "text" })
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            })
            controller.close()
          },
        }),
      }
    },
  })
  return { model, calls: () => calls }
}
it("returns admitted weekly themes without tools and attaches native provenance", async () => {
  const week = {
    startDate: "2026-09-28",
    theme: "A week of hope",
    packRevisionId: "pack",
    sourceIndices: [],
  }
  const fixture = modelFor(JSON.stringify({ items: [], weeks: [week] }))
  const result = await streamCalendarPlan({
    input: {
      ...input,
      slots: [],
      weeks: [{ startDate: week.startDate, packRevisionIds: ["pack"] }],
    },
    frozen,
    model: fixture.model,
    signal: new AbortController().signal,
  })
  expect(result.weeks).toEqual([week])
  expect(result.effectiveDigest).toBe(frozen.digest)
  expect(fixture.calls()).toBe(1)
})
it("uses a single tool-free native turn and attaches server-frozen provenance to suggestions", async () => {
  const output = {
    items: [
      {
        date: "2026-09-22",
        expectedVersion: 0,
        title: "Hope for today",
        theme: "Finding hope",
        packRevisionId: "pack",
        sourceIndices: [],
      },
    ],
  }
  const fixture = modelFor(JSON.stringify(output))
  const result = await streamCalendarPlan({
    input,
    frozen,
    model: fixture.model,
    signal: new AbortController().signal,
  })
  expect(result.items).toEqual(output.items)
  expect(result.instructions).toEqual([
    {
      agentVersionId: frozen.agentVersionId,
      blockVersionId: frozen.blockVersionId,
      digest: frozen.digest,
    },
  ])
  expect(fixture.calls()).toBe(1)
})
it("rejects script fields and off-admission dates without a repair/provider retry", async () => {
  for (const item of [
    {
      date: "2026-09-22",
      expectedVersion: 0,
      title: "Hope",
      theme: "Hope",
      packRevisionId: "pack",
      sourceIndices: [],
      script: "Generate this",
    },
    {
      date: "2026-09-08",
      expectedVersion: 0,
      title: "Hope",
      theme: "Hope",
      packRevisionId: "pack",
      sourceIndices: [],
    },
    {
      date: "2026-09-22",
      expectedVersion: 0,
      title: "Hope",
      theme: "Hope",
      packRevisionId: "pack",
      sourceIndices: [0],
    },
  ]) {
    const fixture = modelFor(JSON.stringify({ items: [item] }))
    await expect(
      streamCalendarPlan({
        input,
        frozen,
        model: fixture.model,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow()
    expect(fixture.calls()).toBe(1)
  }
})

it("does not call a model when no admitted slot has an assigned or default pack", async () => {
  const fixture = modelFor('{"items":[]}')
  const result = await streamCalendarPlan({
    input: {
      ...input,
      packs: [],
      slots: input.slots.map((slot) => ({ ...slot, packRevisionIds: [] })),
    },
    frozen,
    model: fixture.model,
    signal: new AbortController().signal,
  })
  expect(result.items).toEqual([])
  expect(fixture.calls()).toBe(0)
})
