/**
 * @vitest-environment jsdom
 */

import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { MuxPlayerRef } from "@forge/video-player"

import { SubtitleOverlay } from "@/components/watch/SubtitleOverlay"
import { FORGE_SUBTITLE_TRACK_LABEL } from "@/components/watch/subtitle-track"

class MockTextTrack extends EventTarget {
  kind: TextTrackKind
  label: string
  language: string
  mode: TextTrackMode
  activeCues: TextTrackCueList | null

  constructor({
    kind = "subtitles",
    label,
    language = "",
    mode,
    activeText,
  }: {
    kind?: TextTrackKind
    label: string
    language?: string
    mode: TextTrackMode
    activeText?: string
  }) {
    super()
    this.kind = kind
    this.label = label
    this.language = language
    this.mode = mode
    this.activeCues =
      activeText == null
        ? null
        : ([
            {
              text: activeText,
              getCueAsHTML: () => {
                const parsed = new DOMParser().parseFromString(
                  activeText,
                  "text/html",
                )
                const fragment = document.createDocumentFragment()
                fragment.append(
                  ...Array.from(parsed.body.childNodes, (node) =>
                    node.cloneNode(true),
                  ),
                )
                return fragment
              },
            },
          ] as unknown as TextTrackCueList)
  }
}

class MockTextTrackList extends EventTarget {
  private tracks: MockTextTrack[] = []

  constructor(tracks: MockTextTrack[]) {
    super()
    this.setTracks(tracks)
  }

  get length() {
    return this.tracks.length
  }

  setTracks(tracks: MockTextTrack[]) {
    for (let i = 0; i < this.tracks.length; i++) {
      Reflect.deleteProperty(this, i)
    }
    this.tracks = tracks
    tracks.forEach((track, index) => {
      Object.defineProperty(this, index, {
        configurable: true,
        enumerable: false,
        value: track,
      })
    })
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
})

async function renderOverlay(
  textTracks: MockTextTrackList,
  controlsVisible = false,
) {
  const wrapper = document.createElement("div")
  wrapper.setAttribute("data-chrome-revealed", "true")
  document.body.appendChild(wrapper)

  const player = document.createElement("video")
  Object.defineProperty(player, "textTracks", {
    configurable: true,
    value: textTracks,
  })

  const playerRef = {
    current: player as unknown as MuxPlayerRef,
  }
  const wrapperRef = {
    current: wrapper,
  }

  const render = async (visible: boolean) => {
    await act(async () => {
      root.render(
        <SubtitleOverlay
          playerRef={playerRef}
          wrapperRef={wrapperRef}
          player={player as unknown as MuxPlayerRef}
          controlsVisible={visible}
        />,
      )
    })
  }

  await render(controlsVisible)

  return { playerRef, wrapperRef, render }
}

async function flushEffects() {
  await act(async () => {})
}

describe("SubtitleOverlay", () => {
  it("moves active subtitles down when player controls hide", async () => {
    const chrome = document.createElement("div")
    chrome.setAttribute("data-testid", "hero-player-custom-chrome")
    chrome.setAttribute("data-visible", "true")
    chrome.getBoundingClientRect = () =>
      ({
        top: 600,
        bottom: 664,
        height: 64,
      }) as DOMRect
    document.body.appendChild(chrome)

    const forgeTrack = new MockTextTrack({
      label: FORGE_SUBTITLE_TRACK_LABEL,
      mode: "showing",
      activeText: "Forge-selected subtitle",
    })
    const textTracks = new MockTextTrackList([forgeTrack])
    const { render } = await renderOverlay(textTracks, true)
    await flushEffects()

    const overlay = container.querySelector(
      '[data-testid="subtitle-overlay"]',
    ) as HTMLElement | null
    expect(overlay?.style.transform).toBe("translateY(-64px)")

    await render(false)
    expect(overlay?.style.transform).toBe("translateY(-0px)")

    await render(true)
    expect(overlay?.style.transform).toBe("translateY(-64px)")
  })

  it("ignores active Mux-generated subtitle tracks", async () => {
    const generatedTrack = new MockTextTrack({
      label: "Generated subtitles",
      language: "en",
      mode: "showing",
      activeText: "How can this be? I am a virgin.",
    })
    const textTracks = new MockTextTrackList([generatedTrack])

    await renderOverlay(textTracks)
    await flushEffects()

    expect(
      container.querySelector('[data-testid="subtitle-overlay"]'),
    ).toBeNull()
    expect(generatedTrack.mode).toBe("showing")
  })

  it("renders cue text from the Forge-injected subtitle track", async () => {
    const forgeTrack = new MockTextTrack({
      label: FORGE_SUBTITLE_TRACK_LABEL,
      language: "ro",
      mode: "showing",
      activeText: "<c>Forge-selected subtitle</c>",
    })
    const textTracks = new MockTextTrackList([forgeTrack])

    await renderOverlay(textTracks)
    await flushEffects()

    const overlay = container.querySelector('[data-testid="subtitle-overlay"]')
    const cue = overlay?.firstElementChild
    expect(overlay?.textContent).toBe("Forge-selected subtitle")
    expect(cue?.className).not.toContain("bg-black/40")
    expect(cue?.className).not.toContain("backdrop-blur-sm")
    expect(cue?.className).toContain("text-shadow")
    expect(forgeTrack.mode).toBe("hidden")
  })

  it("clears overlay text when the active Forge track disappears", async () => {
    const forgeTrack = new MockTextTrack({
      label: FORGE_SUBTITLE_TRACK_LABEL,
      mode: "showing",
      activeText: "Forge-selected subtitle",
    })
    const generatedTrack = new MockTextTrack({
      label: "Generated subtitles",
      language: "en",
      mode: "showing",
      activeText: "Generated subtitle",
    })
    const textTracks = new MockTextTrackList([forgeTrack])

    await renderOverlay(textTracks)
    await flushEffects()
    expect(
      container.querySelector('[data-testid="subtitle-overlay"]')?.textContent,
    ).toBe("Forge-selected subtitle")

    textTracks.setTracks([generatedTrack])
    await act(async () => {
      textTracks.dispatchEvent(new Event("change"))
    })

    expect(
      container.querySelector('[data-testid="subtitle-overlay"]'),
    ).toBeNull()
  })
})
