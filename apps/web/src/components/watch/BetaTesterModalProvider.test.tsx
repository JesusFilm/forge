/** @vitest-environment jsdom */

import { act, useRef, useState, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { setRequestLocale } from "next-intl/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const navigation = { pathname: "/watch" }
const search = {
  pinned: false,
  playerChromeVisible: true,
  searchChromeVisible: true,
  searchChromeDimmed: false,
  searchOpen: false,
}
const lazyModal = vi.hoisted(() => ({ stalled: false }))

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}))

vi.mock("@/components/FloatingSearchProvider", () => ({
  useFloatingSearchPinned: () => search,
}))

vi.mock("next/dynamic", () => ({
  default: (
    _loader: unknown,
    options:
      | {
          loading?: (props: { error: Error | null }) => ReactNode
        }
      | undefined,
  ) =>
    function MockBetaTesterModal({
      open,
      onClose,
    }: {
      open: boolean
      onClose: () => void
    }) {
      if (lazyModal.stalled) return options?.loading?.({ error: null }) ?? null
      return open ? (
        <div role="dialog" data-open data-testid="lazy-beta-tester-modal">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      ) : null
    },
}))

import {
  BetaTesterModalProvider,
  BetaTesterTrigger,
  useBetaTesterModal,
} from "@/components/watch/BetaTesterModalProvider"
import {
  WATCH_MODAL_CLOSE_DELAY_MS,
  WatchModalActivityProvider,
  usePauseForWatchModal,
  useWatchModalActivity,
} from "@/components/watch/WatchModalActivityProvider"
import { BETA_TESTER_URL } from "@/lib/beta-tester"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  setRequestLocale("en")
  navigation.pathname = "/watch"
  search.playerChromeVisible = true
  search.searchOpen = false
  lazyModal.stalled = false
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ enabled: true }, { status: 200 })),
  )
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

function click(selector: string) {
  const element = document.querySelector(selector) as HTMLElement | null
  expect(element).not.toBeNull()
  act(() => element?.click())
}

async function renderProvider(children: ReactNode = <main>Watch page</main>) {
  await act(async () => {
    root.render(
      <WatchModalActivityProvider>
        <BetaTesterModalProvider>{children}</BetaTesterModalProvider>
      </WatchModalActivityProvider>,
    )
    await Promise.resolve()
  })
}

function makeMedia({ paused = false, rejectPlay = false } = {}) {
  const media = {
    paused,
    pause: vi.fn(() => {
      media.paused = true
    }),
    play: vi.fn(() => {
      if (rejectPlay) return Promise.reject(new Error("play blocked"))
      media.paused = false
      return Promise.resolve()
    }),
  }
  return media
}

function MediaOwner({ media }: { media: ReturnType<typeof makeMedia> | null }) {
  usePauseForWatchModal(media)
  return null
}

function HandoffOwner({ media }: { media: ReturnType<typeof makeMedia> }) {
  const modal = useBetaTesterModal()
  const [tourOpen, setTourOpen] = useState(false)
  const replayRef = useRef<HTMLButtonElement>(null)
  useWatchModalActivity(tourOpen)
  usePauseForWatchModal(media)

  return (
    <>
      <button
        type="button"
        data-testid="start-tour"
        onClick={() => setTourOpen(true)}
      >
        Start tour
      </button>
      <button
        ref={replayRef}
        type="button"
        data-testid="watch-introduction-replay"
      >
        Take the Watch tour
      </button>
      <button
        type="button"
        data-testid="handoff-trigger"
        onClick={() => {
          if (modal?.openModal(replayRef.current)) setTourOpen(false)
        }}
      >
        Sign up
      </button>
    </>
  )
}

