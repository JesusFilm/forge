/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { UserPlaylistLibrary } from "./UserPlaylistLibrary"
import type {
  UserPlaylistOwnerActions,
  UserPlaylistPolicy,
} from "@/lib/user-playlist-contract"

const policy: UserPlaylistPolicy = {
  terms: {
    version: "terms-2026-08",
    url: "https://www.jesusfilm.org/terms/",
  },
  privacy: {
    version: "privacy-2026-08",
    url: "https://www.jesusfilm.org/privacy/",
  },
  communityGuidelines: {
    version: "guidelines-2026-08",
    url: "/watch/community-guidelines",
  },
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

describe("UserPlaylistLibrary", () => {
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

  it("renders explicit empty and affirmative policy-acceptance states", async () => {
    const ownerActions = actions()

    await act(async () => {
      root.render(
        <UserPlaylistLibrary
          initialResult={{
            ok: true,
            data: { items: [], nextCursor: null },
          }}
          policy={policy}
          actions={ownerActions}
        />,
      )
    })

    expect(container.textContent).toContain("No playlists yet")
    const create = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Create playlist",
    )
    await act(async () => create?.click())

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain("Terms")
    expect(dialog?.textContent).toContain("Privacy")
    expect(dialog?.textContent).toContain("Community Guidelines")
    expect(
      dialog?.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
    ).toBe(false)
    expect(
      Array.from(dialog?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "Create and enable link")
        ?.hasAttribute("disabled"),
    ).toBe(true)
  })

  it("keeps preview and copy disabled while unshared and offers re-share", async () => {
    const ownerActions = actions()
    await act(async () => {
      root.render(
        <UserPlaylistLibrary
          initialResult={{
            ok: true,
            data: {
              items: [
                {
                  id: "playlist-1",
                  title: "Local stories",
                  description: "",
                  locale: "sw",
                  countryCode: "KE",
                  version: 4,
                  shareState: "UNSHARED",
                },
              ],
              nextCursor: null,
            },
          }}
          policy={policy}
          actions={ownerActions}
        />,
      )
    })

    expect(container.textContent).toContain("Sharing off")
    expect(
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.startsWith("Preview"))
        ?.hasAttribute("disabled"),
    ).toBe(true)
    expect(
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.startsWith("Copy link"))
        ?.hasAttribute("disabled"),
    ).toBe(true)
    expect(container.textContent).toContain("Re-share")
  })

  it("shows the verified-provider eligibility path without promising email", async () => {
    await act(async () => {
      root.render(
        <UserPlaylistLibrary
          initialResult={{ ok: false, code: "INELIGIBLE" }}
          policy={policy}
          actions={actions()}
        />,
      )
    })

    expect(container.textContent).toContain("Google or Apple")
    expect(container.textContent?.toLowerCase()).not.toContain(
      "verification email",
    )
    expect(container.querySelector('a[href="/watch"]')).not.toBeNull()
  })
})
