/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/search-actions", () => ({ runSearch: vi.fn() }))

import { UserPlaylistComposer } from "./UserPlaylistComposer"
import type {
  UserPlaylist,
  UserPlaylistOwnerActions,
} from "@/lib/user-playlist-contract"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const playlist: UserPlaylist = {
  id: "playlist-1",
  title: "Stories for home",
  description: "",
  locale: "sw",
  countryCode: "KE",
  version: 3,
  shareState: "SHARED",
  blocks: [{ kind: "TEXT", text: "Welcome" }],
  unavailableVideoIds: [],
}

function actions(): UserPlaylistOwnerActions {
  return {
    getPolicy: vi.fn(),
    list: vi.fn(),
    read: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    unshare: vi.fn(),
    reshare: vi.fn(),
    rotate: vi.fn(),
    reveal: vi.fn(),
  }
}

describe("UserPlaylistComposer", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it("exposes only the three supported block types and marks edits dirty", async () => {
    await act(async () => {
      root.render(
        <UserPlaylistComposer playlist={playlist} actions={actions()} />,
      )
    })

    expect(container.textContent).toContain("Text")
    expect(container.textContent).toContain("Media collection")
    expect(container.textContent).toContain("Video carousel")
    expect(container.textContent).not.toContain("HTML")
    expect(container.textContent).toContain("All changes saved")

    const addCollection = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Media collection",
    )
    await act(async () => addCollection?.click())

    expect(container.textContent).toContain("Unsaved changes")
    expect(
      container.querySelector('[aria-live="polite"]')?.textContent,
    ).toContain("Added block 2 of 2")
    await vi.waitFor(() => {
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "Remove block 2",
      )
    })

    const navigation = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(navigation)
    expect(navigation.defaultPrevented).toBe(true)

    await act(async () => {
      ;(document.activeElement as HTMLButtonElement).click()
    })
    await vi.waitFor(() => {
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "Remove block 1",
      )
    })
  })

  it("preserves local edits and reports a stale conflict", async () => {
    const ownerActions = actions()
    vi.mocked(ownerActions.update).mockResolvedValue({
      ok: false,
      code: "CONFLICT",
    })

    await act(async () => {
      root.render(
        <UserPlaylistComposer playlist={playlist} actions={ownerActions} />,
      )
    })

    const title = container.querySelector<HTMLInputElement>("#playlist-title")
    await act(async () => {
      title?.focus()
      title?.setRangeText(" updated", title.value.length, title.value.length)
      title?.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save",
    )
    await act(async () => save?.click())

    expect(ownerActions.update).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("newer saved version")
    expect(title?.value).toContain("updated")
  })

  it("preserves edits made while a save is pending and advances the server version", async () => {
    const ownerActions = actions()
    const update =
      deferred<Awaited<ReturnType<UserPlaylistOwnerActions["update"]>>>()
    vi.mocked(ownerActions.update).mockReturnValue(update.promise)

    await act(async () => {
      root.render(
        <UserPlaylistComposer playlist={playlist} actions={ownerActions} />,
      )
    })

    const title = container.querySelector<HTMLInputElement>("#playlist-title")!
    await act(async () => {
      title.focus()
      title.setRangeText("Dispatched title", 0, title.value.length)
      title.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((candidate) => candidate.textContent === "Save")
        ?.click()
    })

    await act(async () => {
      title.setRangeText("Newer local title", 0, title.value.length)
      title.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(container.textContent).toContain("Saving changes")

    await act(async () => {
      update.resolve({
        ok: true,
        data: { ...playlist, title: "Dispatched title", version: 4 },
      })
      await update.promise
    })

    expect(title.value).toBe("Newer local title")
    expect(container.textContent).toContain("Unsaved changes")
    expect(container.textContent).toContain(
      "Public preview stays on saved version 4.",
    )
  })

  it("returns focus to the add-video opener after keyboard cancellation", async () => {
    const collection: UserPlaylist = {
      ...playlist,
      blocks: [{ kind: "MEDIA_COLLECTION", title: "Stories", items: [] }],
    }
    await act(async () => {
      root.render(
        <UserPlaylistComposer playlist={collection} actions={actions()} />,
      )
    })

    const opener =
      container.querySelector<HTMLButtonElement>("[data-add-video]")!
    opener.focus()
    await act(async () => opener.click())
    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Close video picker"]',
    )!
    close.focus()
    await act(async () => close.click())

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        container.querySelector<HTMLButtonElement>("[data-add-video]"),
      )
    })
  })

  it("returns focus to the replace-video opener after keyboard cancellation", async () => {
    const unavailable: UserPlaylist = {
      ...playlist,
      blocks: [
        {
          kind: "VIDEO_CAROUSEL",
          title: "Featured",
          items: [{ videoId: "private-video-id" }],
        },
      ],
      unavailableVideoIds: ["private-video-id"],
    }
    await act(async () => {
      root.render(
        <UserPlaylistComposer playlist={unavailable} actions={actions()} />,
      )
    })

    const opener = container.querySelector<HTMLButtonElement>(
      '[data-item-action="replace"]',
    )!
    opener.focus()
    await act(async () => opener.click())
    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Close video picker"]',
    )!
    close.focus()
    await act(async () => close.click())

    await vi.waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it("keeps an unavailable item in place and blocks save until removed or replaced", async () => {
    const ownerActions = actions()
    const unavailable: UserPlaylist = {
      ...playlist,
      blocks: [
        {
          kind: "VIDEO_CAROUSEL",
          title: "Featured",
          items: [{ videoId: "private-video-id" }],
        },
      ],
      unavailableVideoIds: ["private-video-id"],
    }

    await act(async () => {
      root.render(
        <UserPlaylistComposer playlist={unavailable} actions={ownerActions} />,
      )
    })

    expect(container.textContent).toContain("Video unavailable")
    expect(container.textContent).not.toContain("private-video-id")
    expect(container.textContent).toContain("Replace")
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save",
    )
    expect(save?.hasAttribute("disabled")).toBe(true)
    expect(ownerActions.update).not.toHaveBeenCalled()
  })
})
