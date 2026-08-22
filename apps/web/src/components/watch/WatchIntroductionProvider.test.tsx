/** @vitest-environment jsdom */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const route = vi.hoisted(() => ({
  pathname: "/watch",
  surface: "language-home" as
    | "language-home"
    | "experience"
    | "english-video"
    | null,
}))
const lazyTour = vi.hoisted(() => ({ renders: 0 }))

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
}))

vi.mock("@/components/FloatingSearchContext", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/FloatingSearchContext")>()
  return {
    ...original,
    useWatchRouteSurface: () => route.surface,
  }
})

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockWatchIntroductionTour({
      open,
      onSkip,
    }: {
      open: boolean
      onSkip: () => void
    }) {
      lazyTour.renders += 1
      return open ? (
        <div role="dialog" data-testid="watch-introduction-tour">
          <button type="button" onClick={onSkip}>
            Skip
          </button>
        </div>
      ) : null
    },
}))

import {
  WatchIntroductionProvider,
  useWatchIntroduction,
} from "@/components/watch/WatchIntroductionProvider"
import {
  WATCH_MODAL_CLOSE_DELAY_MS,
  WatchModalActivityProvider,
  usePauseForWatchModal,
} from "@/components/watch/WatchModalActivityProvider"
import { WATCH_PLAYER_PLAYBACK_STATE_EVENT } from "@/lib/watch-player-chrome-events"
import { WATCH_INTRODUCTION_STORAGE_KEY } from "@/lib/watch-introduction-preference"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  route.pathname = "/watch"
  route.surface = "language-home"
  lazyTour.renders = 0
  const values = new Map<string, string>()
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  })
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  })
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function ReplayButton() {
  const introduction = useWatchIntroduction()
  return (
    <button
      type="button"
      data-testid="replay"
      onClick={(event) => introduction.replay(event.currentTarget)}
    >
      Replay
    </button>
  )
}

function MediaOwner({ media }: { media: ReturnType<typeof makeMedia> }) {
  usePauseForWatchModal(media)
  return null
}

function makeMedia() {
  const media = {
    paused: false,
    pause: vi.fn(() => {
      media.paused = true
    }),
    play: vi.fn(() => {
      media.paused = false
      return Promise.resolve()
    }),
  }
  return media
}

function render(children: ReactNode = <ReplayButton />) {
  act(() => {
    root.render(
      <WatchModalActivityProvider>
        <WatchIntroductionProvider>{children}</WatchIntroductionProvider>
      </WatchModalActivityProvider>,
    )
  })
}

function finishAutomaticDelay() {
  act(() => {
    window.dispatchEvent(new Event("load"))
    vi.advanceTimersByTime(1_000)
  })
}

describe("WatchIntroductionProvider", () => {
  it("waits until load and the idle delay before opening on an unmarked home", () => {
    render()

    expect(lazyTour.renders).toBe(0)
    act(() => window.dispatchEvent(new Event("load")))
    act(() => vi.advanceTimersByTime(999))
    expect(document.querySelector("[role='dialog']")).toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(document.querySelector("[role='dialog']")).not.toBeNull()
    expect(lazyTour.renders).toBe(1)
  })

  it("does not schedule automatic opening on an excluded route surface", () => {
    route.surface = "english-video"
    render()

    finishAutomaticDelay()

    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(lazyTour.renders).toBe(0)
  })

  it("does not automatically reopen the current completed version", () => {
    window.localStorage.setItem(WATCH_INTRODUCTION_STORAGE_KEY, "completed")
    render()

    finishAutomaticDelay()

    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(lazyTour.renders).toBe(0)
  })

  it("abandons automatic opening after route navigation", () => {
    render()
    route.pathname = "/watch/jesus.html/english.html"
    render()

    finishAutomaticDelay()

    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(lazyTour.renders).toBe(0)
  })

  it.each([
    ["pointer activity", () => window.dispatchEvent(new Event("pointerdown"))],
    [
      "keyboard activity",
      () => window.dispatchEvent(new KeyboardEvent("keydown")),
    ],
    ["scroll activity", () => window.dispatchEvent(new Event("scroll"))],
    [
      "playback activity",
      () =>
        window.dispatchEvent(
          new CustomEvent(WATCH_PLAYER_PLAYBACK_STATE_EVENT, {
            detail: { playing: true, muted: true },
          }),
        ),
    ],
  ])("abandons the automatic attempt after %s", (_label, interact) => {
    render()
    act(interact)

    finishAutomaticDelay()

    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(lazyTour.renders).toBe(0)
  })

  it("abandons the automatic attempt when the document becomes hidden", () => {
    render()
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    })
    act(() => document.dispatchEvent(new Event("visibilitychange")))

    finishAutomaticDelay()

    expect(document.querySelector("[role='dialog']")).toBeNull()
  })

  it("replays immediately despite a completed marker and restores trigger focus", () => {
    window.localStorage.setItem(WATCH_INTRODUCTION_STORAGE_KEY, "completed")
    render()
    const trigger = document.querySelector(
      "[data-testid='replay']",
    ) as HTMLButtonElement
    trigger.focus()

    act(() => trigger.click())
    expect(document.querySelector("[role='dialog']")).not.toBeNull()
    expect(window.localStorage.getItem(WATCH_INTRODUCTION_STORAGE_KEY)).toBe(
      "completed",
    )

    const skip = document.querySelector("[role='dialog'] button") as HTMLElement
    act(() => skip.click())
    expect(document.activeElement).toBe(trigger)
  })

  it("owns modal activity before the lazy tour mounts and through close delay", async () => {
    const media = makeMedia()
    render(
      <>
        <ReplayButton />
        <MediaOwner media={media} />
      </>,
    )
    const trigger = document.querySelector(
      "[data-testid='replay']",
    ) as HTMLButtonElement

    act(() => trigger.click())
    expect(media.pause).toHaveBeenCalledOnce()

    const skip = document.querySelector("[role='dialog'] button") as HTMLElement
    act(() => skip.click())
    act(() => vi.advanceTimersByTime(WATCH_MODAL_CLOSE_DELAY_MS - 1))
    expect(media.play).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
    expect(media.play).toHaveBeenCalledOnce()
  })

  it("does not duplicate automatic timers or lazy mounts across rerenders", () => {
    render(<main>First render</main>)
    render(<main>Second render</main>)

    expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
    finishAutomaticDelay()

    expect(lazyTour.renders).toBe(1)
  })
})
