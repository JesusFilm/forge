import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { type Conversation, type Message } from "@/lib/conversations"

import { Chat, shouldRepin } from "./chat"

// jsdom has no layout, so these tests mock the scroller/turn geometry and
// assert WHICH scroll the effect performs (answer-top align vs bottom-pin).
// The real pixel behavior is browser-verified (see feat-269 verification).

const SCROLLER_TOP = 100
const TURN_TOP = 400
const SCROLL_HEIGHT = 2000

function conversationWith(id: string, messages: Message[]): Conversation {
  return { id, title: "T", messages }
}

function userTurn(id: string): Message {
  return { id, role: "user", content: "question" }
}

function assistantTurn(id: string, content: string): Message {
  return { id, role: "assistant", content, engine: "seeker", grounded: true }
}

function baseProps() {
  return {
    draft: "",
    onDraftChange: () => {},
    onSend: () => {},
  }
}

function rectWithTop(top: number): DOMRect {
  return {
    top,
    bottom: top,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

// Instruments the scroller with recorded scrollTop assignments + fixed
// geometry so the effect's two branches produce distinguishable values.
function instrumentScroller(container: HTMLElement): number[] {
  const scroller = container.querySelector("[data-chat-scroller]")
  if (!(scroller instanceof HTMLElement)) throw new Error("scroller not found")
  const assignments: number[] = []
  let value = 0
  Object.defineProperty(scroller, "scrollTop", {
    get: () => value,
    set: (next: number) => {
      value = next
      assignments.push(next)
    },
  })
  Object.defineProperty(scroller, "scrollHeight", {
    get: () => SCROLL_HEIGHT,
  })
  scroller.getBoundingClientRect = () => rectWithTop(SCROLLER_TOP)
  return assignments
}

function instrumentTurn(container: HTMLElement, messageId: string) {
  const turn = container.querySelector(`[data-message-id="${messageId}"]`)
  if (!(turn instanceof HTMLElement)) throw new Error("turn not found")
  turn.getBoundingClientRect = () => rectWithTop(TURN_TOP)
}

describe("Chat finalize scroll", () => {
  it("aligns the finalized answer's top to the scrollport instead of bottom-pinning", () => {
    const streaming = conversationWith("c1", [
      userTurn("u1"),
      assistantTurn("a1", "partial"),
    ])
    const { container, rerender } = render(
      <Chat
        {...baseProps()}
        conversation={streaming}
        pending={true}
        streamingMessageId="a1"
      />,
    )
    const assignments = instrumentScroller(container)
    instrumentTurn(container, "a1")

    const finalized = conversationWith("c1", [
      userTurn("u1"),
      { ...assistantTurn("a1", "full answer"), sources: [] },
    ])
    rerender(
      <Chat
        {...baseProps()}
        conversation={finalized}
        pending={false}
        streamingMessageId={null}
      />,
    )
    // scrollTop += turnTop - scrollerTop (0 + 400 - 100), NOT scrollHeight.
    expect(assignments.at(-1)).toBe(TURN_TOP - SCROLLER_TOP)
    expect(assignments).not.toContain(SCROLL_HEIGHT)
  })

  it("aligns an error-finalized turn's top the same as a success finalize", () => {
    // A stream error also transitions streamingMessageId to null in the same
    // commit — the partial text + alert should be read from the top too.
    const streaming = conversationWith("c1", [
      userTurn("u1"),
      assistantTurn("a1", "partial"),
    ])
    const { container, rerender } = render(
      <Chat
        {...baseProps()}
        conversation={streaming}
        pending={true}
        streamingMessageId="a1"
      />,
    )
    const assignments = instrumentScroller(container)
    instrumentTurn(container, "a1")

    const errored = conversationWith("c1", [
      userTurn("u1"),
      { ...assistantTurn("a1", "partial"), error: "timeout" as const },
    ])
    rerender(
      <Chat
        {...baseProps()}
        conversation={errored}
        pending={false}
        streamingMessageId={null}
      />,
    )
    expect(assignments.at(-1)).toBe(TURN_TOP - SCROLLER_TOP)
    expect(assignments).not.toContain(SCROLL_HEIGHT)
  })

  it("bottom-pins ordinary transcript growth while streaming", () => {
    const first = conversationWith("c1", [
      userTurn("u1"),
      assistantTurn("a1", "tok"),
    ])
    const { container, rerender } = render(
      <Chat
        {...baseProps()}
        conversation={first}
        pending={true}
        streamingMessageId="a1"
      />,
    )
    const assignments = instrumentScroller(container)

    const grown = conversationWith("c1", [
      userTurn("u1"),
      assistantTurn("a1", "tok tok"),
    ])
    rerender(
      <Chat
        {...baseProps()}
        conversation={grown}
        pending={true}
        streamingMessageId="a1"
      />,
    )
    expect(assignments.at(-1)).toBe(SCROLL_HEIGHT)
  })

  it("bottom-pins a conversation switch away from a mid-stream turn", () => {
    const streaming = conversationWith("c1", [
      userTurn("u1"),
      assistantTurn("a1", "partial"),
    ])
    const { container, rerender } = render(
      <Chat
        {...baseProps()}
        conversation={streaming}
        pending={true}
        streamingMessageId="a1"
      />,
    )
    const assignments = instrumentScroller(container)

    const other = conversationWith("c2", [
      userTurn("u2"),
      assistantTurn("a2", "older answer"),
    ])
    rerender(
      <Chat
        {...baseProps()}
        conversation={other}
        pending={false}
        streamingMessageId={null}
      />,
    )
    // The finalized turn is not in this conversation's DOM — fall back to the
    // bottom-pin, never a stray answer-align against a foreign id.
    expect(assignments.at(-1)).toBe(SCROLL_HEIGHT)
  })
})

describe("shouldRepin (feat-270) — pre-resize distance decision", () => {
  const T = 64

  it("re-pins a reader who was at or near the bottom on grow (boundary inclusive)", () => {
    expect(shouldRepin(156, 156, T)).toBe(true) // was exactly at the bottom
    expect(shouldRepin(220, 156, T)).toBe(true) // was exactly at the threshold
  })

  it("never yanks a scrolled-up reader on grow", () => {
    expect(shouldRepin(221, 156, T)).toBe(false) // 1px past the threshold
    expect(shouldRepin(456, 156, T)).toBe(false) // 300px up
  })

  it("discriminates the old Math.max clamp bug on shrink", () => {
    // Reader 180px up before a 156px shrink: post-shrink distance is 24 —
    // the clamped formula (24 <= 64) yanked them; the fix must not.
    expect(shouldRepin(24, -156, T)).toBe(false)
    // The solutions doc's worked example: distanceAfter=50, delta=-156.
    expect(shouldRepin(50, -156, T)).toBe(false)
  })

  it("stays harmless in the browser-clamp band on shrink", () => {
    // A clamped reader reads distanceAfter 0: large shrinks skip the re-pin…
    expect(shouldRepin(0, -156, T)).toBe(false)
    // …small ones redundantly re-pin — a no-op on an at-bottom scroller.
    expect(shouldRepin(0, -40, T)).toBe(true)
  })
})
