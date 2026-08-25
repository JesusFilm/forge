/**
 * @vitest-environment jsdom
 */

import { createRef, type RefObject } from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import type { MuxPlayerRef } from "@forge/video-player"

import { SubtitleTranscript } from "@/components/watch/SubtitleTranscript"
import type { WatchSubtitle } from "@/lib/content"
import { formatCompactTranscript } from "@/lib/subtitle-transcript"

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

const serverCues = [
  { start: 5, end: 8, text: "First server-rendered cue." },
  { start: 9, end: 12, text: "Second server-rendered cue." },
  { start: 65, end: 70, text: "Third server-rendered cue." },
]
// Derived from the production formatter, not a hand-written join: a fixture
// that encodes a retired format makes every render test exercise a string
// production no longer emits.
const serverCompactText = formatCompactTranscript(serverCues)
const serverVtt = `WEBVTT

00:00:05.000 --> 00:00:08.000
First server-rendered cue.

00:00:09.000 --> 00:00:12.000
Second server-rendered cue.

00:01:05.000 --> 00:01:10.000
Third server-rendered cue.`
const amharicVtt = `WEBVTT

00:00:02.000 --> 00:00:04.000
Amharic cue.`

let container: HTMLDivElement
let root: Root

type RenderTranscriptOptions = {
  audioSlug?: string | null
  componentKey?: string
  compactText?: string
  playerRef?: RefObject<MuxPlayerRef | null>
  subtitles?: WatchSubtitle[]
  vttSrc?: string
}

function renderTranscript({
  audioSlug = "english",
  componentKey,
  compactText = serverCompactText,
  playerRef = createRef<MuxPlayerRef | null>(),
  subtitles = [englishSubtitle],
  vttSrc = englishSubtitle.vttSrc,
}: RenderTranscriptOptions = {}) {
  act(() => {
    root.render(
      <SubtitleTranscript
        key={componentKey}
        subtitles={subtitles}
        audioSlug={audioSlug}
        playerRef={playerRef}
        initialTranscript={{ vttSrc, compactText }}
      />,
    )
  })
}

function getTranscriptToggle(): HTMLButtonElement {
  const toggle = container.querySelector(
    '[data-testid="watch-subtitle-transcript-toggle"]',
  ) as HTMLButtonElement | null
  expect(toggle).not.toBeNull()
  return toggle!
}

async function toggleTranscript(): Promise<HTMLButtonElement> {
  const toggle = getTranscriptToggle()
  const wasExpanded = toggle.getAttribute("aria-expanded") === "true"
  await act(async () => {
    toggle.click()
  })
  await act(async () => {
    await vi.waitFor(() => {
      if (wasExpanded) {
        expect(
          container.querySelector(
            '[data-testid="watch-subtitle-compact-text"]',
          ),
        ).not.toBeNull()
        return
      }

      const settled =
        container.querySelector('[data-testid="watch-subtitle-cues"]') !==
          null || container.textContent?.includes("unavailable")
      expect(settled).toBe(true)
    })
  })
  return toggle
}

