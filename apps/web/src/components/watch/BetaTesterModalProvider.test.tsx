/** @vitest-environment jsdom */

import { act, useState, type ReactNode } from "react"
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
        <div role="dialog" data-testid="lazy-beta-tester-modal">
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
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
})

function click(selector: string) {
  const element = document.querySelector(selector) as HTMLElement | null
  expect(element).not.toBeNull()
  act(() => element?.click())
}

function renderProvider(children: ReactNode = <main>Watch page</main>) {
  act(() => {
    root.render(
      <WatchModalActivityProvider>
        <BetaTesterModalProvider>{children}</BetaTesterModalProvider>
      </WatchModalActivityProvider>,
    )
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

describe("BetaTesterModalProvider", () => {
  it("exposes the global CTA without rendering the lazy modal initially", () => {
    renderProvider()

    expect(
      document.querySelector("[data-testid='global-beta-tester-cta']"),
    ).not.toBeNull()
    expect(
      document.querySelector("[data-testid='lazy-beta-tester-modal']"),
    ).toBeNull()
  })

  it("renders the global CTA in the active Watch locale", () => {
    setRequestLocale("ru")
    renderProvider(<main>Страница Watch</main>)

    expect(
      document.querySelector("[data-testid='global-beta-tester-cta']")
        ?.textContent,
    ).toBe("Стать бета-тестером")
  })

  it("opens one shared modal from both global and nested triggers", () => {
    renderProvider(<BetaTesterTrigger>Home beta action</BetaTesterTrigger>)

    click("[data-testid='global-beta-tester-cta']")
    expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1)
    click("[role='dialog'] button")
    click("button:not([data-testid='global-beta-tester-cta'])")
    expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1)
  })

  it("recovers from the dynamic loading shell once the modal resolves", () => {
    lazyModal.stalled = true
    renderProvider()
    click("[data-testid='global-beta-tester-cta']")

    expect(
      document.querySelector("[data-testid='beta-tester-modal-loading']"),
    ).not.toBeNull()
    expect(
      document.querySelector("[data-testid='lazy-beta-tester-modal']"),
    ).toBeNull()

    lazyModal.stalled = false
    renderProvider()
    expect(
      document.querySelector("[data-testid='beta-tester-modal-loading']"),
    ).toBeNull()
    expect(document.querySelector("[role='dialog']")).not.toBeNull()
  })

  it("can dismiss a stalled modal chunk and use the external fallback", async () => {
    lazyModal.stalled = true
    renderProvider()
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

  it("pauses playing media and resumes it after a same-route close", async () => {
    const media = makeMedia()
    renderProvider(<MediaOwner media={media} />)

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

  it("does not resume media that was already paused", () => {
    const media = makeMedia({ paused: true })
    renderProvider(<MediaOwner media={media} />)

    click("[data-testid='global-beta-tester-cta']")
    click("[role='dialog'] button")

    expect(media.pause).not.toHaveBeenCalled()
    expect(media.play).not.toHaveBeenCalled()
  })

  it("handles a rejected resume without leaving the modal open", async () => {
    const media = makeMedia({ rejectPlay: true })
    renderProvider(<MediaOwner media={media} />)
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

  it("pauses playing media that attaches after the modal opens", () => {
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

    renderProvider(<LateMediaOwner />)
    click("[data-testid='global-beta-tester-cta']")
    expect(media.pause).not.toHaveBeenCalled()

    click("[data-testid='attach-late-media']")
    expect(media.pause).toHaveBeenCalledOnce()

    click("[role='dialog'] button")
    expect(media.play).not.toHaveBeenCalled()
  })

  it("closes without resuming route-owned media when the pathname changes", () => {
    const media = makeMedia()
    renderProvider(<MediaOwner media={media} />)
    click("[data-testid='global-beta-tester-cta']")
    expect(media.pause).toHaveBeenCalledOnce()

    navigation.pathname = "/watch/videos"
    renderProvider(<MediaOwner media={media} />)

    expect(document.querySelector("[role='dialog']")).toBeNull()
    expect(media.play).not.toHaveBeenCalled()
  })

  it("blocks both beta triggers while search owns the page", () => {
    search.searchOpen = true
    renderProvider(<BetaTesterTrigger>Nested beta action</BetaTesterTrigger>)

    const globalTrigger = document.querySelector(
      "[data-testid='global-beta-tester-cta']",
    ) as HTMLButtonElement
    expect(globalTrigger.disabled).toBe(true)
    click("button:not([data-testid='global-beta-tester-cta'])")
    expect(document.querySelector("[role='dialog']")).toBeNull()
  })

  it("keeps a hidden global trigger out of keyboard and activation paths", () => {
    search.playerChromeVisible = false
    renderProvider()

    const trigger = document.querySelector(
      "[data-testid='global-beta-tester-cta']",
    ) as HTMLButtonElement
    expect(trigger.disabled || trigger.tabIndex === -1).toBe(true)
    trigger.focus()
    expect(document.activeElement).not.toBe(trigger)
    click("[data-testid='global-beta-tester-cta']")
    expect(document.querySelector("[role='dialog']")).toBeNull()
  })

  it("makes the global trigger unavailable while the question panel owns a modal", () => {
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

    renderProvider(<QuestionPanelOwner />)
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
