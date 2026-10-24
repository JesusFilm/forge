/**
 * feat-329: what a REPLAYED turn renders. A replayed turn carries its
 * attachments but no engine tag (R21), so this suite distinguishes "badge
 * stripping" from "attachment stripping" — the pre-feat-329 render gated
 * SourcesList on `engine === "seeker"` and dropped a replayed turn's sources.
 */
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  type Message,
  type SeekerSource,
  type VideoAttachment,
} from "@/lib/conversations"

import { MessageList } from "./message-list"

vi.mock("@forge/video-player/mux-video", () => ({
  default: (props: Record<string, unknown>) => (
    <video data-testid="mux-video" data-playback={String(props.playbackId)} />
  ),
}))

const VIDEO: VideoAttachment = {
  videoId: "vid_1",
  title: "Jesus Calms the Storm",
  playbackId: "abcdEFGH1234",
  durationSeconds: 754,
  watchUrl: "https://www.jesusfilm.org/watch/jesus.html",
}

const SOURCE: SeekerSource = {
  sourceName: "Source A",
  title: "Title A",
  url: "https://example.org/a",
  score: 0.9,
  snippet: "a cited passage",
}

/** A replayed turn: attachments present, engine/grounded absent by design. */
function replayedTurn(over: Partial<Message> = {}): Message {
  return {
    id: "r1",
    role: "assistant",
    content: "Here is what I found.",
    ...over,
  }
}

function renderTurn(message: Message) {
  render(<MessageList messages={[message]} streamingMessageId={null} />)
}

describe("MessageList — replayed turns (feat-329, R21)", () => {
  it("renders the SourcesList for a replayed turn that carries sources", async () => {
    renderTurn(replayedTurn({ sources: [SOURCE] }))

    expect(await screen.findByText(/Sources/)).toBeInTheDocument()
  })

  it("renders the player for a replayed turn that carries a video", async () => {
    renderTurn(replayedTurn({ video: VIDEO }))

    expect(await screen.findByTestId("mux-video")).toHaveAttribute(
      "data-playback",
      "abcdEFGH1234",
    )
  })

  it("renders BOTH together — video and sources ship as one (plan D8)", async () => {
    renderTurn(replayedTurn({ sources: [SOURCE], video: VIDEO }))

    expect(await screen.findByTestId("mux-video")).toBeInTheDocument()
    expect(screen.getByText(/Sources/)).toBeInTheDocument()
  })

  it("shows NO grounded badge and NO engine marker on a replayed turn (R21)", () => {
    renderTurn(replayedTurn({ sources: [SOURCE], video: VIDEO }))

    // The badge is the thing R21 strips — its three states all carry
    // data-grounded, and the machine engine tag stays off replayed turns.
    expect(document.querySelector("[data-grounded]")).toBeNull()
    const item = document.querySelector("[data-message-id='r1']")
    expect(item?.getAttribute("data-engine")).toBeNull()
  })

  it("renders no sources disclosure at all for a replayed turn with none", () => {
    // Only SEEKER turns get the explicit "No sources cited" state; a plain
    // replayed turn must not grow one.
    renderTurn(replayedTurn())

    expect(screen.queryByText(/Sources/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No sources cited/)).not.toBeInTheDocument()
  })

  it("still shows the explicit empty state on a LIVE seeker turn", () => {
    // Anti-vacuous companion: the engine branch is untouched by feat-329.
    renderTurn(
      replayedTurn({ id: "s1", engine: "seeker", grounded: true, sources: [] }),
    )

    expect(screen.getByText(/No sources cited/)).toBeInTheDocument()
  })
})