beforeAll(async () => {
  // Prime Vitest's module transform cache so React's `act` can observe the
  // lazy module resolving. Production still loads this module on expansion.
  await import("../InteractiveSubtitleTranscript")
})

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({
    ok: true,
    text: async () => serverVtt,
  })
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

  it("renders server-provided compact text with cue breaks in one non-interactive text block", () => {
    renderTranscript()

    const compactText = container.querySelector(
      '[data-testid="watch-subtitle-compact-text"]',
    )
    expect(compactText?.textContent).toBe(serverCompactText)
    expect(compactText?.classList).toContain("whitespace-pre-line")
    expect(compactText?.querySelectorAll("*")).toHaveLength(0)
    expect(
      container.querySelector('[data-testid="watch-subtitle-cues"]'),
    ).toBeNull()
    expect(container.querySelector("time")).toBeNull()
    // Only the header chevron: the collapsed block is a plain, non-interactive
    // text container again, so nothing focusable unmounts on expansion.
    expect(container.querySelectorAll("button")).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("clamps the collapsed transcript to about 60% of the viewport and fades its bottom", () => {
    renderTranscript()

    const compactText = container.querySelector(
      '[data-testid="watch-subtitle-compact-text"]',
    ) as HTMLElement | null
    expect(compactText).not.toBeNull()
    expect(compactText?.className).toContain("overflow-hidden")
    expect(compactText?.className).toContain(
      "max-h-[max(6rem,calc(60svh_-_15rem))]",
    )
    expect(compactText?.className).toContain("[mask-image:linear-gradient(")
    expect(compactText?.className).toContain(
      "[-webkit-mask-image:linear-gradient(",
    )
  })

  it("drops the bottom fade once the collapsed text is measured as fitting", () => {
    const observerCallbacks: Array<() => void> = []
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observerCallbacks.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )

    renderTranscript()

    const compactText = container.querySelector(
      '[data-testid="watch-subtitle-compact-text"]',
    ) as HTMLElement
    expect(compactText.className).toContain("[mask-image:linear-gradient(")

    const setBox = (clientHeight: number, scrollHeight: number) => {
      Object.defineProperty(compactText, "clientHeight", {
        configurable: true,
        value: clientHeight,
      })
      Object.defineProperty(compactText, "scrollHeight", {
        configurable: true,
        value: scrollHeight,
      })
      act(() => {
        for (const callback of observerCallbacks) callback()
      })
    }

    // Unmeasurable box: the fade must survive, otherwise every overflowing
    // transcript loses its "there is more" hint.
    setBox(0, 0)
    expect(compactText.className).toContain("[mask-image:linear-gradient(")

    // Overflowing box keeps the fade.
    setBox(400, 2400)
    expect(compactText.className).toContain("[mask-image:linear-gradient(")

    // Fits inside the clamp: no fade, because there is nothing more to read.
    setBox(400, 400)
    expect(compactText.className).not.toContain("[mask-image:linear-gradient(")
    expect(compactText.className).not.toContain(
      "[-webkit-mask-image:linear-gradient(",
    )
  })

  it("expands to the interactive transcript when the collapsed block is clicked", async () => {
    renderTranscript()

    const expandBlock = container.querySelector(
      '[data-testid="watch-subtitle-compact-expand"]',
    ) as HTMLElement | null
    expect(expandBlock).not.toBeNull()
    // Mouse-only surface: not a button, not focusable, not named for AT. The
    // header chevron owns the accessible disclosure.
    expect(expandBlock?.tagName).toBe("DIV")
    expect(expandBlock?.getAttribute("role")).toBeNull()
    expect(expandBlock?.getAttribute("tabindex")).toBeNull()
    expect(expandBlock?.getAttribute("aria-label")).toBeNull()

    await act(async () => {
      expandBlock!.click()
    })
    await act(async () => {
      await vi.waitFor(() => {
        expect(
          container.querySelector('[data-testid="watch-subtitle-cues"]'),
        ).not.toBeNull()
      })
    })

    expect(
      container.querySelector('[data-testid="watch-subtitle-compact-text"]'),
    ).toBeNull()
    expect(getTranscriptToggle().getAttribute("aria-expanded")).toBe("true")
  })

  it("server-renders the complete transcript text for crawlers, untruncated", () => {
    // The collapsed teaser is the ONLY transcript text in the initial HTML.
    // Search and AI crawlers read it from the markup, so the clamp must hide
    // overflow visually while leaving every character in the DOM. A truncating
    // "optimization" would pass every other test in this file.
    const cues = Array.from({ length: 400 }, (_, index) => ({
      start: index * 4,
      end: index * 4 + 3,
      text: `Cue ${index + 1} carries meaningful indexable words.`,
    }))
    const full = formatCompactTranscript(cues)

    renderTranscript({ componentKey: "crawlable", compactText: full })

    const node = container.querySelector(
      '[data-testid="watch-subtitle-compact-text"]',
    )
    expect(node?.textContent).toBe(full)
    expect(node?.textContent).toContain("Cue 1 ")
    expect(node?.textContent).toContain("Cue 400 ")
    // Present as real text, not injected by a script tag or a JS-only path.
    expect(node?.querySelectorAll("script")).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps the fade when ResizeObserver is unavailable, and re-measures on resize", () => {
    // apps/web/vitest.setup.ts installs a global MockResizeObserver, so this
    // branch is otherwise unreachable in the whole suite even though it is the
    // only measurement path on a browser without ResizeObserver.
    vi.stubGlobal("ResizeObserver", undefined)
    const addSpy = vi.spyOn(window, "addEventListener")

    renderTranscript()

    const compactText = container.querySelector(
      '[data-testid="watch-subtitle-compact-text"]',
    ) as HTMLElement
    expect(compactText.className).toContain("[mask-image:linear-gradient(")
    expect(
      addSpy.mock.calls.filter(([event]) => event === "resize"),
    ).toHaveLength(1)
  })

  it("does not expand on the second click of a double-click", async () => {
    // Expanding mounts the cue list synchronously once cues are cached, so an
    // unguarded second click can land on a cue button and seek/unmute/play.
    renderTranscript()
    const block = () =>
      container.querySelector(
        '[data-testid="watch-subtitle-compact-expand"]',
      ) as HTMLElement | null

    const target = block()!
    await act(async () => {
      target.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 2 }),
      )
    })

    expect(block()).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getTranscriptToggle().getAttribute("aria-expanded")).toBe("false")
  })

  it("does not expand when the click ends a text selection", async () => {
    renderTranscript()
    const selection = { isCollapsed: false } as Selection
    vi.spyOn(window, "getSelection").mockReturnValue(selection)

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-subtitle-compact-expand"]',
        ) as HTMLElement
      ).click()
    })

    expect(
      container.querySelector('[data-testid="watch-subtitle-compact-text"]'),
    ).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("puts nothing focusable inside the collapsed block", () => {
    // This is the property that prevents the focus-stranding bug: if the
    // collapsed surface owns a focusable element, expanding unmounts it and
    // focus falls to <body>. Verified previously by hand: with the block as a
    // <button>, document.activeElement was BODY after activation.
    renderTranscript()

    const block = container.querySelector(
      '[data-testid="watch-subtitle-compact-expand"]',
    ) as HTMLElement
    expect(
      block.querySelectorAll(
        'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]',
      ),
    ).toHaveLength(0)
    expect(block.matches("button, a[href], [tabindex]")).toBe(false)
  })

  it("keeps focus on a control that survives expansion", async () => {
    // The previous implementation made the collapsed block a button; activating
    // it unmounted the focused element and dropped focus to <body>, stranding
    // keyboard and screen-reader users at the top of the document.
    renderTranscript()
    const toggle = getTranscriptToggle()
    toggle.focus()
    expect(document.activeElement).toBe(toggle)

    await act(async () => {
      toggle.click()
    })
    await act(async () => {
      await vi.waitFor(() => {
        expect(
          container.querySelector('[data-testid="watch-subtitle-cues"]'),
        ).not.toBeNull()
      })
    })

    expect(document.activeElement).toBe(getTranscriptToggle())
    expect(document.activeElement).not.toBe(document.body)
  })

  it("keeps the collapsed element count bounded for a long transcript", () => {
    const longTranscript = formatCompactTranscript(
      Array.from({ length: 500 }, (_, index) => ({
        start: index,
        end: index + 1,
        text: `Cue ${index + 1}`,
      })),
    )

    renderTranscript({ componentKey: "short" })

    const shortElementCount = container
      .querySelector('[data-testid="watch-subtitle-transcript"]')
      ?.querySelectorAll("*").length

    renderTranscript({ componentKey: "long", compactText: longTranscript })

    const transcript = container.querySelector(
      '[data-testid="watch-subtitle-transcript"]',
    )
    expect(transcript?.querySelectorAll("*").length).toBe(shortElementCount)
    expect(
      transcript?.querySelector('[data-testid="watch-subtitle-compact-text"]')
        ?.textContent,
    ).toContain("Cue 500")
    expect(transcript?.querySelectorAll("time")).toHaveLength(0)
    expect(transcript?.querySelectorAll("button")).toHaveLength(1)
  })

  it("does not load interactive transcript data when the collapsed audio source changes", () => {
    renderTranscript({
      audioSlug: null,
      subtitles: [englishSubtitle, amharicSubtitle],
    })

    renderTranscript({
      audioSlug: "amharic",
      subtitles: [englishSubtitle, amharicSubtitle],
      vttSrc: englishSubtitle.vttSrc,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain("unavailable")
    expect(
      container.querySelector('[data-testid="watch-subtitle-cues"]'),
    ).toBeNull()
  })

  it("fetches and mounts timestamped cue controls only after expansion", async () => {
    renderTranscript()

    const toggle = getTranscriptToggle()
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    const controlledContent = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    )
    expect(controlledContent).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    await toggleTranscript()

    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(englishSubtitle.vttSrc, {
      credentials: "omit",
      signal: expect.any(AbortSignal),
    })
    expect(
      container.querySelector('[data-testid="watch-subtitle-compact-text"]'),
    ).toBeNull()
    expect(
      container.querySelectorAll(
        '[data-testid="watch-subtitle-cues"] li > button',
      ),
    ).toHaveLength(serverCues.length)
    expect(
      Array.from(container.querySelectorAll("time"), ({ textContent }) =>
        textContent?.trim(),
      ),
    ).toEqual(["0:05", "0:09", "1:05"])

    await toggleTranscript()

    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(
      container.querySelector('[data-testid="watch-subtitle-cues"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="watch-subtitle-compact-text"]')
        ?.textContent,
    ).toContain("Third server-rendered cue.")
    await toggleTranscript()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("subscribes to player time only while interactive cue controls are mounted", async () => {
    const player = document.createElement("video")
    const playerRef = {
      current: player as unknown as MuxPlayerRef,
    }
    const addEventListenerSpy = vi.spyOn(player, "addEventListener")
    const removeEventListenerSpy = vi.spyOn(player, "removeEventListener")

    renderTranscript({ playerRef })

    expect(addEventListenerSpy).not.toHaveBeenCalledWith(
      "timeupdate",
      expect.any(Function),
    )
    expect(addEventListenerSpy).not.toHaveBeenCalledWith(
      "seeking",
      expect.any(Function),
    )

    await toggleTranscript()

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "timeupdate",
      expect.any(Function),
    )
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "seeking",
      expect.any(Function),
    )

    const timeupdateListener = addEventListenerSpy.mock.calls.find(
      ([type]) => type === "timeupdate",
    )?.[1]
    const seekingListener = addEventListenerSpy.mock.calls.find(
      ([type]) => type === "seeking",
    )?.[1]
    expect(timeupdateListener).toBeTypeOf("function")
    expect(seekingListener).toBeTypeOf("function")

    act(() => {
      player.currentTime = 9.5
      player.dispatchEvent(new Event("timeupdate"))
    })
    const cueButtons = container.querySelectorAll(
      '[data-testid="watch-subtitle-cues"] li > button',
    )
    expect(cueButtons[1]?.getAttribute("aria-current")).toBe("true")

    act(() => {
      player.currentTime = 8.5
      player.dispatchEvent(new Event("seeking"))
    })
    expect(
      Array.from(cueButtons).some(
        (button) => button.getAttribute("aria-current") === "true",
      ),
    ).toBe(false)

    await toggleTranscript()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "timeupdate",
      timeupdateListener,
    )
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "seeking",
      seekingListener,
    )
  })

  it("loads each selected language once and reuses its cached cues", async () => {
    fetchMock.mockImplementation(async (input: string) => ({
      ok: true,
      text: async () =>
        input === amharicSubtitle.vttSrc ? amharicVtt : serverVtt,
    }))
    renderTranscript({
      audioSlug: null,
      subtitles: [englishSubtitle, amharicSubtitle],
    })

    expect(
      container.querySelector('[data-testid="watch-subtitle-language"]'),
    ).toBeNull()

    await toggleTranscript()

    const selector = container.querySelector(
      '[data-testid="watch-subtitle-language"]',
    ) as HTMLSelectElement
    expect(selector).not.toBeNull()

    await act(async () => {
      selector.value = "amharic"
      selector.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(container.textContent).toContain("Amharic cue.")
    })

    await act(async () => {
      selector.value = "english"
      selector.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain("First server-rendered cue.")
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([vttSrc]) => vttSrc)).toEqual([
      englishSubtitle.vttSrc,
      amharicSubtitle.vttSrc,
    ])
  })

  it("aborts a pending interactive load without restarting it after collapse", async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}))
    renderTranscript()

    const toggle = getTranscriptToggle()
    await act(async () => {
      toggle.click()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    })
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal

    await act(async () => {
      toggle.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(signal.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(
      container.querySelector('[data-testid="watch-subtitle-compact-text"]'),
    ).not.toBeNull()
  })

  it("preserves cue seeking after the transcript is expanded", async () => {
    const player = document.createElement("video")
    const playMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(player, "play", {
      configurable: true,
      value: playMock,
    })
    const playerRef = {
      current: player as unknown as MuxPlayerRef,
    }
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined)

    renderTranscript({ playerRef })

    await toggleTranscript()

    const secondCue = container.querySelectorAll(
      '[data-testid="watch-subtitle-cues"] li > button',
    )[1] as HTMLButtonElement
    act(() => {
      secondCue.click()
    })

    expect(player.currentTime).toBe(serverCues[1]!.start)
    expect(player.muted).toBe(false)
    expect(playMock).toHaveBeenCalledOnce()
    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    })
  })

  it("does not seek when a cue click is part of a multi-click gesture", async () => {
    // Confirmed in Chrome before this guard existed: double-clicking the
    // collapsed teaser expanded the transcript, and 150ms later the second
    // click landed on a cue button that had mounted under the pointer --
    // seeking, unmuting and playing. Reproduced at the cue button because that
    // is where the errant click actually lands; a guard on the collapsed
    // surface alone does not stop it.
    const player = document.createElement("video")
    const playMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(player, "play", {
      configurable: true,
      value: playMock,
    })
    const playerRef = { current: player as unknown as MuxPlayerRef }
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined)

    renderTranscript({ playerRef })
    await toggleTranscript()

    const cue = container.querySelectorAll(
      '[data-testid="watch-subtitle-cues"] li > button',
    )[1] as HTMLButtonElement

    act(() => {
      cue.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }))
    })

    expect(player.currentTime).toBe(0)
    expect(player.muted).toBe(false)
    expect(playMock).not.toHaveBeenCalled()
    expect(scrollToSpy).not.toHaveBeenCalled()

    // A fresh single click still seeks.
    act(() => {
      cue.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    })
    expect(player.currentTime).toBe(serverCues[1]!.start)
    expect(playMock).toHaveBeenCalledOnce()
  })

  it("keeps compact text available when lazy cue loading fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, text: async () => "" })
    renderTranscript()

    await toggleTranscript()

    expect(container.textContent).toContain("unavailable")
    expect(
      container.querySelector('[data-testid="watch-subtitle-cues"]'),
    ).toBeNull()

    await toggleTranscript()

    expect(
      container.querySelector('[data-testid="watch-subtitle-compact-text"]')
        ?.textContent,
    ).toBe(serverCompactText)

    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => serverVtt })
    await toggleTranscript()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      container.querySelector('[data-testid="watch-subtitle-cues"]'),
    ).not.toBeNull()
  })

  it("treats an empty lazy VTT as unavailable", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => "WEBVTT" })
    renderTranscript()

    await toggleTranscript()

    expect(container.textContent).toContain("unavailable")
    expect(
      container.querySelector('[data-testid="watch-subtitle-cues"]'),
    ).toBeNull()
  })
})
