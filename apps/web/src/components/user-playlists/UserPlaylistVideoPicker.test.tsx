/**
 * @vitest-environment jsdom
 */

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { runSearch } = vi.hoisted(() => ({ runSearch: vi.fn() }))
vi.mock("@/lib/search-actions", () => ({ runSearch }))

import { UserPlaylistVideoPicker } from "./UserPlaylistVideoPicker"
import type { SearchActionResult, SearchResult } from "@/lib/search"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function searchResult(
  id: string,
  title: string,
  type: SearchResult["type"] = "video",
): SearchResult {
  return {
    type,
    id,
    slug: id,
    title,
    imageUrl: null,
    imageBlurDataUrl: null,
    muxThumbnailBlurDataUrl: null,
    snippet: "",
    startSeconds: null,
    playbackId: null,
    score: 1,
    label: null,
    durationSeconds: null,
    childCount: null,
    languageEnglishName: "English",
  }
}

function searchSuccess(results: SearchResult[]): SearchActionResult {
  return {
    ok: true,
    results,
    hasMore: false,
    query: "query",
    searchMode: "DEFAULT",
    latencyMs: 1,
    resultSource: "watch-search",
    resolvedLanguage: {
      locale: "en",
      publicSlug: "english",
      englishName: "English",
      source: "fallback",
    },
  }
}

describe("UserPlaylistVideoPicker", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    runSearch.mockReset()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(onSelect = vi.fn(), onCancel = vi.fn()): Promise<void> {
    await act(async () => {
      root.render(
        <UserPlaylistVideoPicker onSelect={onSelect} onCancel={onCancel} />,
      )
    })
  }

  async function setQuery(value: string): Promise<void> {
    const input = container.querySelector<HTMLInputElement>("input")!
    await act(async () => {
      input.focus()
      input.setRangeText(value, 0, input.value.length)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  async function submit(): Promise<void> {
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
  }

  it("shows video results only and selects the chosen video", async () => {
    const onSelect = vi.fn()
    runSearch.mockResolvedValue(
      searchSuccess([
        searchResult("video-1", "A Video"),
        searchResult("experience-1", "An Experience", "experience"),
      ]),
    )
    await render(onSelect)
    await setQuery("story")
    await submit()

    expect(container.textContent).toContain("A Video")
    expect(container.textContent).not.toContain("An Experience")
    const resultButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("A Video"),
    )!
    await act(async () => resultButton.click())
    expect(onSelect).toHaveBeenCalledWith({ id: "video-1", title: "A Video" })
  })

  it.each([
    ["unsuccessful", false],
    ["rejected", true],
  ])("shows a retryable error for %s searches", async (_name, rejects) => {
    if (rejects) runSearch.mockRejectedValue(new Error("offline"))
    else runSearch.mockResolvedValue({ ok: false })
    await render()
    await setQuery("story")
    await submit()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "temporarily unavailable",
    )
  })

  it("ignores an older response after the query changes", async () => {
    const first = deferred<SearchActionResult>()
    const second = deferred<SearchActionResult>()
    runSearch
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    await render()

    await setQuery("first")
    await submit()
    await setQuery("second")
    await submit()

    await act(async () => {
      second.resolve(searchSuccess([searchResult("new", "New result")]))
      await second.promise
    })
    expect(container.textContent).toContain("New result")

    await act(async () => {
      first.resolve(searchSuccess([searchResult("old", "Old result")]))
      await first.promise
    })
    expect(container.textContent).toContain("New result")
    expect(container.textContent).not.toContain("Old result")
  })

  it("ignores a pending response after cancellation unmounts the picker", async () => {
    const pending = deferred<SearchActionResult>()
    runSearch.mockReturnValue(pending.promise)

    function Harness() {
      const [open, setOpen] = useState(true)
      return open ? (
        <UserPlaylistVideoPicker
          onSelect={vi.fn()}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <p>Picker closed</p>
      )
    }

    await act(async () => root.render(<Harness />))
    await setQuery("story")
    await submit()
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close video picker"]')!
        .click()
    })
    expect(container.textContent).toContain("Picker closed")

    await act(async () => {
      pending.resolve(searchSuccess([searchResult("late", "Late result")]))
      await pending.promise
    })
    expect(container.textContent).toBe("Picker closed")
  })

  it("calls onCancel from the close control", async () => {
    const onCancel = vi.fn()
    await render(vi.fn(), onCancel)
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close video picker"]')!
        .click()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
