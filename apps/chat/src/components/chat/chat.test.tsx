import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { type Conversation, type Message } from "@/lib/conversations"

import { Chat } from "./chat"

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
