// @vitest-environment jsdom
import {
  act,
  createElement,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({
    prefetch: _prefetch,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    prefetch?: boolean
    children?: ReactNode
  }) => createElement("a", props, children),
}))
vi.mock("next/image", () => ({
  default: ({ fill: _fill, ...props }: Record<string, unknown>) =>
    createElement("img", props),
}))
// Embla needs layout APIs jsdom does not have; the rail markup is what matters.
vi.mock("@/components/ui/carousel", () => {
  const pass = (tag: string) =>
    function Pass({
      children,
      opts: _opts,
      label: _label,
      ...props
    }: Record<string, unknown> & { children?: ReactNode }) {
      return createElement(tag, props, children)
    }
  return {
    Carousel: pass("div"),
    CarouselContent: pass("div"),
    CarouselItem: pass("div"),
    CarouselPrevious: () => null,
    CarouselNext: () => null,
  }
})

import { WatchFindFlow } from "./WatchFindFlow"
import { WatchFindLauncher } from "./WatchFindLauncher"
import {
  WatchModalActivityProvider,
  usePauseForWatchModal,
  type WatchPausableMedia,
} from "./WatchModalActivityProvider"

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn<typeof fetch>()
const onClose = vi.fn()
const response = (
  cards: object[] = [],
  hasNextPage = false,
  endCursor: string | null = null,
) =>
  new Response(JSON.stringify({ cards, hasNextPage, endCursor }), {
    status: 200,
  })
const card = (videoId: string, laneId = "conversation", title = videoId) => ({
  videoId,
  videoDubId: `dub-${videoId}`,
  slug: videoId,
  laneId,
  title,
  durationSeconds: 554,
  imageUrl: `https://imagedelivery.net/a/${videoId}/w`,
  href: `/${videoId}.html/spanish-latin-american.html`,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
function button(label: string) {
  const match = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (node) =>
      node.textContent?.trim() === label ||
      node.getAttribute("aria-label") === label,
  )
  expect(match, label).toBeDefined()
  return match!
}
function radio(label: string) {
  const input = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ].find((input) => input.labels?.[0]?.textContent?.trim() === label)
  expect(input, label).toBeDefined()
  return input!
}
async function click(label: string) {
  await act(async () => button(label).click())
  await settle()
}
const step = () =>
  document
    .querySelector("[data-testid=watch-find-flow]")
    ?.getAttribute("data-step")
const query = (call = fetchMock.mock.lastCall!) =>
  new URL(String(call[0]), "http://test").searchParams

async function renderFlow() {
  await act(async () =>
    root.render(
      <WatchFindFlow
        languageSlug="spanish-latin-american"
        locale="es"
        onClose={onClose}
      />,
    ),
  )
  await settle()
}
/** reasons → lanes → fact → time → devices → working */
async function toWorking() {
  await click("Something to watch with my children")
  await click("Next") // lanes, pre-ticked kids + animated
  await click("Next") // fact
  await click("Next") // time
  await click("Next") // devices
  await click("Next") // working
}

