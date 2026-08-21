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
