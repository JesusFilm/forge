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

describe("MessageList badge copy (feat-270)", () => {
  it("renders no visible engine copy on a Seeker turn; the machine tag stays on the turn", () => {
    const { container } = render(
      <MessageList
        messages={[
          {
            id: "a1",
            role: "assistant",
            content: "an answer",
            engine: "seeker",
            grounded: true,
            sources: [],
          },
        ]}
        streamingMessageId={null}
      />,
    )
    // The engine codename never reaches users…
    expect(container.textContent).not.toContain("Seeker")
    // …but the machine-readable tag survives for tests/tooling.
    expect(container.querySelector('[data-engine="seeker"]')).not.toBeNull()
  })

  it("keeps the visible Stub marker on stub turns (mixed conversations stay distinguishable)", () => {
    render(
      <MessageList
        messages={[
          { id: "a1", role: "assistant", content: "stub", engine: "stub" },
        ]}
        streamingMessageId={null}
      />,
    )
    expect(screen.getByText("Stub")).toBeInTheDocument()
  })

  it("gives each grounding state a plain-language title tooltip", () => {
    const badgeFor = (grounded: boolean, sources: Message["sources"]) => {
      const { container, unmount } = render(
        <MessageList
          messages={[
            {
              id: "a1",
              role: "assistant",
              content: "x",
              engine: "seeker",
              grounded,
              sources,
            },
          ]}
          streamingMessageId={null}
        />,
      )
      const badge = container.querySelector("[data-grounded]")
      const title = badge?.getAttribute("title") ?? ""
      unmount()
      return title
    }
    const cited = badgeFor(true, [
      {
        sourceName: "John",
        title: "John 11:35",
        url: "https://bible.example/j",
        score: 1,
        snippet: "s",
      },
    ])
    const uncited = badgeFor(true, [])
    const ungrounded = badgeFor(false, [])
    expect(cited).toMatch(/cited sources below/)
    expect(uncited).toMatch(/no source passages were cited/)
    expect(ungrounded).toMatch(/No sources were available/)
    expect(new Set([cited, uncited, ungrounded]).size).toBe(3)
  })
})

describe("MessageList markdown split (feat-268)", () => {
  const MD = "**Grace** abounds"

  it("renders assistant markdown as elements, user content as literal text", () => {
    const messages: Message[] = [
      { id: "u1", role: "user", content: MD },
      { id: "a1", role: "assistant", content: MD, engine: "seeker" },
    ]
    const { container } = render(
      <MessageList messages={messages} streamingMessageId={null} />,
    )
    const [userNode, assistantNode] = Array.from(
      container.querySelectorAll("[data-message-content]"),
    )
    // User turn: React-escaped plain text — the asterisks stay visible.
    expect(userNode.textContent).toBe(MD)
    expect(userNode.querySelector("strong")).toBeNull()
    // Assistant turn: hardened markdown — a real <strong>, no asterisks.
    expect(assistantNode.querySelector("strong")).toHaveTextContent("Grace")
    expect(assistantNode.textContent).not.toContain("*")
  })

  it("renders markdown on the streaming turn too, with the pending pulse", () => {
    const messages: Message[] = [
      { id: "a1", role: "assistant", content: "So **far** so" },
    ]
    const { container } = render(
      <MessageList messages={messages} streamingMessageId="a1" />,
    )
    const pending = container.querySelector("[data-pending]")
    expect(pending).not.toBeNull()
    expect(pending?.querySelector("strong")).toHaveTextContent("far")
  })

  it("renders a replayed transcript turn (no engine) through the same markdown path", () => {
    // R21 parity: replayed turns carry no engine/grounded/source badges, but
    // the TEXT treatment must match live turns exactly.
    const messages: Message[] = [
      { id: "r1", role: "assistant", content: "> Be still\n\n- one\n- two" },
    ]
    const { container } = render(
      <MessageList messages={messages} streamingMessageId={null} />,
    )
    const content = container.querySelector("[data-message-content]")
    expect(content?.querySelector("blockquote")).toHaveTextContent("Be still")
    expect(content?.querySelectorAll("ul li")).toHaveLength(2)
    expect(container.querySelector("[data-engine]")).toBeNull()
  })
})