beforeEach(() => {
  fetchMock.mockReset()
  onClose.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  window.history.replaceState(null, "", "/watch/jesus.html?as=explore")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("original phased finder on live data", () => {
  it("walks the original phases and asks nothing of the server before the fact card", async () => {
    fetchMock.mockResolvedValue(response([card("a", "kids")]))
    await renderFlow()
    expect(step()).toBe("reasons")
    expect(document.body.textContent).toContain(
      "Let's begin — what brings you here?",
    )
    await click("Something to watch with my children")
    await click("Next")
    expect(step()).toBe("lanes")
    expect(
      [
        ...document.querySelectorAll('[role="checkbox"][aria-checked="true"]'),
      ].map((node) => node.textContent?.trim()),
    ).toEqual(["For children", "Animated"])
    expect(fetchMock).not.toHaveBeenCalled()
    await click("Next")
    expect(step()).toBe("fact")
    expect(document.body.textContent).toContain("Did you know?")
    const q = query()
    expect(q.getAll("laneIds")).toEqual(["kids", "animated"])
    expect(q.get("languageSlug")).toBe("spanish-latin-american")
    expect(q.get("duration")).toBe("MEDIUM")
    expect(fetchMock.mock.lastCall![1]).toMatchObject({ cache: "no-store" })
  })

  it("maps the time answer onto the real duration buckets", async () => {
    fetchMock.mockResolvedValue(response())
    await renderFlow()
    await click("Next")
    await click("Next")
    await click("Next") // time
    expect(document.body.textContent).toContain(
      "How much time do you have right now?",
    )
    expect(radio("Ten or twenty minutes").checked).toBe(true)
    expect(
      new Set(
        [
          ...document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
        ].map((input) => input.name),
      ).size,
    ).toBe(1)
    await act(async () => radio("A few minutes").click())
    await settle()
    expect(query().get("duration")).toBe("SHORT")
    await act(async () => radio("As long as it takes").click())
    await settle()
    expect(query().get("duration")).toBe("ANY")
    // Skipped lanes mean every lane, as in the prototype.
    expect(query().getAll("laneIds")).toHaveLength(8)
  })

  it("holds the working beat until the real answer, then renders per-lane rails with live links", async () => {
    const late = deferred<Response>()
    fetchMock.mockReturnValue(late.promise)
    await renderFlow()
    await toWorking()
    expect(step()).toBe("working")
    await settle(1700)
    expect(step()).toBe("working")
    await act(async () =>
      late.resolve(
        response([
          card("kid-1", "kids", "StoryClubs live"),
          card("ani-1", "animated"),
        ]),
      ),
    )
    await settle()
    expect(step()).toBe("results")
    expect(
      document.querySelector("[data-testid=watch-find-rail-kids]")?.textContent,
    ).toContain("StoryClubs live")
    const film = document.querySelector<HTMLAnchorElement>(
      "[data-testid=watch-find-film]",
    )!
    expect(film.getAttribute("href")).toBe(
      "/kid-1.html/spanish-latin-american.html",
    )
    expect(film.textContent).toContain("9:14")
    expect(document.body.textContent).toContain("from 2 interests")
    // No dead "Save my list" button: there is no saved-list backend.
    expect(document.body.textContent).not.toContain("Save my list")
  })

  it("walks bounded pages and drops cards shared across lanes", async () => {
    fetchMock
      .mockResolvedValueOnce(response([card("a", "kids")], true, "v1:1"))
      .mockResolvedValueOnce(
        response([card("a", "kids"), card("b", "kids")], false, null),
      )
    await renderFlow()
    await toWorking()
    await settle(1700)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(query(fetchMock.mock.calls[1]).get("after")).toBe("v1:1")
    expect(
      document.querySelectorAll("[data-testid=watch-find-film]"),
    ).toHaveLength(2)
  })

  it("keeps matches past the first bounded round one explicit step away", async () => {
    const page = (n: number) =>
      Array.from({ length: 24 }, (_, i) => card(`kid-${n}-${i}`, "kids"))
    for (let n = 1; n <= 4; n += 1)
      fetchMock.mockResolvedValueOnce(response(page(n), true, `v1:${n * 24}`))
    fetchMock.mockResolvedValueOnce(
      response([card("ani-late", "animated", "Later lane film")]),
    )
    await renderFlow()
    await toWorking()
    await settle(1700)
    // No unattended fetch past the first round, and nothing invented.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(
      document.querySelectorAll("[data-testid=watch-find-film]"),
    ).toHaveLength(96)
    expect(
      document.querySelector("[data-testid=watch-find-rail-animated]"),
    ).toBeNull()
    expect(
      document.querySelector("[data-testid=watch-find-more]")?.textContent,
    ).toContain("96 films shown — more match your answers.")
    await click("Show more films")
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(query().get("after")).toBe("v1:96")
    expect(
      document.querySelector("[data-testid=watch-find-rail-animated]")
        ?.textContent,
    ).toContain("Later lane film")
    expect(document.querySelector("[data-testid=watch-find-more]")).toBeNull()
  })

  it("keeps loaded films and the cursor when a continuation fails, and retries only on request", async () => {
    fetchMock
      .mockResolvedValueOnce(response([card("a", "kids")], true, "v1:1"))
      .mockResolvedValueOnce(response([card("b", "kids")], true, "v1:2"))
      .mockResolvedValueOnce(response([card("c", "kids")], true, "v1:3"))
      .mockResolvedValueOnce(response([card("d", "kids")], true, "v1:4"))
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValueOnce(response([card("e", "animated")]))
    await renderFlow()
    await toWorking()
    await settle(1700)
    await click("Show more films")
    expect(
      document.querySelector("[data-testid=watch-find-more] [role=alert]")
        ?.textContent,
    ).toContain("temporarily unavailable")
    expect(
      document.querySelectorAll("[data-testid=watch-find-film]"),
    ).toHaveLength(4)
    await settle(50)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    await click("Try again")
    expect(query().get("after")).toBe("v1:4")
    expect(
      document.querySelectorAll("[data-testid=watch-find-film]"),
    ).toHaveLength(5)
  })

  it("does not resume an old continuation after leaving and returning to the same filters", async () => {
    const page = (n: number) =>
      Array.from({ length: 24 }, (_, i) => card(`kid-${n}-${i}`, "kids"))
    const pendingMore = deferred<Response>()
    const pendingB = deferred<Response>()
    let firstRounds = 0
    fetchMock.mockImplementation(async (url) => {
      const q = new URL(String(url), "http://test").searchParams
      if (q.get("duration") === "SHORT") return pendingB.promise // B never answers
      const after = q.get("after")
      if (after === "v1:96") return pendingMore.promise // A's "Show more"
      if (after) {
        const n = Number(after.slice(3)) / 24 + 1
        return response(page(n), true, `v1:${n * 24}`)
      }
      firstRounds += 1
      // A's first visit has more; every later A first round is fresh.
      return firstRounds === 1
        ? response(page(1), true, "v1:24")
        : response([card("fresh", "kids")])
    })
    await renderFlow()
    await toWorking()
    await settle(1700)
    await act(async () => button("Show more films").click())
    expect(query().get("after")).toBe("v1:96")
    const continuation = fetchMock.mock.lastCall![1]!.signal!
    // Leave for B (different time), then come straight back to A.
    await click("Start the questions again")
    await click("Something to watch with my children")
    await click("Next")
    await click("Next")
    await click("Next") // time
    await act(async () => radio("A few minutes").click())
    await settle()
    expect(continuation.aborted).toBe(true)
    expect(query().get("duration")).toBe("SHORT")
    await act(async () => radio("Ten or twenty minutes").click())
    await settle()
    // A's late continuation answer is ignored.
    await act(async () =>
      pendingMore.resolve(response([card("late-more", "animated")])),
    )
    await click("Next")
    await click("Next")
    await settle(1700)
    const afters = fetchMock.mock.calls.map((call) => query(call).get("after"))
    expect(afters.filter((a) => a === "v1:96")).toHaveLength(1)
    expect(query().get("after")).toBeNull()
    expect(document.body.textContent).toContain("fresh")
    expect(document.body.textContent).not.toContain("late-more")
    pendingB.resolve(response())
  })

  it("shows honest error and empty states instead of invented films", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue(response())
    await renderFlow()
    await toWorking()
    await settle(1700)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "temporarily unavailable",
    )
    await click("Try again")
    expect(document.body.textContent).toContain("No films match")
    expect(
      document
        .querySelector("[data-testid=watch-finder-catalog]")
        ?.getAttribute("href"),
    ).toBe("/spanish-latin-american.html/videos")
  })

  it("aborts an obsolete filter and ignores its late answer", async () => {
    const old = deferred<Response>()
    fetchMock
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(response([card("new-film", "conversation")]))
    await renderFlow()
    await click("Next")
    await click("Next")
    await click("Next") // time — first request in flight with MEDIUM
    const signal = fetchMock.mock.calls[0][1]!.signal!
    await act(async () => radio("A few minutes").click())
    await settle()
    expect(signal.aborted).toBe(true)
    await act(async () =>
      old.resolve(response([card("stale-film", "conversation")])),
    )
    await click("Next")
    await click("Next")
    await settle(1700)
    expect(document.body.textContent).toContain("new-film")
    expect(document.body.textContent).not.toContain("stale-film")
  })

  it("closes on Escape", async () => {
    await renderFlow()
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    )
    expect(onClose).toHaveBeenCalled()
  })
})

