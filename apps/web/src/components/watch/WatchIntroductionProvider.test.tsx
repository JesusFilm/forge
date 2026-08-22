/** @vitest-environment jsdom */

import { act, useEffect, useRef, type ReactNode } from "react"
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
const betaModal = vi.hoisted(() => ({
  openModal: vi.fn<(trigger?: HTMLElement | null) => boolean>(() => true),
}))

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

vi.mock("@/components/watch/BetaTesterModalProvider", () => ({
  useBetaTesterModal: () => ({ openModal: betaModal.openModal }),
}))

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockWatchIntroductionTour({
      open,
      onSkip,
      onComplete,
      onSignup,
    }: {
      open: boolean
      onSkip: () => void
      onComplete: () => void
      onSignup: () => boolean
    }) {
      lazyTour.renders += 1
      return open ? (
        <div role="dialog" data-testid="watch-introduction-tour">
          <button type="button" onClick={onSkip}>
            Skip
          </button>
          <button type="button" onClick={onComplete}>
            Done
          </button>
          <button type="button" onClick={onSignup}>
            Sign up
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
  betaModal.openModal.mockReset()
  betaModal.openModal.mockReturnValue(true)
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
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    introduction.registerReplayTrigger(buttonRef.current)
    return () => introduction.registerReplayTrigger(null)
  }, [introduction])
  return (
    <button
      ref={buttonRef}
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

  it("returns focus to the stable replay action after an automatic tour closes", () => {
    render()
    const replay = document.querySelector(
      "[data-testid='replay']",
    ) as HTMLButtonElement

    finishAutomaticDelay()
    const skip = [...document.querySelectorAll("[role='dialog'] button")].find(
      (candidate) => candidate.textContent === "Skip",
    ) as HTMLButtonElement
    act(() => skip.click())

    expect(document.activeElement).toBe(replay)
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

  it("completes only after the beta signup request is accepted and uses the stable replay trigger", () => {
    render()
    const replay = document.querySelector(
      "[data-testid='replay']",
    ) as HTMLButtonElement

    finishAutomaticDelay()
    const signup = [
      ...document.querySelectorAll("[role='dialog'] button"),
    ].find(
      (candidate) => candidate.textContent === "Sign up",
    ) as HTMLButtonElement
    act(() => signup.click())

    expect(betaModal.openModal).toHaveBeenCalledWith(replay)
    expect(window.localStorage.getItem(WATCH_INTRODUCTION_STORAGE_KEY)).toBe(
      "completed",
    )
    expect(document.querySelector("[role='dialog']")).toBeNull()
  })

  it("keeps the final tour open and incomplete when the beta signup request is rejected", () => {
    betaModal.openModal.mockReturnValue(false)
    render()
    const replay = document.querySelector(
      "[data-testid='replay']",
    ) as HTMLButtonElement

    act(() => replay.click())
    const signup = [
      ...document.querySelectorAll("[role='dialog'] button"),
    ].find(
      (candidate) => candidate.textContent === "Sign up",
    ) as HTMLButtonElement
    act(() => signup.click())

    expect(
      window.localStorage.getItem(WATCH_INTRODUCTION_STORAGE_KEY),
    ).toBeNull()
    expect(document.querySelector("[role='dialog']")).not.toBeNull()
  })

  it("completes through Done without requesting the beta modal", () => {
    render()
    const replay = document.querySelector(
      "[data-testid='replay']",
    ) as HTMLButtonElement

    act(() => replay.click())
    const done = [...document.querySelectorAll("[role='dialog'] button")].find(
      (candidate) => candidate.textContent === "Done",
    ) as HTMLButtonElement
    act(() => done.click())

    expect(betaModal.openModal).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(WATCH_INTRODUCTION_STORAGE_KEY)).toBe(
      "completed",
    )
  })

  it("does not duplicate automatic timers or lazy mounts across rerenders", () => {
    render(<main>First render</main>)
    render(<main>Second render</main>)

    expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
    finishAutomaticDelay()

    expect(lazyTour.renders).toBe(1)
  })
})
