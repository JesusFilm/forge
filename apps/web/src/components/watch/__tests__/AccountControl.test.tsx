/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AccountControl } from "@/components/watch/AccountControl"

const floatingChrome = vi.hoisted(() => ({
  searchChromeVisible: true,
}))

const { clearDatadogRumUserMock, identifyDatadogRumUserMock } = vi.hoisted(
  () => ({
    clearDatadogRumUserMock: vi.fn(),
    identifyDatadogRumUserMock: vi.fn(),
  }),
)

vi.mock("@/components/FloatingSearchProvider", () => ({
  useFloatingSearchPinned: () => ({
    pinned: false,
    playerChromeVisible: true,
    searchChromeVisible: floatingChrome.searchChromeVisible,
    searchChromeDimmed: false,
    searchOpen: false,
  }),
}))

vi.mock("@/components/DatadogRum", () => ({
  clearDatadogRumUser: clearDatadogRumUserMock,
  identifyDatadogRumUser: identifyDatadogRumUserMock,
}))

describe("AccountControl", () => {
  let container: HTMLDivElement
  let root: Root
  let assignSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetAllMocks()
    floatingChrome.searchChromeVisible = true
    window.history.replaceState(null, "", "/watch/jesus/english?t=12")
    assignSpy = vi.fn()
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/watch/jesus/english",
        search: "?t=12",
        hash: "",
        assign: assignSpy,
      },
      writable: true,
    })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  })

  it("renders no account control while the session request is pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    )

    await act(async () => {
      root.render(<AccountControl />)
    })

    expect(
      container.querySelector('[data-testid="watch-account-control"]'),
    ).toBeNull()
  })

  it("links signed-out homepage viewers back to the exact homepage", async () => {
    Object.assign(window.location, {
      pathname: "/watch",
      search: "",
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          accountGateEnabled: true,
          authenticated: false,
          playlistAuthoringEnabled: false,
        }),
      ),
    )

    await act(async () => {
      root.render(<AccountControl />)
    })
    const button = await vi.waitFor(() => {
      const el = container.querySelector("button")
      expect(el?.getAttribute("aria-label")).toBe("Sign in")
      return el as HTMLButtonElement
    })

    await act(async () => {
      button.click()
    })

    expect(assignSpy).toHaveBeenCalledWith(
      "http://localhost:3000/watch/api/auth/login?returnTo=%2Fwatch",
    )
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/watch/api/auth/session?callbackURL=%2Fwatch",
      expect.any(Object),
    )
  })

  it.each([
    ["non-success", async () => new Response(null, { status: 503 })],
    ["invalid JSON", async () => new Response("not-json")],
    ["null JSON", async () => Response.json(null)],
    ["array JSON", async () => Response.json([])],
    ["missing booleans", async () => Response.json({ user: {} })],
    [
      "string booleans",
      async () =>
        Response.json({
          accountGateEnabled: "true",
          authenticated: "false",
        }),
    ],
    [
      "invalid authenticated user",
      async () =>
        Response.json({
          accountGateEnabled: false,
          authenticated: true,
          playlistAuthoringEnabled: false,
          user: "viewer",
        }),
    ],
    [
      "conflicting signed-out user",
      async () =>
        Response.json({
          accountGateEnabled: true,
          authenticated: false,
          playlistAuthoringEnabled: false,
          user: { id: "viewer" },
        }),
    ],
    ["rejected request", async () => Promise.reject(new Error("offline"))],
  ])("fails hidden for a %s session response", async (_name, fetchSession) => {
    vi.stubGlobal("fetch", vi.fn(fetchSession))

    await act(async () => {
      root.render(<AccountControl />)
    })

    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="watch-account-control"]'),
      ).toBeNull()
      expect(clearDatadogRumUserMock).toHaveBeenCalledTimes(1)
    })
    expect(identifyDatadogRumUserMock).not.toHaveBeenCalled()
  })

  it("links signed-out viewers to the Web-local Auth login route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          accountGateEnabled: true,
          authenticated: false,
          playlistAuthoringEnabled: false,
        }),
      ),
    )

    await act(async () => {
      root.render(<AccountControl />)
    })
    const button = await vi.waitFor(() => {
      const el = container.querySelector("button")
      expect(el?.getAttribute("aria-label")).toBe("Sign in")
      expect(el?.textContent).toBe("")
      return el as HTMLButtonElement
    })

    await act(async () => {
      button.click()
    })

    expect(assignSpy).toHaveBeenCalledWith(
      "http://localhost:3000/watch/api/auth/login?returnTo=%2Fwatch%2Fjesus%2Fenglish%3Ft%3D12",
    )
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/watch/api/auth/session?callbackURL=%2Fwatch%2Fjesus%2Fenglish%3Ft%3D12",
      expect.any(Object),
    )
    expect(clearDatadogRumUserMock).toHaveBeenCalledTimes(1)
    expect(identifyDatadogRumUserMock).not.toHaveBeenCalled()
  })

  it("hides the signed-out account control when the download account gate is off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          accountGateEnabled: false,
          authenticated: false,
          playlistAuthoringEnabled: false,
        }),
      ),
    )

    await act(async () => {
      root.render(<AccountControl />)
    })

    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="watch-account-control"]'),
      ).toBeNull()
    })
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/watch/api/auth/session?callbackURL=%2Fwatch%2Fjesus%2Fenglish%3Ft%3D12",
      expect.any(Object),
    )
    expect(clearDatadogRumUserMock).toHaveBeenCalledTimes(1)
    expect(identifyDatadogRumUserMock).not.toHaveBeenCalled()
  })

  it("opens a signed-in account menu with My playlists independent of the download gate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          accountGateEnabled: false,
          authenticated: true,
          playlistAuthoringEnabled: true,
          user: {
            id: "auth-user-123",
            email: "viewer@example.test",
            name: "Viewer Example",
            image: "https://example.test/avatar.jpg",
          },
        }),
      ),
    )

    await act(async () => {
      root.render(<AccountControl />)
    })
    const button = await vi.waitFor(() => {
      const el = container.querySelector("button")
      expect(el?.getAttribute("aria-label")).toBe("Account menu")
      expect(el?.getAttribute("aria-expanded")).toBe("false")
      return el as HTMLButtonElement
    })

    expect(container.textContent).not.toContain("History")
    expect(identifyDatadogRumUserMock).toHaveBeenCalledWith({
      id: "auth-user-123",
      email: "viewer@example.test",
      name: "Viewer Example",
      image: "https://example.test/avatar.jpg",
    })
    expect(clearDatadogRumUserMock).not.toHaveBeenCalled()

    await act(async () => {
      button.click()
    })

    const menu = await vi.waitFor(() => {
      const el = container.querySelector('[data-testid="watch-account-menu"]')
      expect(el?.textContent).toContain("Viewer Example")
      expect(el?.textContent).toContain("viewer@example.test")
      expect(el?.textContent).toContain("Log out")
      expect(el?.textContent).toContain("My playlists")
      return el as HTMLElement
    })
    expect(button.getAttribute("aria-expanded")).toBe("true")
    expect(container.innerHTML).toContain("https://example.test/avatar.jpg")

    const playlistsItem = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("My playlists"))
    expect(playlistsItem).toBeDefined()

    await act(async () => {
      playlistsItem?.click()
    })

    expect(assignSpy).toHaveBeenCalledWith("/watch/playlists")

    const logoutItem = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Log out"))
    expect(logoutItem).toBeDefined()

    await act(async () => {
      logoutItem?.click()
    })

    expect(assignSpy).toHaveBeenCalledWith(
      "http://localhost:3000/watch/api/auth/logout?returnTo=%2Fwatch%2Fjesus%2Fenglish%3Ft%3D12",
    )
  })

  it("closes the account menu when the watch controls fade away", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          accountGateEnabled: false,
          authenticated: true,
          playlistAuthoringEnabled: false,
          user: {
            email: "viewer@example.test",
            name: "Viewer Example",
          },
        }),
      ),
    )

    await act(async () => {
      root.render(<AccountControl />)
    })
    const button = await vi.waitFor(() => {
      const el = container.querySelector("button")
      expect(el?.getAttribute("aria-label")).toBe("Account menu")
      return el as HTMLButtonElement
    })

    await act(async () => {
      button.click()
    })
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="watch-account-menu"]'),
      ).not.toBeNull()
      expect(button.getAttribute("aria-expanded")).toBe("true")
      expect(container.textContent).not.toContain("My playlists")
    })

    floatingChrome.searchChromeVisible = false
    await act(async () => {
      root.render(<AccountControl />)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="watch-account-menu"]'),
      ).toBeNull()
      expect(button.getAttribute("aria-expanded")).toBe("false")
    })
  })
})
