// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const kit = vi.hoisted(() => ({ loaded: 0 }))

vi.mock("./WatchShareKit", async () => {
  const { createElement } = await import("react")
  kit.loaded += 1
  return {
    WatchShareKit: ({
      film,
      onClose,
    }: {
      film: { title: string }
      onClose: () => void
    }) =>
      createElement(
        "div",
        { "data-testid": "watch-share-kit" },
        film.title,
        createElement("button", {
          onClick: onClose,
          "data-testid": "kit-close",
        }),
      ),
  }
})

import type { WatchShareFilm } from "@/lib/watch-share-kit"
import { WatchShareIdeas } from "./WatchShareIdeas"

let container: HTMLDivElement
let root: Root

const film: WatchShareFilm = {
  slug: "seed-demo-video",
  title: "Seed Demo Video",
  languageSlug: "english",
  languageName: "English",
  runtimeMinutes: 4,
  studyQuestions: [],
  languageVariants: [],
  languageOptionsStatus: "idle",
}

function byTestId<T extends HTMLElement>(id: string) {
  return container.querySelector<T>(`[data-testid="${id}"]`)
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

beforeEach(() => {
  kit.loaded = 0
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("WatchShareIdeas", () => {
  it("shows the existing collection, not a kit, until a film is selected", () => {
    act(() =>
      root.render(
        createElement(WatchShareIdeas, {
          film: null,
          onShareClick: vi.fn(),
          collection: createElement(
            "div",
            { "data-testid": "existing-collection" },
            "Collection",
          ),
        }),
      ),
    )

    expect(byTestId("existing-collection")).not.toBeNull()
    expect(byTestId("watch-share-kit-launcher")).toBeNull()
    expect(byTestId("watch-share-ideas")!.textContent).toContain(
      "Pick a film to send",
    )
  })

  it("replaces the collection prompt with the film once one is selected", () => {
    act(() =>
      root.render(
        createElement(WatchShareIdeas, {
          film,
          onShareClick: vi.fn(),
          collection: createElement(
            "div",
            { "data-testid": "existing-collection" },
            "Collection",
          ),
        }),
      ),
    )

    expect(byTestId("existing-collection")).toBeNull()
    expect(byTestId("watch-share-ideas")!.textContent).toContain(
      "Seed Demo Video",
    )
    expect(byTestId("watch-share-ideas")!.textContent).toContain("4 minutes")
  })

  it("renders the eight practical ideas", () => {
    act(() =>
      root.render(
        createElement(WatchShareIdeas, { film, onShareClick: vi.fn() }),
      ),
    )

    expect(
      container.querySelectorAll('[data-testid="watch-share-idea"]'),
    ).toHaveLength(8)
  })

  it("keeps the existing Share control as the quick path", async () => {
    const onShareClick = vi.fn()
    act(() =>
      root.render(createElement(WatchShareIdeas, { film, onShareClick })),
    )

    await click(byTestId("watch-share-send")!)

    expect(onShareClick).toHaveBeenCalledTimes(1)
  })

  it("defers the kit module until the visitor asks for it, then asks for language options", async () => {
    const onRequestLanguageOptions = vi.fn()
    act(() =>
      root.render(
        createElement(WatchShareIdeas, {
          film,
          onShareClick: vi.fn(),
          onRequestLanguageOptions,
        }),
      ),
    )
    expect(kit.loaded).toBe(0)
    expect(byTestId("watch-share-kit")).toBeNull()

    const launcher = byTestId<HTMLButtonElement>("watch-share-kit-launcher")!
    expect(launcher.getAttribute("aria-expanded")).toBe("false")
    await click(launcher)
    await act(async () => {
      await Promise.resolve()
    })

    expect(kit.loaded).toBe(1)
    expect(byTestId("watch-share-kit")!.textContent).toContain(
      "Seed Demo Video",
    )
    expect(launcher.getAttribute("aria-expanded")).toBe("true")
    expect(onRequestLanguageOptions).toHaveBeenCalledTimes(1)
  })

  it("returns focus to the launcher when the kit closes", async () => {
    act(() =>
      root.render(
        createElement(WatchShareIdeas, { film, onShareClick: vi.fn() }),
      ),
    )
    const launcher = byTestId<HTMLButtonElement>("watch-share-kit-launcher")!
    await click(launcher)
    await act(async () => {
      await Promise.resolve()
    })

    await click(document.querySelector('[data-testid="kit-close"]')!)

    expect(byTestId("watch-share-kit")).toBeNull()
    expect(document.activeElement).toBe(launcher)
  })

  it("closes the kit when another film is selected", async () => {
    act(() =>
      root.render(
        createElement(WatchShareIdeas, { film, onShareClick: vi.fn() }),
      ),
    )
    await click(byTestId("watch-share-kit-launcher")!)
    await act(async () => {
      await Promise.resolve()
    })
    expect(byTestId("watch-share-kit")).not.toBeNull()

    act(() =>
      root.render(
        createElement(WatchShareIdeas, {
          film: { ...film, slug: "my-last-day", title: "My Last Day" },
          onShareClick: vi.fn(),
        }),
      ),
    )

    expect(byTestId("watch-share-kit")).toBeNull()
  })
})
