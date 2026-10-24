// feat-328: where the VideoCard mounts in the transcript, and what a throwing
// player costs. Split from message-list.test.tsx because the player leaf is
// module-mocked here and the throwing variant needs its own module registry.
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { type Message, type VideoAttachment } from "@/lib/conversations"

import { MessageList } from "./message-list"

const explode = { current: false }

vi.mock("@forge/video-player/mux-video", () => ({
  default: (props: Record<string, unknown>) => {
    if (explode.current) throw new Error("hls.js exploded")
    return (
      <video data-testid="mux-video" data-playback={String(props.playbackId)} />
    )
  },
}))

const VIDEO: VideoAttachment = {
  videoId: "vid_1",
  title: "Jesus Calms the Storm",
  playbackId: "abcdEFGH1234",
  durationSeconds: 754,
  watchUrl: "https://www.jesusfilm.org/watch/jesus.html",
}

function turn(over: Partial<Message> = {}): Message {
  return {
    id: "a1",
    role: "assistant",
    content: "Here is a video that speaks to that.",
    engine: "seeker",
    grounded: true,
    sources: [],
    ...over,
  }
}

beforeEach(() => {
  explode.current = false
})

describe("MessageList video block (feat-328)", () => {
  it("renders the player on a turn that carries a video", async () => {
    render(
      <MessageList
        messages={[turn({ video: VIDEO })]}
        streamingMessageId={null}
      />,
    )
    const player = await screen.findByTestId("mux-video")
    expect(player).toHaveAttribute("data-playback", "abcdEFGH1234")
  })

  it("renders no player, and no empty card, on a turn without one", () => {
    const { container } = render(
      <MessageList messages={[turn()]} streamingMessageId={null} />,
    )
    expect(container.querySelector("[data-video-card]")).toBeNull()
    expect(container.querySelector('[data-testid="mux-video"]')).toBeNull()
  })

  it("mounts the card as a SIBLING after the markdown content, never inside it", async () => {
    const { container } = render(
      <MessageList
        messages={[turn({ video: VIDEO })]}
        streamingMessageId={null}
      />,
    )
    await screen.findByTestId("mux-video")
    const content = container.querySelector("[data-message-content]")!
    const card = container.querySelector("[data-video-card]")!
    expect(content.contains(card)).toBe(false)
    expect(
      content.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // The markdown allowlist stays locked: no media element inside the parse.
    expect(content.querySelector("video, img, iframe")).toBeNull()
  })

  it("renders the card on the streaming branch too (defensive: unreachable today)", async () => {
    // SYNTHETIC fixture: conversation-session's success finalize is the only
    // writer of Message.video and it clears streamingMessageId in the same
    // commit, so a streaming turn never carries one in production.
    render(
      <MessageList
        messages={[turn({ video: VIDEO, content: "Here is a vid" })]}
        streamingMessageId="a1"
      />,
    )
    await screen.findByTestId("mux-video")
    expect(screen.getByText(/Replying/)).toBeInTheDocument()
  })

  it("keeps the sources disclosure below the video block", async () => {
    const { container } = render(
      <MessageList
        messages={[
          turn({
            video: VIDEO,
            sources: [
              {
                sourceName: "Mark",
                title: "Mark 4:39",
                url: "https://bible.example/m",
                score: 1,
                snippet: "Peace! Be still!",
              },
            ],
          }),
        ]}
        streamingMessageId={null}
      />,
    )
    await screen.findByTestId("mux-video")
    const card = container.querySelector("[data-video-card]")!
    const sources = container.querySelector('[data-sources="section"]')!
    expect(
      card.compareDocumentPosition(sources) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

describe("MessageList video boundary (feat-328)", () => {
  it("degrades ONE turn when the player throws, leaving the transcript mounted", async () => {
    explode.current = true
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { container } = render(
      <MessageList
        messages={[
          { id: "u1", role: "user", content: "is there a video?" },
          turn({ id: "a1", video: VIDEO }),
          turn({ id: "a2", content: "A later, unrelated answer." }),
        ]}
        streamingMessageId={null}
      />,
    )
    // The throwing turn shows the boundary fallback. AWAIT it: the ssr:false
    // lazy resolves asynchronously, so a synchronous assertion here passes
    // only when an earlier test in the file already warmed the module cache.
    await screen.findByText(/can’t be played here/)
    expect(container.querySelector('[data-video="unavailable"]')).not.toBeNull()
    // …its own text and caption link survive…
    expect(
      screen.getByText("Here is a video that speaks to that."),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Jesus Calms the Storm/ }),
    ).toBeInTheDocument()
    // …and the rest of the transcript is untouched.
    expect(screen.getByText("is there a video?")).toBeInTheDocument()
    expect(screen.getByText("A later, unrelated answer.")).toBeInTheDocument()
    expect(container.querySelectorAll("li")).toHaveLength(3)
    spy.mockRestore()
  })
})
