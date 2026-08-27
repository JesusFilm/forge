// feat-366 U2: the client-side payload bound on follow-up questions and the
// two wire hops that carry them (split from chat-stub.test.ts so neither file
// crosses the 1k-line bar).
import { describe, expect, it, vi } from "vitest"

import {
  FOLLOW_UPS_QUESTION_MAX_UNITS,
  STUB_REPLY_DELAY_MS,
  streamReply,
  toFollowUps,
} from "./chat-stub"
import { encodeSseFrame } from "./sse"

// A Response whose body streams the given SSE frames (mirrors the helper in
// chat-stub.test.ts; both files need it and it is four lines).
function sseResponse(
  frames: Array<{ event: string; data: unknown }>,
  init?: ResponseInit,
): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(
          encoder.encode(encodeSseFrame(frame.event, frame.data)),
        )
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200, ...init })
}

// ===========================================================================
// feat-366 U2: the client-side BOUND on the wire follow-up questions.
// Deliberately NOT a mirror of mastra's projectFollowUps (superseded KTD4,
// 2026-08-27) — mastra owns content validation on both the live and replay
// paths, so these four checks only stop an absurd payload from rendering.
// ===========================================================================

describe("toFollowUps — the payload bound", () => {
  it("passes a valid list through unchanged", () => {
    expect(toFollowUps(["Why pray?", "Who wrote the gospels?"])).toEqual([
      "Why pray?",
      "Who wrote the gospels?",
    ])
  })

  it("caps at three questions", () => {
    expect(toFollowUps(["a", "b", "c", "d"])).toEqual(["a", "b", "c"])
  })

  it("drops a non-string item and keeps its valid siblings", () => {
    expect(toFollowUps(["keep", 7, null, { q: "no" }, "also"])).toEqual([
      "keep",
      "also",
    ])
  })

  it("drops an empty-after-trim item — a blank chip would send nothing", () => {
    expect(toFollowUps(["   ", "\t\n", "kept"])).toEqual(["kept"])
  })

  it("DROPS an over-length item, never truncates it", () => {
    // A truncated question would send words the person never saw, since a
    // click sends the chip text verbatim as their own message.
    const long = "q".repeat(FOLLOW_UPS_QUESTION_MAX_UNITS + 1)
    expect(toFollowUps([long, "kept"])).toEqual(["kept"])
  })

  it("keeps an item at exactly the cap", () => {
    const exact = "q".repeat(FOLLOW_UPS_QUESTION_MAX_UNITS)
    expect(toFollowUps([exact])).toEqual([exact])
  })

  it("trims surrounding whitespace but keeps the text otherwise intact", () => {
    expect(toFollowUps(["  what about grace?  "])).toEqual([
      "what about grace?",
    ])
  })

  it("no longer COLLAPSES internal whitespace — mastra already did", () => {
    // The pre-supersession mirror collapsed runs of whitespace to single
    // spaces. Unreachable via mastra (projectFollowUps collapses before the
    // wire), so this characterizes the behaviour change rather than
    // protecting it. If mastra ever regressed, the tell is asymmetric: the
    // chip <button> collapses a newline visually while the user bubble it
    // becomes renders whitespace-pre-wrap.
    expect(toFollowUps(["what\nabout   grace?"])).toEqual([
      "what\nabout   grace?",
    ])
  })

  it("returns the lone survivor when every other item drops", () => {
    const over = "x".repeat(FOLLOW_UPS_QUESTION_MAX_UNITS + 1)
    expect(toFollowUps([123, "   ", over, "only"])).toEqual(["only"])
  })

  it("is total: junk shapes return an empty list, never a throw", () => {
    for (const junk of [undefined, null, "str", 7, {}, { 0: "a" }, true]) {
      expect(toFollowUps(junk)).toEqual([])
    }
  })

  it("does NOT re-apply mastra's content rules — it is a bound, not a mirror", () => {
    // Deliberate: content mastra would have dropped passes here, because
    // mastra already dropped it upstream on both paths. Pinned so the posture
    // reads as a decision, not a bug.
    const withFormatChar = "why\u202Epray?"
    const duplicateCasing = ["Why pray?", "why PRAY?"]
    expect(toFollowUps([withFormatChar])).toEqual([withFormatChar])
    expect(toFollowUps(duplicateCasing)).toEqual(duplicateCasing)
  })
})

describe("streamReply — followUps on the terminal frame (feat-366)", () => {
  async function terminal(data: Record<string, unknown>) {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(sseResponse([{ event: "result", data }]))
    return streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
  }

  it("projects the wire list onto the result", async () => {
    const result = await terminal({
      text: "answer",
      sources: [],
      grounded: true,
      followUps: ["Why pray?", "Who wrote the gospels?"],
    })
    expect(result.ok && result.followUps).toEqual([
      "Why pray?",
      "Who wrote the gospels?",
    ])
  })

  it("yields undefined, not [], when the field is ABSENT", async () => {
    const result = await terminal({
      text: "answer",
      sources: [],
      grounded: true,
    })
    expect(result.ok && result.followUps).toBeUndefined()
  })

  it("yields undefined, not [], when every item fails the projection", async () => {
    const result = await terminal({
      text: "answer",
      sources: [],
      grounded: true,
      followUps: ["   ", 7],
    })
    expect(result.ok && result.followUps).toBeUndefined()
  })

  it("never attaches followUps to an error terminal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        {
          event: "error",
          data: { reason: "generation_failed", followUps: ["Why pray?"] },
        },
      ]),
    )
    const result = await streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect("followUps" in result).toBe(false)
  })

  it("never produces followUps on the stub path", async () => {
    vi.useFakeTimers()
    const promise = streamReply({
      text: "hi",
      conversationId: "c1",
      seekerEnabled: false,
    })
    await vi.advanceTimersByTimeAsync(STUB_REPLY_DELAY_MS)
    const result = await promise
    expect(result.ok && result.followUps).toBeUndefined()
  })
})

describe("streamReply — promptSource click-source tag (KTD11)", () => {
  function capture() {
    return vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          { event: "result", data: { text: "a", sources: [], grounded: true } },
        ]),
      )
  }

  it("adds promptSource: follow_up to the body on a chip-originated send", async () => {
    const fetchImpl = capture()
    await streamReply({
      text: "Why pray?",
      conversationId: "c1",
      seekerEnabled: true,
      promptSource: "follow_up",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.promptSource).toBe("follow_up")
  })

  it("OMITS the key entirely on a typed send", async () => {
    const fetchImpl = capture()
    await streamReply({
      text: "typed",
      conversationId: "c1",
      seekerEnabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    )
    expect("promptSource" in body).toBe(false)
  })
})
