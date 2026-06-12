/**
 * @vitest-environment jsdom
 */

import { createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MuxPlayerRef } from "@forge/video-player"

import { SubtitleTranscript } from "@/components/watch/SubtitleTranscript"
import type { WatchSubtitle } from "@/lib/content"

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string): string =>
      key,
}))

const amharicSubtitle: WatchSubtitle = {
  documentId: "subtitle-am",
  language: {
    slug: "amharic",
    name: "Amharic",
    nativeName: null,
    bcp47: "am",
  },
  vttSrc: "https://example.com/am.vtt",
  primary: false,
  aiGenerated: true,
}

const englishSubtitle: WatchSubtitle = {
  documentId: "subtitle-en",
  language: {
    slug: "english",
    name: "English",
    nativeName: null,
    bcp47: "en",
  },
  vttSrc: "https://example.com/en.vtt",
  primary: true,
  aiGenerated: false,
}

const fetchMock = vi.fn()

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  vi.unstubAllGlobals()
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
})

function makePlayerRef(currentTime = 0) {
  const player = new EventTarget() as HTMLMediaElement
  Object.defineProperty(player, "currentTime", {
    configurable: true,
    value: currentTime,
    writable: true,
  })
  Object.defineProperty(player, "muted", {
    configurable: true,
    value: false,
    writable: true,
  })
  Object.defineProperty(player, "play", {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  })

  return {
    player,
    playerRef: {
      current: player as unknown as MuxPlayerRef,
    },
  }
}

describe("SubtitleTranscript rendering", () => {
  it("does not render the transcript section when subtitles do not match the selected audio language", () => {
    act(() => {
      root.render(
        <SubtitleTranscript
          subtitles={[amharicSubtitle]}
          audioSlug="english"
          playerRef={createRef<MuxPlayerRef | null>()}
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="watch-subtitle-transcript"]'),
    ).toBeNull()
  })

  it("renders server-provided cue text without waiting for client fetch", () => {
    act(() => {
      root.render(
        <SubtitleTranscript
          subtitles={[englishSubtitle]}
          audioSlug="english"
          playerRef={createRef<MuxPlayerRef | null>()}
          initialTranscript={{
            vttSrc: englishSubtitle.vttSrc,
            cues: [{ start: 5, end: 8, text: "Server-rendered cue" }],
          }}
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="watch-subtitle-cues"]')
        ?.textContent,
    ).toContain("Server-rendered cue")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("renders inline flow cues without timestamps inside a half-height scroll pane", () => {
    const { playerRef } = makePlayerRef()

    act(() => {
      root.render(
        <SubtitleTranscript
          subtitles={[englishSubtitle]}
          audioSlug="english"
          playerRef={playerRef}
          displayMode="inlineFlow"
          initialTranscript={{
            vttSrc: englishSubtitle.vttSrc,
            cues: [
              { start: 5, end: 8, text: "Tell us:" },
              {
                start: 8,
                end: 12,
                text: "what right do You have to say these things?",
              },
            ],
          }}
        />,
      )
    })

    const section = container.querySelector(
      '[data-testid="watch-subtitle-transcript"]',
    )
    const cues = container.querySelector('[data-testid="watch-subtitle-cues"]')

    expect(section?.getAttribute("data-display-mode")).toBe("inlineFlow")
    expect(section?.getAttribute("class")).toContain("h-[50svh]")
    expect(cues?.getAttribute("class")).toContain("overflow-y-auto")
    expect(cues?.textContent).toContain(
      "Tell us: what right do You have to say these things?",
    )
    expect(cues?.querySelector("time")).toBeNull()
    expect(cues?.textContent).not.toContain("0:05")
  })

  it("highlights the active inline cue as the player time changes", async () => {
    const { player, playerRef } = makePlayerRef(6)

    await act(async () => {
      root.render(
        <SubtitleTranscript
          subtitles={[englishSubtitle]}
          audioSlug="english"
          playerRef={playerRef}
          displayMode="inlineFlow"
          initialTranscript={{
            vttSrc: englishSubtitle.vttSrc,
            cues: [
              { start: 5, end: 8, text: "First active cue." },
              { start: 8, end: 12, text: "Second active cue." },
            ],
          }}
        />,
      )
    })

    expect(
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("First active cue."))
        ?.getAttribute("aria-current"),
    ).toBe("true")

    await act(async () => {
      player.currentTime = 9
      player.dispatchEvent(new Event("timeupdate"))
    })

    expect(
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Second active cue."))
        ?.getAttribute("aria-current"),
    ).toBe("true")
  })
})
