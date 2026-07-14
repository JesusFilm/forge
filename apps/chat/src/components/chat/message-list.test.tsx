import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  REPLY_FAILURE_REASONS,
  type Message,
  type ReplyFailureReason,
} from "@/lib/conversations"

import { MessageList } from "./message-list"

// A finalized assistant turn carrying a failure reason — the shape that drives
// failureNotice() into the role="alert" bubble.
function errorMessage(reason: ReplyFailureReason): Message {
  return {
    id: "m1",
    role: "assistant",
    content: "",
    engine: "seeker",
    error: reason,
  }
}

function noticeFor(reason: ReplyFailureReason): string {
  const { unmount } = render(
    <MessageList messages={[errorMessage(reason)]} streamingMessageId={null} />,
  )
  const text = screen.getByRole("alert").textContent ?? ""
  unmount()
  return text
}

describe("MessageList failure notices", () => {
  it("renders the distinct thread_forbidden notice (feat-208)", () => {
    render(
      <MessageList
        messages={[errorMessage("thread_forbidden")]}
        streamingMessageId={null}
      />,
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This conversation can't be continued from here. Please start a new conversation.",
    )
  })

  it("renders the distinct thread_limit notice (feat-208)", () => {
    render(
      <MessageList
        messages={[errorMessage("thread_limit")]}
        streamingMessageId={null}
      />,
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You've reached the conversation limit for now. Please continue in an existing conversation, or try again later.",
    )
  })

  it("keeps the two thread-gate notices distinct from each other and from the generic failure", () => {
    const generic = noticeFor("generation_failed")
    const forbidden = noticeFor("thread_forbidden")
    const limit = noticeFor("thread_limit")
    expect(forbidden).not.toBe(generic)
    expect(limit).not.toBe(generic)
    expect(forbidden).not.toBe(limit)
  })

  it("maps gate_denied to the distinct access-changed notice (feat-241, KTD10)", () => {
    // Reaches a rendered failure only on server-persisted conversations (the
    // seam still stub-degrades never-persisted ones). Distinct copy — never
    // the generic unavailable bucket, and no sign-in nudge (feat-236 owns it).
    const notice = noticeFor("gate_denied")
    expect(notice).toMatch(/access to Seeker has changed/)
    expect(notice).not.toBe(
      "Seeker is unavailable right now. Please try again later.",
    )
    expect(notice).not.toMatch(/sign in/i)
  })

  it("maps every ReplyFailureReason to a non-empty user notice", () => {
    // Exhaustiveness at runtime: no reason renders an empty bubble (a dropped
    // switch case would surface here, complementing the compile-time
    // assertNever guard).
    for (const reason of REPLY_FAILURE_REASONS) {
      expect(noticeFor(reason).length).toBeGreaterThan(0)
    }
  })
})
