/** @vitest-environment jsdom */

import { act, useEffect, useRef, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const route = vi.hoisted(() => ({
  locale: "en",
  pathname: "/watch",
  surface: "language-home" as
    | "language-home"
    | "experience"
    | "english-video"
    | null,
}))
const lazyTour = vi.hoisted(() => ({
  finalFocus: undefined as false | object | undefined,
  mode: "loaded" as "failed" | "loaded" | "loading" | "render-failed",
  renders: 0,
  retry: vi.fn(),
}))
const betaModal = vi.hoisted(() => ({
  openModal: vi.fn<(trigger?: HTMLElement | null) => boolean>(() => true),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
}))

vi.mock("next-intl", () => ({
  useLocale: () => route.locale,
  useTranslations: () => (key: string) =>
    (
      ({
        close: "Close introduction",
        loadFailed: "The introduction could not be loaded.",
        loading: "Loading the introduction...",
        retry: "Try again",
        "steps.discover.title": "Discover free films and stories",
      }) as Record<string, string>
    )[key] ?? key,
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
  default: (
    _loader: unknown,
    options: {
      loading: (props: { error: Error | null; retry: () => void }) => ReactNode
    },
  ) => {
    return function MockWatchIntroductionTour({
      finalFocus,
      open,
      onSkip,
      onComplete,
      onSignup,
    }: {
      finalFocus: false | object
      open: boolean
      onSkip: () => void
      onComplete: () => void
      onSignup: () => boolean
    }) {
      lazyTour.renders += 1
      lazyTour.finalFocus = finalFocus
      if (lazyTour.mode === "render-failed") {
        throw new Error("introduction render failed")
      }
      if (lazyTour.mode !== "loaded") {
        return options.loading({
          error:
            lazyTour.mode === "failed"
              ? new Error("introduction chunk failed")
              : null,
          retry: lazyTour.retry,
        })
      }
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
    }
  },
}))

import {
  WatchIntroductionProvider,
  WatchIntroductionContextError,
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
  route.locale = "en"
  route.surface = "language-home"
  lazyTour.mode = "loaded"
  lazyTour.finalFocus = undefined
  lazyTour.renders = 0
  lazyTour.retry.mockReset()
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

async function flushDialogEffects() {
  await act(async () => {
    await Promise.resolve()
    vi.advanceTimersByTime(50)
    await Promise.resolve()
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

  it("owns focus while the tour chunk loads and closes without completing", async () => {
    lazyTour.mode = "loading"
    const media = makeMedia()
    render(
      <>
        <a href="#watch" data-testid="floating-header-logo">
          Watch home
        </a>
        <MediaOwner media={media} />
      </>,
    )

    finishAutomaticDelay()
    await flushDialogEffects()

    const dialog = document.querySelector(
      "[data-testid='watch-introduction-tour-loading']",
    ) as HTMLElement
    const close = document.querySelector(
      "[data-testid='watch-introduction-loading-close']",
    ) as HTMLButtonElement
    expect(dialog.contains(close)).toBe(true)
    expect(document.activeElement).toBe(close)

    act(() => close.click())
    expect(
      window.localStorage.getItem(WATCH_INTRODUCTION_STORAGE_KEY),
    ).toBeNull()
    expect(media.play).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(WATCH_MODAL_CLOSE_DELAY_MS))
    expect(media.play).toHaveBeenCalledOnce()
  })

  it("offers retry when the tour chunk fails", async () => {
    lazyTour.mode = "failed"
    render()

    finishAutomaticDelay()
    await flushDialogEffects()

    const retry = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Try again",
    ) as HTMLButtonElement
    expect(document.body.textContent).toContain(
      "The introduction could not be loaded.",
    )
    expect(document.activeElement).toBe(retry)

    act(() => retry.click())
    expect(lazyTour.retry).toHaveBeenCalledOnce()
  })

  it("recovers from a render-time tour failure without completing it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    lazyTour.mode = "render-failed"
    render()

    finishAutomaticDelay()
    await flushDialogEffects()

    expect(document.body.textContent).toContain(
      "The introduction could not be loaded.",
    )
    const retry = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Try again",
    ) as HTMLButtonElement
    expect(document.activeElement).toBe(retry)
    expect(
      window.localStorage.getItem(WATCH_INTRODUCTION_STORAGE_KEY),
    ).toBeNull()

    lazyTour.mode = "loaded"
    act(() => retry.click())
    expect(
      document.querySelector("[data-testid='watch-introduction-tour']"),
    ).not.toBeNull()
    consoleError.mockRestore()
  })

  it("throws a typed error when the required context is absent", () => {
    function Consumer() {
      useWatchIntroduction()
      return null
    }

    expect(() => renderToString(<Consumer />)).toThrow(
      WatchIntroductionContextError,
    )
  })

  it("returns automatic-tour focus to fixed Watch chrome without scrolling", () => {
    render(
      <>
        <a href="#watch" data-testid="floating-header-logo">
          Watch home
        </a>
        <ReplayButton />
      </>,
    )
    const logo = document.querySelector(
      "[data-testid='floating-header-logo']",
    ) as HTMLAnchorElement
    const focus = vi.spyOn(logo, "focus")

    finishAutomaticDelay()
    const skip = [...document.querySelectorAll("[role='dialog'] button")].find(
      (candidate) => candidate.textContent === "Skip",
    ) as HTMLButtonElement
    act(() => skip.click())

    expect(document.activeElement).toBe(logo)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it("does not schedule automatic opening on an excluded route surface", () => {
    route.surface = "english-video"
    render()

    finishAutomaticDelay()

    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(lazyTour.renders).toBe(0)
  })

  it("does not automatically open in a catalog whose tour copy is pending", () => {
    route.locale = "fr"
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

  it("completes only after the beta signup request is accepted and preserves the automatic focus origin", () => {
    render(
      <>
        <a href="#watch" data-testid="floating-header-logo">
          Watch home
        </a>
        <ReplayButton />
      </>,
    )
    const logo = document.querySelector(
      "[data-testid='floating-header-logo']",
    ) as HTMLAnchorElement

    finishAutomaticDelay()
    const signup = [
      ...document.querySelectorAll("[role='dialog'] button"),
    ].find(
      (candidate) => candidate.textContent === "Sign up",
    ) as HTMLButtonElement
    act(() => signup.click())

    expect(betaModal.openModal).toHaveBeenCalledWith(logo)
    expect(lazyTour.finalFocus).toBe(false)
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