describe("launcher", () => {
  it("loads only on opening, pauses the player, closes on Escape, restores focus, and leaves the URL alone", async () => {
    fetchMock.mockResolvedValue(response())
    const media: WatchPausableMedia = {
      paused: false,
      pause: vi.fn(() => {
        media.paused = true
      }),
      play: vi.fn(),
    }
    function Player() {
      usePauseForWatchModal(media, "original-source")
      return null
    }
    await act(async () =>
      root.render(
        <WatchModalActivityProvider>
          <WatchFindLauncher
            languageSlug="spanish-latin-american"
            locale="es"
          />
          <Player />
        </WatchModalActivityProvider>,
      ),
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    const trigger = button("Find films for you")
    trigger.focus()
    await click("Find films for you")
    await vi.waitFor(async () => {
      await settle()
      expect(
        document.querySelector("[data-testid=watch-find-flow][data-step]"),
      ).not.toBeNull()
    })
    expect(media.pause).toHaveBeenCalled()
    expect(document.body.style.overflow).toBe("hidden")
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    )
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe("")
    expect(window.location.href).toBe(
      "http://localhost:3000/watch/jesus.html?as=explore",
    )
  })
})

it.each([
  ["ar", "rtl"],
  ["es", "ltr"],
])(
  "keeps English portal content independent of a %s document",
  async (lang, dir) => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    try {
      await renderFlow()
      const node = document.querySelector('[role="dialog"]')!
      expect(node.getAttribute("lang")).toBe("en")
      expect(node.getAttribute("dir")).toBe("ltr")
      expect(node.getAttribute("aria-label")).toBe("Find films for you")
      expect(
        node.querySelector("button")?.closest("[lang]")?.getAttribute("lang"),
      ).toBe("en")
    } finally {
      document.documentElement.removeAttribute("lang")
      document.documentElement.removeAttribute("dir")
    }
  },
)

it("keeps a localized result title neutral inside the English Finder portal", async () => {
  fetchMock.mockResolvedValue(response([card("localized", "kids", "يسوع")]))
  await renderFlow()
  await toWorking()
  await settle(1700)
  const title = document
    .querySelector('[data-testid="watch-find-film"]')!
    .querySelector("span[lang]")!
  expect(title?.textContent).toBe("يسوع")
  expect(title?.getAttribute("lang")).toBe("")
  expect(title?.getAttribute("dir")).toBe("auto")
  expect(title?.closest('[role="dialog"]')?.getAttribute("lang")).toBe("en")
})
