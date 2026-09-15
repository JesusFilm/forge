// feat-366: AssistantTurn's memo must survive a `pending` transition. Split
// from message-list.test.tsx because the markdown leaf is module-mocked here
// (a render counter is the only honest proxy for "did this turn re-parse?"),
// and that mock would defeat the markdown assertions in the main suite.
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { type Message } from "@/lib/conversations"

import { MessageList } from "./message-list"

const renders: string[] = []

vi.mock("./assistant-markdown", () => ({
  AssistantMarkdown: ({ content }: { content: string }) => {
    renders.push(content)
    return <div data-message-content>{content}</div>
  },
}))

const QUESTIONS = ["Why pray?", "Who wrote the gospels?"]

function answer(over: Partial<Message> = {}): Message {
  return {
    id: "a1",
    role: "assistant",
    content: "An answer.",
    engine: "seeker",
    grounded: true,
    sources: [],
    ...over,
  }
}

// Two finished answers plus the user turn between them: the transcript shape
// where an unscoped chip prop would cost a re-parse of every earlier turn.
const TRANSCRIPT: Message[] = [
  answer({ id: "a1", content: "First answer." }),
  { id: "u2", role: "user", content: "second question" },
  answer({ id: "a2", content: "Second answer.", followUps: QUESTIONS }),
]

describe("MessageList memo across a pending transition (feat-366)", () => {
  it("re-parses NO earlier turn when followUpsDisabled flips", () => {
    // The flip a send performs: `pending` false -> true, which the pane maps
    // onto followUpsDisabled. Only the last turn may notice.
    renders.length = 0
    const view = render(
      <MessageList
        messages={TRANSCRIPT}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
        followUpsDisabled={false}
      />,
    )
    expect(renders).toEqual(["First answer.", "Second answer."])

    renders.length = 0
    view.rerender(
      <MessageList
        messages={TRANSCRIPT}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
        followUpsDisabled
      />,
    )
    // The earlier answer must not re-render at all. Scoping the chip props to
    // the last turn is what keeps it out of this list — pass either prop to
    // every turn and "First answer." reappears here.
    expect(renders).not.toContain("First answer.")
  })

  it("re-parses no earlier turn when the chip handler identity changes", () => {
    renders.length = 0
    const view = render(
      <MessageList
        messages={TRANSCRIPT}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    renders.length = 0
    view.rerender(
      <MessageList
        messages={TRANSCRIPT}
        streamingMessageId={null}
        onSelectFollowUp={() => {}}
      />,
    )
    expect(renders).not.toContain("First answer.")
  })
})
