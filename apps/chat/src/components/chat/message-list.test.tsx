import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

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

// ===========================================================================
// feat-366 U2: WHERE the chips mount. The chip block itself is covered in
// follow-ups.test.tsx; these pin the placement rules (R1/R3).
// ===========================================================================

const QUESTIONS = ["Why pray?", "Who wrote the gospels?"]

function answer(over: Partial<Message> = {}): Message {
  return {
    id: "a1",
    role: "assistant",
    content: "A grounded answer.",
    engine: "seeker",
    grounded: true,
    sources: [],
    ...over,
  }
}

function chipBlock(container: HTMLElement): Element | null {
  return container.querySelector('[data-follow-ups="section"]')
}

describe("MessageList follow-up chips (feat-366)", () => {
  it("renders one chip per question on the conversation's last turn", () => {
    const { container } = render(
      <MessageList
        messages={[answer({ followUps: QUESTIONS })]}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    expect(
      within(chipBlock(container) as HTMLElement)
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toEqual(QUESTIONS)
  })

  it("renders chips on the LAST turn only, never on an earlier one (R3)", () => {
    const { container } = render(
      <MessageList
        messages={[
          { id: "u1", role: "user", content: "q1" },
          answer({ id: "a1", followUps: ["Stale question?"] }),
          { id: "u2", role: "user", content: "q2" },
          answer({ id: "a2", followUps: QUESTIONS }),
        ]}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    const blocks = container.querySelectorAll('[data-follow-ups="section"]')
    expect(blocks).toHaveLength(1)
    expect(
      container
        .querySelector('[data-message-id="a2"]')
        ?.contains(blocks[0] as Node),
    ).toBe(true)
    expect(screen.queryByText("Stale question?")).toBeNull()
  })

  it("renders NO chips while that turn is still streaming", () => {
    // Chips arrive WITH the terminal frame, so a streaming turn cannot carry
    // them in production; the streaming branch must not render them anyway.
    const { container } = render(
      <MessageList
        messages={[answer({ followUps: QUESTIONS })]}
        streamingMessageId="a1"
        onSelectFollowUp={() => {}}
      />,
    )
    expect(chipBlock(container)).toBeNull()
  })

  it("renders no chips when the last turn carries none", () => {
    const { container } = render(
      <MessageList
        messages={[answer()]}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    expect(chipBlock(container)).toBeNull()
  })

  it("renders no chips when the handler is absent", () => {
    const { container } = render(
      <MessageList
        messages={[answer({ followUps: QUESTIONS })]}
        streamingMessageId={null}
      />,
    )
    expect(chipBlock(container)).toBeNull()
  })

  it("mounts the chips as a SIBLING block after the sources disclosure", () => {
    const { container } = render(
      <MessageList
        messages={[answer({ followUps: QUESTIONS })]}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    const content = container.querySelector("[data-message-content]")!
    const sources = container.querySelector('[data-sources="empty"]')!
    const chips = chipBlock(container)!
    expect(content.contains(chips)).toBe(false)
    expect(
      sources.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("routes a click to onSelectFollowUp with the question VERBATIM", async () => {
    const onSelectFollowUp = vi.fn()
    const user = userEvent.setup()
    const { container } = render(
      <MessageList
        messages={[answer({ followUps: QUESTIONS })]}
        streamingMessageId={null}
        onSelectFollowUp={onSelectFollowUp}
      />,
    )
    await user.click(
      within(chipBlock(container) as HTMLElement).getAllByRole("button")[1],
    )
    expect(onSelectFollowUp).toHaveBeenCalledWith("Who wrote the gospels?")
  })

  it("clears the chips once the click's new turns are appended", () => {
    // Self-clearing is structural: the previous answer stops being last.
    const before = render(
      <MessageList
        messages={[answer({ id: "a1", followUps: QUESTIONS })]}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    expect(chipBlock(before.container)).not.toBeNull()
    before.rerender(
      <MessageList
        messages={[
          answer({ id: "a1", followUps: QUESTIONS }),
          { id: "u2", role: "user", content: "Why pray?" },
          { id: "a2", role: "assistant", content: "" },
        ]}
        streamingMessageId="a2"
        onSelectFollowUp={() => {}}
      />,
    )
    expect(chipBlock(before.container)).toBeNull()
  })

  it("renders chips on a REPLAYED last turn, which carries no engine tag", () => {
    // R21: a replayed turn has no engine/grounded metadata by design, so the
    // chip gate must not hang off the engine tag the way the badge does.
    const { container } = render(
      <MessageList
        messages={[
          {
            id: "r1",
            role: "assistant",
            content: "Replayed.",
            followUps: QUESTIONS,
          },
        ]}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    expect(
      within(chipBlock(container) as HTMLElement).getAllByRole("button"),
    ).toHaveLength(2)
  })

  it("renders no chips on a FAILED last turn", () => {
    const { container } = render(
      <MessageList
        messages={[
          answer({ error: "generation_failed", followUps: QUESTIONS }),
        ]}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    expect(chipBlock(container)).toBeNull()
  })

  it("keeps chips enabled by default and disables them on request", () => {
    // followUpsDisabled is the R3 defensive path — see the synthetic-fixture
    // label in follow-ups.test.tsx for why no production state reaches it.
    const enabled = render(
      <MessageList
        messages={[answer({ followUps: QUESTIONS })]}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    expect(
      within(chipBlock(enabled.container) as HTMLElement).getAllByRole(
        "button",
      )[0],
    ).toBeEnabled()
    enabled.unmount()

    const disabled = render(
      <MessageList
        messages={[answer({ followUps: QUESTIONS })]}
        streamingMessageId={null}
        followUpsDisabled
        onSelectFollowUp={() => {}}
      />,
    )
    expect(
      within(chipBlock(disabled.container) as HTMLElement).getAllByRole(
        "button",
      )[0],
    ).toBeDisabled()
  })
})

describe("MessageList — the two definitions of 'last turn' (feat-366)", () => {
  // Mastra puts followUps on the thread's last TEXT-BEARING ASSISTANT message;
  // this list gates on the last message of ANY role. The two diverge for a
  // transcript that ends on a user turn — an interrupted send persists the
  // user row with no answer. Pinned so the divergence stays in the SAFE
  // direction (no chips) instead of hanging a stale answer's chips under an
  // unanswered question.
  it("renders no chips when the last message is an unanswered user turn", () => {
    const { container } = render(
      <MessageList
        messages={[
          answer({ id: "a1", followUps: QUESTIONS }),
          { id: "u2", role: "user", content: "an unanswered question" },
        ]}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    expect(chipBlock(container)).toBeNull()
  })

  it("brings the chips back when that turn is answered", () => {
    // The same transcript once the reply lands: the answer is last again, so
    // the safe-direction suppression above is not a permanent loss.
    const { container } = render(
      <MessageList
        messages={[
          answer({ id: "a1", followUps: ["Stale question?"] }),
          { id: "u2", role: "user", content: "an answered question" },
          answer({ id: "a2", followUps: QUESTIONS }),
        ]}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    expect(
      within(chipBlock(container) as HTMLElement)
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toEqual(QUESTIONS)
  })
})
