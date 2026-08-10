/**
 * Replay attachment projection (feat-329, plan U4): the stored-part adapter,
 * turn association, and the replay-only byte-cap enforcement.
 *
 * The mocked fixtures here prove BRANCH SHAPE. The production CONTRACT — that
 * a real store actually persists tool name + result in the shape these
 * fixtures assume — is pinned by the real-memory round trip in
 * `ai-chat-history-route.test.ts`; neither substitutes for the other.
 */

import { readFileSync } from "node:fs"

import { describe, expect, it, vi } from "vitest"

import {
  AI_CHAT_HISTORY_ATTACHMENT_FIELD_CAP_CHARS,
  AI_CHAT_HISTORY_MAX_SOURCES_PER_MESSAGE,
  AI_CHAT_HISTORY_REPLAY_MESSAGE_LIMIT,
  AI_CHAT_HISTORY_SOURCE_SNIPPET_CAP_CHARS,
  AI_CHAT_HISTORY_SOURCE_URL_CAP_CHARS,
  AI_CHAT_HISTORY_TEXT_CAP_CHARS,
  AI_CHAT_HISTORY_WORST_CASE_THREAD_BYTES,
  CHAT_HISTORY_THREAD_BYTE_CAP,
  handleAiChatHistoryReplayRequest,
  type AiChatHistoryMemory,
  type AiChatHistoryWireMessage,
} from "./ai-chat-history-route"

const RESOURCE = "user:sub-1"
const THREAD = "thread-1"

function toolPart(toolName: string, result: unknown): unknown {
  // The shape a real Memory store persists (observed 2026-08-04, @mastra/core
  // 1.55.0 / @mastra/memory 1.24.0) — see the real-memory smoke.
  return {
    type: "tool-invocation",
    toolInvocation: {
      state: "result",
      toolCallId: "c1",
      args: {},
      toolName,
      result,
    },
  }
}

function textPart(text: string): unknown {
  return { type: "text", text }
}

function message(
  id: string,
  role: "user" | "assistant",
  parts: unknown[],
): unknown {
  return {
    id,
    role,
    createdAt: "2026-08-04T12:00:00.000Z",
    content: { format: 2, parts },
  }
}

const VIDEO_ROW = {
  videoId: "vid-1",
  title: "Jesus calms the storm",
  slug: "jesus-calms-the-storm",
  playbackId: "abcdefgh12345678",
  durationSeconds: 120,
  languageSlug: "english",
  availability: { kind: "target_audio" },
}

function source(overrides: Record<string, unknown> = {}): unknown {
  return {
    sourceName: "Source A",
    title: "Title A",
    url: "https://example.org/a",
    score: 0.9,
    text: "snippet",
    ...overrides,
  }
}

function memoryWith(messages: unknown[]): AiChatHistoryMemory {
  return {
    listThreads: vi.fn(),
    getThreadById: vi.fn(async () => ({ resourceId: RESOURCE })),
    recall: vi.fn(async () => ({ messages })),
  } as unknown as AiChatHistoryMemory
}

async function replay(
  messages: unknown[],
): Promise<AiChatHistoryWireMessage[]> {
  const outcome = await handleAiChatHistoryReplayRequest({
    authHeader: "Bearer k1",
    readJson: async () => ({ resourceId: RESOURCE, threadId: THREAD }),
    getEnabled: () => true,
    getServiceKeys: () => ["k1"],
    getMemory: () => memoryWith(messages),
  })
  expect(outcome.status).toBe(200)
  return (outcome.body as { messages: AiChatHistoryWireMessage[] }).messages
}

