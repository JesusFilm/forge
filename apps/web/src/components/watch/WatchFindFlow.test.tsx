// @vitest-environment jsdom
import {
  act,
  createElement,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { languages } = vi.hoisted(() => ({ languages: vi.fn() }))
vi.mock("@/lib/watch-interaction-loader", () => ({
  loadGlobalWatchLanguageOptions: languages,
}))
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
const response = (
  cards: object[] = [],
  hasNextPage = false,
  endCursor: string | null = null,
) =>
  new Response(JSON.stringify({ cards, hasNextPage, endCursor }), {
    status: 200,
  })
const card = (videoId: string, title = videoId) => ({
  videoId,
  videoDubId: `dub-${videoId}`,
  slug: videoId,
  laneId: "conversation",
  title,
  durationSeconds: 112,
  imageUrl: null,
  href: `/${videoId}.html/spanish-latin-american.html`,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
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
async function click(label: string) {
  await act(async () => button(label).click())
  await settle()
}
async function select(name: string, value: string) {
  const node = document.querySelector<HTMLSelectElement>(
    `select[name="${name}"]`,
  )!
  expect(node).not.toBeNull()
  await act(async () => {
    node.value = value
    node.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await settle()
}
async function renderFlow() {
  await act(async () =>
    root.render(
      <WatchFindFlow languageSlug="spanish-latin-american" locale="es" />,
    ),
  )
  await settle()
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  languages.mockReset().mockResolvedValue([
    {
      slug: "english",
      englishName: "English",
      nativeName: "English",
      aliasOwnerSlug: "english",
    },
    {
      slug: "spanish-latin-american",
      englishName: "Spanish, Latin American",
      nativeName: "Español",
      aliasOwnerSlug: "spanish-latin-american",
    },
    {
      slug: "french",
      englishName: "French",
      nativeName: "Français",
      aliasOwnerSlug: "french",
    },
  ])
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

describe("live finder", () => {
  it("shows current metadata with Spanish routes and sends real recipient audio and runtime choices", async () => {
    fetchMock.mockImplementation(async (url) => {
      const audio = new URL(String(url), "http://test").searchParams.get(
        "languageSlug",
      )
      return response([
        {
          ...card("live-film", "Título actual"),
          href: `/live-film.html/${audio}.html`,
        },
      ])
    })
    await renderFlow()
    expect(container.textContent).toContain("Título actual")
    expect(
      container
        .querySelector("[data-testid=watch-finder-card] a")
        ?.getAttribute("href"),
    ).toBe("/live-film.html/spanish-latin-american.html")
    let query = new URL(String(fetchMock.mock.calls[0][0]), "http://test")
      .searchParams
    expect(query.get("languageSlug")).toBe("spanish-latin-american")
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" })
    await select("audio", "french")
    expect(
      container
        .querySelector("[data-testid=watch-finder-card] a")
        ?.getAttribute("href"),
    ).toBe("/live-film.html/french.html")
    await select("duration", "SHORT")
    query = new URL(String(fetchMock.mock.lastCall![0]), "http://test")
      .searchParams
    expect(query.get("languageSlug")).toBe("french")
    expect(query.get("duration")).toBe("SHORT")
    expect(window.location.search).toBe("?as=explore")
  })

  it("aborts obsolete filters and ignores late earlier responses even if the transport ignores abort", async () => {
    const old = deferred<Response>()
    fetchMock
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(response([card("new-film")]))
    await renderFlow()
    expect(container.textContent).toContain("Loading films")
    const signal = fetchMock.mock.calls[0][1]!.signal!
    await select("duration", "SHORT")
    expect(signal.aborted).toBe(true)
    expect(container.textContent).toContain("new-film")
    await act(async () => old.resolve(response([card("stale-film")])))
    expect(container.textContent).not.toContain("stale-film")
  })

  it("distinguishes empty and partial inventory from server failure and offers the selected-language catalog", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(response())
      .mockResolvedValue(response([card("one-film")]))
    await renderFlow()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "temporarily unavailable",
    )
    expect(container.textContent).not.toContain("No films")
    await click("Try again")
    expect(container.textContent).toContain("No films match")
    expect(
      container
        .querySelector('[data-testid="watch-finder-catalog"]')
        ?.getAttribute("href"),
    ).toBe("/spanish-latin-american.html/videos")
    await select("duration", "SHORT")
    expect(container.textContent).toContain(
      "Titles shared by collections appear once",
    )
    expect(container.textContent).toContain("one-film")
  })

  it("appends ordered pages, keeps cards after a load-more error, and retries only that cursor", async () => {
    fetchMock
      .mockResolvedValueOnce(response([card("first")], true, "v1:1"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(response([card("second")]))
    await renderFlow()
    await click("Load more")
    expect(container.textContent).toContain("first")
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "temporarily unavailable",
    )
    await click("Try again")
    expect(
      [...container.querySelectorAll('[data-testid="watch-finder-card"]')].map(
        (node) => node.textContent,
      ),
    ).toEqual([
      expect.stringContaining("first"),
      expect.stringContaining("second"),
    ])
    for (const call of fetchMock.mock.calls.slice(1))
      expect(
        new URL(String(call[0]), "http://test").searchParams.get("after"),
      ).toBe("v1:1")
  })

  it("loads only on opening, pauses through shared activity, aborts on close and restores trigger focus without URL changes", async () => {
    const pending = deferred<Response>()
    fetchMock.mockReturnValue(pending.promise)
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
    expect(fetchMock).not.toHaveBeenCalled()
    expect(languages).not.toHaveBeenCalled()
    const trigger = button("Find films for you")
    trigger.focus()
    await click("Find films for you")
    await vi.waitFor(async () => {
      await settle()
      expect(fetchMock).toHaveBeenCalledOnce()
    })
    expect(media.pause).toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    const signal = fetchMock.mock.calls[0][1]!.signal!
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    )
    await settle()
    await vi.waitFor(() => {
      expect(signal.aborted).toBe(true)
      expect(document.activeElement).toBe(trigger)
    })
    expect(window.location.href).toBe(
      "http://localhost:3000/watch/jesus.html?as=explore",
    )
    await click("Find films for you")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
})