describe("BetaTesterModalProvider", () => {
  it("defaults off, then exposes the global CTA after an enabled response", async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )

    await renderProvider()

    expect(fetch).toHaveBeenCalledWith("/watch/api/beta-tester-cta", {
      cache: "no-store",
      credentials: "same-origin",
    })
    expect(
      document.querySelector("[data-testid='global-beta-tester-cta']"),
    ).toBeNull()

    await act(async () => {
      resolveFetch?.(Response.json({ enabled: true }))
      await Promise.resolve()
    })

    expect(
      document.querySelector("[data-testid='global-beta-tester-cta']"),
    ).not.toBeNull()
    expect(
      document.querySelector("[data-testid='lazy-beta-tester-modal']"),
    ).toBeNull()
  })

  it("stays off after a failed response while keeping nested modal triggers working", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("request failed"))

    await renderProvider(
      <BetaTesterTrigger>Home beta action</BetaTesterTrigger>,
    )

    expect(
      document.querySelector("[data-testid='global-beta-tester-cta']"),
    ).toBeNull()

    click("button")
    expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1)
  })

  it("refreshes the global CTA flag when navigation remounts the provider", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ enabled: false }))
      .mockResolvedValueOnce(Response.json({ enabled: true }))
      .mockResolvedValueOnce(Response.json({ enabled: false }))

    await renderProvider()
    expect(
      document.querySelector("[data-testid='global-beta-tester-cta']"),
    ).toBeNull()

    navigation.pathname = "/watch/videos"
    await renderProvider()
    expect(
      document.querySelector("[data-testid='global-beta-tester-cta']"),
    ).not.toBeNull()

    navigation.pathname = "/watch/history"
    await renderProvider()
    expect(
      document.querySelector("[data-testid='global-beta-tester-cta']"),
    ).toBeNull()
  })

  it("renders the global CTA in the active Watch locale", async () => {
    setRequestLocale("ru")
    await renderProvider(<main>Страница Watch</main>)

    expect(
      document.querySelector("[data-testid='global-beta-tester-cta']")
        ?.textContent,
    ).toBe("Стать бета-тестером")
  })

  it("opens one shared modal from both global and nested triggers", async () => {
    await renderProvider(
      <BetaTesterTrigger>Home beta action</BetaTesterTrigger>,
    )

    click("[data-testid='global-beta-tester-cta']")
    expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1)
    click("[role='dialog'] button")
    click("button:not([data-testid='global-beta-tester-cta'])")
    expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1)
  })

  it("recovers from the dynamic loading shell once the modal resolves", async () => {
    lazyModal.stalled = true
    await renderProvider()
    click("[data-testid='global-beta-tester-cta']")

    expect(
      document.querySelector("[data-testid='beta-tester-modal-loading']"),
    ).not.toBeNull()
    expect(
      document.querySelector("[data-testid='lazy-beta-tester-modal']"),
    ).toBeNull()

    lazyModal.stalled = false
    await renderProvider()
    expect(
      document.querySelector("[data-testid='beta-tester-modal-loading']"),
    ).toBeNull()
    expect(document.querySelector("[role='dialog']")).not.toBeNull()
  })

  it("can dismiss a stalled modal chunk and use the external fallback", async () => {
    lazyModal.stalled = true
    await renderProvider()
    const trigger = document.querySelector(
      "[data-testid='global-beta-tester-cta']",
    ) as HTMLButtonElement
    click("[data-testid='global-beta-tester-cta']")

    const fallback = document.querySelector(
      `a[href='${BETA_TESTER_URL}']`,
    ) as HTMLAnchorElement
    expect(fallback.target).toBe("_blank")
    expect(fallback.rel).toBe("noopener noreferrer nofollow")

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })
    expect(
      document.querySelector("[data-testid='beta-tester-modal-loading']"),
    ).toBeNull()
    expect(document.body.style.overflow).toBe("")
    expect(document.activeElement).toBe(trigger)
  })

  it("can dismiss a stalled modal chunk from the viewport close icon", async () => {
    lazyModal.stalled = true
    await renderProvider()
    const trigger = document.querySelector(
      "[data-testid='global-beta-tester-cta']",
    ) as HTMLButtonElement
    click("[data-testid='global-beta-tester-cta']")

    const close = document.querySelector(
      "[data-testid='beta-tester-modal-close']",
    ) as HTMLButtonElement
    expect(close.style.top).toContain("safe-area-inset-top")
    expect(close.style.right).toContain("safe-area-inset-right")
    click("[data-testid='beta-tester-modal-close']")

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })
    expect(
      document.querySelector("[data-testid='beta-tester-modal-loading']"),
    ).toBeNull()
    expect(document.body.style.overflow).toBe("")
    expect(document.activeElement).toBe(trigger)
  })

  it("pauses playing media and resumes it after a same-route close", async () => {
    const media = makeMedia()
    await renderProvider(<MediaOwner media={media} />)

    click("[data-testid='global-beta-tester-cta']")
    expect(media.pause).toHaveBeenCalledOnce()
    expect(media.play).not.toHaveBeenCalled()

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[role='dialog'] button")
        ?.click()
      await new Promise((resolve) =>
        window.setTimeout(resolve, WATCH_MODAL_CLOSE_DELAY_MS + 20),
      )
    })
    expect(media.play).toHaveBeenCalledOnce()
  })

  it("does not resume media that was already paused", async () => {
    const media = makeMedia({ paused: true })
    await renderProvider(<MediaOwner media={media} />)

    click("[data-testid='global-beta-tester-cta']")
    click("[role='dialog'] button")

    expect(media.pause).not.toHaveBeenCalled()
    expect(media.play).not.toHaveBeenCalled()
  })

  it("handles a rejected resume without leaving the modal open", async () => {
    const media = makeMedia({ rejectPlay: true })
    await renderProvider(<MediaOwner media={media} />)
    click("[data-testid='global-beta-tester-cta']")

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[role='dialog'] button")
        ?.click()
      await new Promise((resolve) =>
        window.setTimeout(resolve, WATCH_MODAL_CLOSE_DELAY_MS + 20),
      )
    })

    expect(media.play).toHaveBeenCalledOnce()
    expect(document.querySelector("[role='dialog']")).toBeNull()
  })

  it("pauses playing media that attaches after the modal opens", async () => {
    const media = makeMedia()

    function LateMediaOwner() {
      const [attached, setAttached] = useState<ReturnType<
        typeof makeMedia
      > | null>(null)
      usePauseForWatchModal(attached)
      return (
        <button
          type="button"
          data-testid="attach-late-media"
          onClick={() => setAttached(media)}
        >
          Attach media
        </button>
      )
    }

    await renderProvider(<LateMediaOwner />)
    click("[data-testid='global-beta-tester-cta']")
    expect(media.pause).not.toHaveBeenCalled()

    click("[data-testid='attach-late-media']")
    expect(media.pause).toHaveBeenCalledOnce()

    click("[role='dialog'] button")
    expect(media.play).not.toHaveBeenCalled()
  })

  it("closes without resuming route-owned media when the pathname changes", async () => {
    const media = makeMedia()
    await renderProvider(<MediaOwner media={media} />)
    click("[data-testid='global-beta-tester-cta']")
    expect(media.pause).toHaveBeenCalledOnce()

    navigation.pathname = "/watch/videos"
    await renderProvider(<MediaOwner media={media} />)

    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(media.play).not.toHaveBeenCalled()
  })

  it("blocks both beta triggers while search owns the page", async () => {
    search.searchOpen = true
    await renderProvider(
      <BetaTesterTrigger>Nested beta action</BetaTesterTrigger>,
    )

    const globalTrigger = document.querySelector(
      "[data-testid='global-beta-tester-cta']",
    ) as HTMLButtonElement
    expect(globalTrigger.disabled).toBe(true)
    click("button:not([data-testid='global-beta-tester-cta'])")
    expect(document.querySelector("[role='dialog']")).toBeNull()
  })

  it("acknowledges accepted and rejected open requests synchronously", async () => {
    const outcomes: boolean[] = []

    function Probe() {
      const modal = useBetaTesterModal()
      return (
        <button
          type="button"
          data-testid="probe"
          onClick={(event) =>
            outcomes.push(modal?.openModal(event.currentTarget) ?? false)
          }
        >
          Open
        </button>
      )
    }

    search.searchOpen = true
    await renderProvider(<Probe />)
    click("[data-testid='probe']")
    expect(outcomes).toEqual([false])
    expect(document.querySelector("[role='dialog']")).toBeNull()

    search.searchOpen = false
    await renderProvider(<Probe />)
    click("[data-testid='probe']")
    expect(outcomes).toEqual([false, true])
    expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1)
  })

  it("rejects a same-tick question-panel race before enabling the modal chunk", async () => {
    const outcomes: boolean[] = []

    function QuestionRaceProbe() {
      const modal = useBetaTesterModal()
      return (
        <button
          type="button"
          data-testid="question-race"
          onClick={(event) => {
            modal?.setQuestionPanelOpen(true)
            outcomes.push(modal?.openModal(event.currentTarget) ?? false)
          }}
        >
          Open question and beta
        </button>
      )
    }

    await renderProvider(<QuestionRaceProbe />)
    click("[data-testid='question-race']")

    expect(outcomes).toEqual([false])
    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(lazyModal.stalled).toBe(false)
  })

  it("keeps media paused continuously while ownership hands from the tour to beta", async () => {
    vi.useFakeTimers()
    const media = makeMedia()
    await renderProvider(<HandoffOwner media={media} />)
    click("[data-testid='start-tour']")
    expect(media.pause).toHaveBeenCalledOnce()

    click("[data-testid='handoff-trigger']")
    expect(
      document.querySelectorAll("[role='dialog'][data-open]"),
    ).toHaveLength(1)
    act(() => vi.advanceTimersByTime(WATCH_MODAL_CLOSE_DELAY_MS))
    expect(media.play).not.toHaveBeenCalled()

    click("[role='dialog'] button")
    act(() => vi.advanceTimersByTime(WATCH_MODAL_CLOSE_DELAY_MS - 1))
    expect(media.play).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
    expect(media.play).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(
      document.querySelector("[data-testid='watch-introduction-replay']"),
    )
    vi.useRealTimers()
  })

  it("keeps a hidden global trigger out of keyboard and activation paths", async () => {
    search.playerChromeVisible = false
    await renderProvider()

    const trigger = document.querySelector(
      "[data-testid='global-beta-tester-cta']",
    ) as HTMLButtonElement
    expect(trigger.disabled || trigger.tabIndex === -1).toBe(true)
    trigger.focus()
    expect(document.activeElement).not.toBe(trigger)
    click("[data-testid='global-beta-tester-cta']")
    expect(document.querySelector("[role='dialog']")).toBeNull()
  })

  it("makes the global trigger unavailable while the question panel owns a modal", async () => {
    function QuestionPanelOwner() {
      const modal = useBetaTesterModal()
      const [open, setOpen] = useState(false)
      return (
        <button
          type="button"
          data-testid="question-owner"
          onClick={() => {
            setOpen(true)
            modal?.setQuestionPanelOpen(true)
          }}
        >
          {open ? "Question open" : "Open question"}
        </button>
      )
    }

    await renderProvider(<QuestionPanelOwner />)
    click("[data-testid='question-owner']")

    const trigger = document.querySelector(
      "[data-testid='global-beta-tester-cta']",
    ) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    click("[data-testid='global-beta-tester-cta']")
    expect(document.querySelector("[role='dialog']")).toBeNull()
  })
})

describe("BetaTesterTrigger fallback", () => {
  it("uses the exact hardened external link outside the provider", () => {
    act(() => root.render(<BetaTesterTrigger />))
    const link = document.querySelector("a") as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe(BETA_TESTER_URL)
    expect(link.target).toBe("_blank")
    expect(link.rel).toBe("noopener noreferrer nofollow")
  })
})