describe("replay attachments — extraction from stored tool parts", () => {
  it("replays the video a searchVideos + featureVideo turn featured", async () => {
    const messages = await replay([
      message("m1", "user", [textPart("show me a storm video")]),
      message("m2", "assistant", [
        toolPart("searchVideos", { videos: [VIDEO_ROW] }),
        toolPart("featureVideo", { videoId: "vid-1" }),
        textPart("Here is one."),
      ]),
    ])

    expect(messages).toHaveLength(2)
    // toStrictEqual: an extra field on the video payload is a leak, not a bonus.
    expect(messages[1].video).toStrictEqual({
      videoId: "vid-1",
      title: "Jesus calms the storm",
      slug: "jesus-calms-the-storm",
      playbackId: "abcdefgh12345678",
      durationSeconds: 120,
      languageSlug: "english",
    })
  })

  it("replays the projected sources a retrieveAnswer turn cited", async () => {
    const messages = await replay([
      message("m1", "user", [textPart("who is jesus")]),
      message("m2", "assistant", [
        toolPart("retrieveAnswer", { status: "ok", sources: [source()] }),
        textPart("An answer."),
      ]),
    ])

    expect(messages[1].sources).toStrictEqual([
      {
        sourceName: "Source A",
        title: "Title A",
        url: "https://example.org/a",
        score: 0.9,
        snippet: "snippet",
      },
    ])
  })

  it("carries NEITHER field on a turn with no tool parts", async () => {
    const messages = await replay([
      message("m1", "user", [textPart("hello")]),
      message("m2", "assistant", [textPart("hi")]),
    ])

    expect(messages[1]).toStrictEqual({
      id: "m2",
      role: "assistant",
      text: "hi",
      createdAt: "2026-08-04T12:00:00.000Z",
    })
  })

  it("replays no video when the stored declaration was invalid (same ladder)", async () => {
    const messages = await replay([
      message("m1", "user", [textPart("show me")]),
      message("m2", "assistant", [
        toolPart("searchVideos", { videos: [VIDEO_ROW] }),
        toolPart("featureVideo", { videoId: "never-searched" }),
        textPart("Here."),
      ]),
    ])

    expect(messages[1].video).toBeUndefined()
  })

  it("drops a stored row whose slug no longer passes the D9 gate", async () => {
    // A stored row was written by whatever gates shipped the day it ran, so the
    // replay projection re-validates rather than trusting the store.
    const messages = await replay([
      message("m1", "user", [textPart("show me")]),
      message("m2", "assistant", [
        toolPart("searchVideos", {
          videos: [{ ...VIDEO_ROW, slug: "La-Búsqueda" }],
        }),
        toolPart("featureVideo", { videoId: "vid-1" }),
        textPart("Here."),
      ]),
    ])

    expect(messages[1].video).toBeUndefined()
  })

  it("tolerates a stored tool result that is an error STRING, not an object", async () => {
    // A tool whose execute threw persists its error message as the result —
    // observed on the real store, not hypothetical.
    const messages = await replay([
      message("m1", "user", [textPart("show me")]),
      message("m2", "assistant", [
        toolPart("searchVideos", "Cannot read properties of undefined"),
        toolPart("featureVideo", "Cannot read properties of undefined"),
        textPart("Here."),
      ]),
    ])

    expect(messages[1].video).toBeUndefined()
    expect(messages[1].sources).toBeUndefined()
  })

  it("stays SILENT — replay never emits the live path's declaration log", async () => {
    // One thread open re-resolves every stored turn; repeating rejections
    // already logged when each turn ran would be a burst of stale history.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await replay([
        message("m1", "user", [textPart("show me")]),
        message("m2", "assistant", [
          toolPart("searchVideos", { videos: [VIDEO_ROW] }),
          toolPart("featureVideo", { videoId: "never-searched" }),
          textPart("Here."),
        ]),
      ])
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe("replay attachments — turn association (plan U4)", () => {
  it("attaches parts from a SEPARATE tool-only message to the text-bearing one", async () => {
    // The discriminating fixture: a single-message fixture is vacuous here,
    // because it cannot distinguish "attach to this message" from "attach to
    // the turn's last text-bearing message".
    const messages = await replay([
      message("m1", "user", [textPart("show me a storm video")]),
      message("m2", "assistant", [
        toolPart("searchVideos", { videos: [VIDEO_ROW] }),
        toolPart("featureVideo", { videoId: "vid-1" }),
        toolPart("retrieveAnswer", { status: "ok", sources: [source()] }),
      ]),
      message("m3", "assistant", [textPart("Here is one.")]),
    ])

    // The tool-only message carries no text and is dropped by the client; the
    // attachments must land on the message the user actually sees.
    const textBearing = messages.find((m) => m.id === "m3")
    expect(textBearing?.video?.videoId).toBe("vid-1")
    expect(textBearing?.sources).toHaveLength(1)
    expect(messages.find((m) => m.id === "m2")?.video).toBeUndefined()
    expect(messages.find((m) => m.id === "m2")?.sources).toBeUndefined()
  })

  it("attaches to the LAST text-bearing assistant message of the turn", async () => {
    const messages = await replay([
      message("m1", "user", [textPart("show me")]),
      message("m2", "assistant", [textPart("Let me look.")]),
      message("m3", "assistant", [
        toolPart("searchVideos", { videos: [VIDEO_ROW] }),
        toolPart("featureVideo", { videoId: "vid-1" }),
      ]),
      message("m4", "assistant", [textPart("Here is one.")]),
    ])

    expect(messages.find((m) => m.id === "m4")?.video?.videoId).toBe("vid-1")
    expect(messages.find((m) => m.id === "m2")?.video).toBeUndefined()
  })

  it("scopes attachments to their own turn — a later turn never inherits them", async () => {
    const messages = await replay([
      message("m1", "user", [textPart("show me")]),
      message("m2", "assistant", [
        toolPart("searchVideos", { videos: [VIDEO_ROW] }),
        toolPart("featureVideo", { videoId: "vid-1" }),
        textPart("Here is one."),
      ]),
      message("m3", "user", [textPart("thanks")]),
      message("m4", "assistant", [textPart("You are welcome.")]),
    ])

    expect(messages.find((m) => m.id === "m2")?.video?.videoId).toBe("vid-1")
    expect(messages.find((m) => m.id === "m4")?.video).toBeUndefined()
  })

  it("keeps chunks whose carrier message the projection REJECTED", async () => {
    // The rejected row cannot render, but its tool parts are the turn's only
    // copy of the attachment — discarding them with the row would silently
    // lose the whole turn's video.
    const messages = await replay([
      message("m1", "user", [textPart("show me")]),
      // Missing id => projectStoredMessage rejects the message itself.
      {
        role: "assistant",
        createdAt: "2026-08-04T12:00:00.000Z",
        content: {
          format: 2,
          parts: [
            toolPart("searchVideos", { videos: [VIDEO_ROW] }),
            toolPart("featureVideo", { videoId: "vid-1" }),
          ],
        },
      },
      message("m3", "assistant", [textPart("Here is one.")]),
    ])

    expect(messages.map((m) => m.id)).toEqual(["m1", "m3"])
    expect(messages.find((m) => m.id === "m3")?.video?.videoId).toBe("vid-1")
  })

  it("ignores a stored tool part with no result (an in-flight call)", async () => {
    const messages = await replay([
      message("m1", "user", [textPart("show me")]),
      message("m2", "assistant", [
        {
          type: "tool-invocation",
          toolInvocation: {
            state: "call",
            toolCallId: "c1",
            args: {},
            toolName: "searchVideos",
          },
        },
        textPart("Here."),
      ]),
    ])

    expect(messages[1].video).toBeUndefined()
    expect(messages[1].sources).toBeUndefined()
  })

  it("closes the turn on a user row the projection REJECTED", async () => {
    // Turn boundaries must not depend on projection succeeding. A rejected user
    // row (missing id here) is dropped from the transcript, but if it does not
    // close the run the two turns merge and the FIRST turn's video lands on the
    // SECOND turn's answer — a visible misattribution to a message that never
    // featured it.
    const messages = await replay([
      message("u1", "user", [textPart("show me a storm video")]),
      message("a1", "assistant", [
        toolPart("searchVideos", { videos: [VIDEO_ROW] }),
        toolPart("featureVideo", { videoId: "vid-1" }),
        textPart("Here is one."),
      ]),
      // A malformed stored user row: role intact, id missing.
      {
        role: "user",
        createdAt: "2026-08-04T12:00:00.000Z",
        content: { format: 2, parts: [textPart("thanks")] },
      },
      message("a2", "assistant", [textPart("You are welcome.")]),
    ])

    expect(messages.map((m) => m.id)).toEqual(["u1", "a1", "a2"])
    expect(messages.find((m) => m.id === "a1")?.video?.videoId).toBe("vid-1")
    expect(messages.find((m) => m.id === "a2")?.video).toBeUndefined()
    expect(messages.find((m) => m.id === "a2")?.sources).toBeUndefined()
  })

  it("closes the turn on a row whose stored role is unreadable", async () => {
    // A row whose `role` is absent or non-string reads as "not assistant" and
    // therefore CLOSES the run. The attachment is then dropped (a1 has tool
    // parts but no text of its own) rather than sliding onto a2 — loss, not
    // misattribution. That is the deliberate direction: showing a video or a
    // citation on a message that never produced it is worse than showing none.
    const messages = await replay([
      message("u1", "user", [textPart("show me a storm video")]),
      message("a1", "assistant", [
        toolPart("searchVideos", { videos: [VIDEO_ROW] }),
        toolPart("featureVideo", { videoId: "vid-1" }),
      ]),
      // id present, role missing entirely.
      {
        id: "bad-role",
        createdAt: "2026-08-04T12:00:00.000Z",
        content: { format: 2, parts: [textPart("thanks")] },
      },
      message("a2", "assistant", [textPart("Here is one.")]),
    ])

    expect(messages.map((m) => m.id)).toEqual(["u1", "a1", "a2"])
    expect(messages.find((m) => m.id === "a2")?.video).toBeUndefined()
    expect(messages.find((m) => m.id === "a2")?.sources).toBeUndefined()
  })

  it("closes the turn on a system or signal row between turns", async () => {
    // The reachable end of the range: the store's role space is not just
    // user/assistant, and these rows are already known to come back from it.
    // Allowlisting `role === "user"` as the only boundary let them merge two
    // turns; citations are the worse half, since a replayed ungrounded answer
    // would render someone else's sources.
    for (const role of ["system", "signal"]) {
      const messages = await replay([
        message("u1", "user", [textPart("who is jesus")]),
        message("a1", "assistant", [
          toolPart("retrieveAnswer", { status: "ok", sources: [source()] }),
          textPart("An answer."),
        ]),
        {
          id: `x-${role}`,
          role,
          createdAt: "2026-08-04T12:00:00.000Z",
          content: { format: 2, parts: [textPart("noise")] },
        },
        message("a2", "assistant", [textPart("You are welcome.")]),
      ])

      expect(messages.find((m) => m.id === "a1")?.sources).toHaveLength(1)
      expect(messages.find((m) => m.id === "a2")?.sources).toBeUndefined()
    }
  })

  it("tolerates a non-object entry in the recalled messages array", async () => {
    const messages = await replay([
      message("u1", "user", [textPart("show me")]),
      null,
      "not-a-message",
      message("a1", "assistant", [
        toolPart("searchVideos", { videos: [VIDEO_ROW] }),
        toolPart("featureVideo", { videoId: "vid-1" }),
        textPart("Here is one."),
      ]),
    ])

    expect(messages.map((m) => m.id)).toEqual(["u1", "a1"])
    expect(messages.find((m) => m.id === "a1")?.video?.videoId).toBe("vid-1")
  })

  it("drops the attachments entirely when the turn has no text-bearing message", async () => {
    const messages = await replay([
      message("m1", "user", [textPart("show me")]),
      message("m2", "assistant", [
        toolPart("searchVideos", { videos: [VIDEO_ROW] }),
        toolPart("featureVideo", { videoId: "vid-1" }),
      ]),
    ])

    expect(messages.find((m) => m.id === "m2")?.video).toBeUndefined()
  })
})

describe("replay attachments — byte-cap ENFORCEMENT (plan U4)", () => {
  it("truncates to at most AI_CHAT_HISTORY_MAX_SOURCES_PER_MESSAGE sources", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      source({ url: `https://example.org/${i}`, sourceName: `Source ${i}` }),
    )
    const messages = await replay([
      message("m1", "user", [textPart("q")]),
      message("m2", "assistant", [
        toolPart("retrieveAnswer", { status: "ok", sources: many }),
        textPart("a"),
      ]),
    ])

    expect(messages[1].sources).toHaveLength(
      AI_CHAT_HISTORY_MAX_SOURCES_PER_MESSAGE,
    )
    // Deterministic: the FIRST N, in stored order — never a sample.
    expect(messages[1].sources?.[0].sourceName).toBe("Source 0")
    expect(messages[1].sources?.at(-1)?.sourceName).toBe(
      `Source ${AI_CHAT_HISTORY_MAX_SOURCES_PER_MESSAGE - 1}`,
    )
  })

  it("truncates each snippet to AI_CHAT_HISTORY_SOURCE_SNIPPET_CAP_CHARS units", async () => {
    const long = "あ".repeat(AI_CHAT_HISTORY_SOURCE_SNIPPET_CAP_CHARS * 3)
    const messages = await replay([
      message("m1", "user", [textPart("q")]),
      message("m2", "assistant", [
        toolPart("retrieveAnswer", {
          status: "ok",
          sources: [source({ text: long })],
        }),
        textPart("a"),
      ]),
    ])

    expect(messages[1].sources?.[0].snippet).toHaveLength(
      AI_CHAT_HISTORY_SOURCE_SNIPPET_CAP_CHARS,
    )
  })

  it("leaves an already-small source set untouched", async () => {
    const messages = await replay([
      message("m1", "user", [textPart("q")]),
      message("m2", "assistant", [
        toolPart("retrieveAnswer", {
          status: "ok",
          sources: [source({ text: "short" })],
        }),
        textPart("a"),
      ]),
    ])

    expect(messages[1].sources).toHaveLength(1)
    expect(messages[1].sources?.[0].snippet).toBe("short")
  })

  it("keeps the derived worst case strictly under the consumer's 8 MiB cap", async () => {
    expect(AI_CHAT_HISTORY_WORST_CASE_THREAD_BYTES).toBeLessThan(
      CHAT_HISTORY_THREAD_BYTE_CAP,
    )
  })

  it("MEASURES a maximal serialized thread against the cap", async () => {
    // The derivation above is a computation over the same constants that
    // define it, so on its own it can only catch a RAISED bound — never a
    // field nobody counted. This one serializes the real emitted body, so an
    // uncounted or uncapped field fails here instead of shipping. That is the
    // whole difference between a budget and a wish: an over-cap thread is not
    // a truncated render, it is a 502 that lands replay in `failed` and then
    // blocks every send into the conversation (R22) — permanently unusable.
    const wide = "あ" // 3 UTF-8 bytes per UTF-16 unit — the worst-case script
    const overCap = (units: number) => wide.repeat(units)

    const stored = Array.from({ length: 100 }, (_, turn) => [
      message(`u${turn}`, "user", [
        textPart(overCap(AI_CHAT_HISTORY_TEXT_CAP_CHARS * 2)),
      ]),
      message(`a${turn}`, "assistant", [
        toolPart("retrieveAnswer", {
          status: "ok",
          // Over every bound, on every field the projection must cap.
          sources: Array.from({ length: 20 }, (_, i) =>
            source({
              sourceName: overCap(4_000),
              title: overCap(4_000),
              url: `https://example.org/${"a".repeat(150)}/${i}`,
              text: overCap(AI_CHAT_HISTORY_SOURCE_SNIPPET_CAP_CHARS * 4),
            }),
          ),
        }),
        toolPart("searchVideos", {
          videos: [{ ...VIDEO_ROW, title: overCap(4_000) }],
        }),
        toolPart("featureVideo", { videoId: "vid-1" }),
        textPart(overCap(AI_CHAT_HISTORY_TEXT_CAP_CHARS * 2)),
      ]),
    ]).flat()

    const messages = await replay(stored)
    expect(messages).toHaveLength(AI_CHAT_HISTORY_REPLAY_MESSAGE_LIMIT)

    const bytes = Buffer.byteLength(JSON.stringify({ messages }), "utf8")
    expect(bytes).toBeLessThan(CHAT_HISTORY_THREAD_BYTE_CAP)
    // ...and inside the budget the constants claim, so the derivation stays
    // an honest description of what the projection actually emits.
    expect(bytes).toBeLessThanOrEqual(AI_CHAT_HISTORY_WORST_CASE_THREAD_BYTES)
  })

  it("caps every variable-length attachment field, not just the snippet", async () => {
    // A within-bound url, so this asserts TRUNCATION of the display strings —
    // the url's own over-bound behavior is drop, covered separately below.
    const long = "あ".repeat(4_000)
    const messages = await replay([
      message("m1", "user", [textPart("q")]),
      message("m2", "assistant", [
        toolPart("retrieveAnswer", {
          status: "ok",
          sources: [
            source({
              sourceName: long,
              title: long,
              url: "https://example.org/within-bound",
            }),
          ],
        }),
        toolPart("searchVideos", {
          videos: [{ ...VIDEO_ROW, title: long }],
        }),
        toolPart("featureVideo", { videoId: "vid-1" }),
        textPart("a"),
      ]),
    ])

    const [projected] = messages[1].sources ?? []
    expect(projected.sourceName).toHaveLength(
      AI_CHAT_HISTORY_ATTACHMENT_FIELD_CAP_CHARS,
    )
    expect(projected.title).toHaveLength(
      AI_CHAT_HISTORY_ATTACHMENT_FIELD_CAP_CHARS,
    )
    expect(messages[1].video?.title).toHaveLength(
      AI_CHAT_HISTORY_ATTACHMENT_FIELD_CAP_CHARS,
    )
  })

  it("DROPS an over-long url rather than truncating it into a dead link", async () => {
    const overLongUrl = `https://example.org/${"a".repeat(AI_CHAT_HISTORY_SOURCE_URL_CAP_CHARS)}`
    const messages = await replay([
      message("m1", "user", [textPart("q")]),
      message("m2", "assistant", [
        toolPart("retrieveAnswer", {
          status: "ok",
          sources: [
            source({ url: overLongUrl, sourceName: "Dropped" }),
            source({ url: "https://example.org/keep", sourceName: "Kept" }),
          ],
        }),
        textPart("a"),
      ]),
    ])

    // The survivor keeps its URL VERBATIM — a truncated link is never emitted.
    expect(messages[1].sources).toHaveLength(1)
    expect(messages[1].sources?.[0].sourceName).toBe("Kept")
    expect(messages[1].sources?.[0].url).toBe("https://example.org/keep")
  })

  it("drops over-long urls BEFORE the <=5 slice, so they cost no good source", async () => {
    const bad = `https://example.org/${"a".repeat(AI_CHAT_HISTORY_SOURCE_URL_CAP_CHARS)}`
    const messages = await replay([
      message("m1", "user", [textPart("q")]),
      message("m2", "assistant", [
        toolPart("retrieveAnswer", {
          status: "ok",
          sources: [
            ...Array.from({ length: 3 }, () => source({ url: bad })),
            ...Array.from({ length: 5 }, (_, i) =>
              source({ url: `https://example.org/${i}`, sourceName: `S${i}` }),
            ),
          ],
        }),
        textPart("a"),
      ]),
    ])

    expect(messages[1].sources).toHaveLength(
      AI_CHAT_HISTORY_MAX_SOURCES_PER_MESSAGE,
    )
    expect(messages[1].sources?.map((s) => s.sourceName)).toEqual([
      "S0",
      "S1",
      "S2",
      "S3",
      "S4",
    ])
  })

  it("pins the mirrored consumer cap against chat's OWN source", async () => {
    // apps cannot cross-import, so the mirror is prose unless something reads
    // the other side. Lowering chat's real cap without updating this mirror
    // would otherwise leave both suites green while the budget silently stops
    // holding.
    const chatProxy = readFileSync(
      new URL(
        "../../../chat/src/app/api/history/history-proxy.ts",
        import.meta.url,
      ),
      "utf8",
    )
    const declared = chatProxy.match(
      /HISTORY_THREAD_MAX_RESPONSE_BYTES\s*=\s*([0-9*\s]+)/,
    )
    expect(declared).not.toBeNull()
    // The declaration is a product of integer literals (`8 * 1024 * 1024`);
    // multiply them out rather than evaluating the source text.
    const chatCap = declared![1]
      .split("*")
      .map((factor) => Number(factor.trim()))
      .reduce((product, factor) => product * factor, 1)
    expect(Number.isFinite(chatCap)).toBe(true)
    expect(chatCap).toBe(CHAT_HISTORY_THREAD_BYTE_CAP)
  })
})
