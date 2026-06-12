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
})
