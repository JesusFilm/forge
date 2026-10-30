/**
 * @vitest-environment jsdom
 */

import { StrictMode, act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WatchPartnerAccount } from "./WatchPartnerAccount"
import { setWatchRole } from "./watch-role"

type ServerReply =
  | { kind: "json"; body: unknown; status?: number }
  | { kind: "network-error" }
  | { kind: "pending" }

const SIGNED_IN = {
  accountGateEnabled: true,
  authenticated: true,
  user: { id: "user-1", email: "ada@example.org", name: "Ada" },
}
const SIGNED_OUT = {
  accountGateEnabled: true,
  authenticated: false,
  loginUrl: `${window.location.origin}/watch/api/auth/login?returnTo=%2Fwatch`,
}

let container: HTMLDivElement
let root: Root
let reply: ServerReply
let fetchMock: ReturnType<typeof vi.fn>

function serve(next: ServerReply) {
  reply = next
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
}

async function mount(node: ReactNode = tools()) {
  await act(async () => {
    root.render(<WatchPartnerAccount>{() => node}</WatchPartnerAccount>)
  })
  await settle()
}

function tools() {
  return <p data-testid="partner-tools">Partner tools</p>
}

function panel() {
  return container.querySelector<HTMLElement>(
    '[data-testid="watch-partner-account"]',
  )!
}

function state() {
  return panel().getAttribute("data-account-state")
}

function toolsShown() {
  return container.querySelector('[data-testid="partner-tools"]') !== null
}

function link(testId: string) {
  return container.querySelector<HTMLAnchorElement>(`[data-testid="${testId}"]`)
}

function button(name: string) {
  return [...container.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === name,
  )
}

/** Clicks a link without letting jsdom attempt a navigation; returns the final href. */
function clickLink(anchor: HTMLAnchorElement): string {
  const stop = (event: Event) => event.preventDefault()
  document.addEventListener("click", stop)
  try {
    act(() => anchor.click())
  } finally {
    document.removeEventListener("click", stop)
  }
  return anchor.href
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, "", "/watch/jesus.html?as=partner")
  reply = { kind: "json", body: SIGNED_OUT }
  fetchMock = vi.fn(async () => {
    if (reply.kind === "network-error") throw new TypeError("network")
    if (reply.kind === "pending") return new Promise<Response>(() => undefined)
    return Response.json(reply.body, { status: reply.status ?? 200 })
  })
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("WatchPartnerAccount", () => {
  it("keeps the tools locked, and shows no sign-in prompt, until the server has answered", async () => {
    serve({ kind: "pending" })
    await mount()

    expect(state()).toBe("checking")
    expect(panel().getAttribute("aria-busy")).toBe("true")
    expect(toolsShown()).toBe(false)
    expect(link("watch-partner-sign-in")).toBeNull()
  })

  it.each([true, false])(
    "offers hosted sign-in and no tools when signed out (account gate %s)",
    async (accountGateEnabled) => {
      serve({ kind: "json", body: { ...SIGNED_OUT, accountGateEnabled } })
      await mount()

      expect(state()).toBe("signed-out")
      expect(toolsShown()).toBe(false)
      const signIn = link("watch-partner-sign-in")!
      const href = new URL(signIn.href)
      expect(href.pathname).toBe("/watch/api/auth/login")
      expect(href.searchParams.get("returnTo")).toBe(
        "/watch/jesus.html?as=partner",
      )
    },
  )

  it.each([true, false])(
    "unlocks the tools for a real session whatever the account gate says (gate %s)",
    async (accountGateEnabled) => {
      serve({ kind: "json", body: { ...SIGNED_IN, accountGateEnabled } })
      await mount()

      expect(state()).toBe("signed-in")
      expect(toolsShown()).toBe(true)
      expect(panel().textContent).toContain("Ada")
      expect(panel().textContent).toContain("ada@example.org")
    },
  )

  it("hands the signed-in identity to the tools and renders nothing for them while signed out", async () => {
    serve({ kind: "json", body: SIGNED_IN })
    await act(async () => {
      root.render(
        <WatchPartnerAccount>
          {({ user }) => <p data-testid="partner-tools">For {user?.name}</p>}
        </WatchPartnerAccount>,
      )
    })
    await settle()

    expect(
      container.querySelector('[data-testid="partner-tools"]')!.textContent,
    ).toBe("For Ada")
  })

  it("signs out through the hosted route and returns to the same page", async () => {
    serve({ kind: "json", body: SIGNED_IN })
    await mount()

    const href = new URL(clickLink(link("watch-partner-sign-out")!))
    expect(href.pathname).toBe("/watch/api/auth/logout")
    expect(href.searchParams.get("returnTo")).toBe(
      "/watch/jesus.html?as=partner&partnerPanel=account",
    )
  })

  it("sends sign-in back to the page the visitor is on now, not the page that mounted the panel", async () => {
    await mount()
    window.history.pushState(null, "", "/watch/other.html?as=partner#grow")

    const href = new URL(clickLink(link("watch-partner-sign-in")!))

    expect(href.pathname).toBe("/watch/api/auth/login")
    expect(href.searchParams.getAll("returnTo")).toEqual([
      "/watch/other.html?as=partner&partnerPanel=account#grow",
    ])
  })

  it("returns to the Partner panel even when the entry URL still hints another role", async () => {
    window.history.replaceState(
      null,
      "",
      "/watch/jesus.html?as=share&unlocked=1",
    )
    await mount()
    const target = new URL(
      new URL(clickLink(link("watch-partner-sign-in")!)).searchParams.get(
        "returnTo",
      )!,
      window.location.origin,
    )
    expect(target.pathname).toBe("/watch/jesus.html")
    expect(target.searchParams.get("as")).toBe("partner")
    expect(target.searchParams.get("partnerPanel")).toBe("account")
  })

  describe("sign-in that did not finish", () => {
    it("says so plainly, stays signed out, and never claims an account exists", async () => {
      window.history.replaceState(
        null,
        "",
        "/watch/jesus.html?as=partner&auth=failed&reason=callback_failed",
      )
      await mount()

      const notice = container.querySelector(
        '[data-testid="watch-partner-auth-notice"]',
      )!
      expect(notice.getAttribute("role")).toBe("alert")
      expect(notice.textContent).toContain("didn’t finish")
      expect(notice.textContent).not.toMatch(/created|welcome|signed in/i)
      expect(notice.textContent).not.toContain("callback_failed")
      expect(state()).toBe("signed-out")
      expect(toolsShown()).toBe(false)
    })

    it("retries to the same page and role without the failure markers piling up", async () => {
      setWatchRole("partner")
      window.history.replaceState(
        null,
        "",
        "/watch/jesus.html?as=partner&auth=failed&reason=invalid_state",
      )
      await mount()

      const href = new URL(clickLink(link("watch-partner-sign-in")!))

      expect(href.searchParams.get("returnTo")).toBe(
        "/watch/jesus.html?as=partner&partnerPanel=account",
      )
      expect(localStorage.getItem("forge.watch.role")).toBe("partner")
    })

    it("shows no notice on an ordinary visit or when a real session exists", async () => {
      await mount()
      expect(
        container.querySelector('[data-testid="watch-partner-auth-notice"]'),
      ).toBeNull()

      act(() => root.unmount())
      root = createRoot(container)
      window.history.replaceState(null, "", "/watch?auth=failed")
      serve({ kind: "json", body: SIGNED_IN })
      await mount()
      expect(state()).toBe("signed-in")
      expect(
        container.querySelector('[data-testid="watch-partner-auth-notice"]'),
      ).toBeNull()
    })
  })

  describe("a session the server cannot confirm", () => {
    it.each([
      ["a server error", { kind: "json", body: {}, status: 503 }],
      ["a dropped connection", { kind: "network-error" }],
      [
        "a malformed answer",
        {
          kind: "json",
          body: { accountGateEnabled: true, authenticated: "yes" },
        },
      ],
    ] as [string, ServerReply][])(
      "locks the tools after %s and lets the visitor retry",
      async (_label, failure) => {
        serve(failure)
        await mount()

        expect(state()).toBe("unavailable")
        expect(toolsShown()).toBe(false)
        expect(link("watch-partner-sign-in")).toBeNull()
        expect(panel().textContent).toContain("couldn’t check")

        serve({ kind: "json", body: SIGNED_IN })
        await act(async () => {
          button("Try again")!.click()
        })
        await settle()

        expect(state()).toBe("signed-in")
        expect(toolsShown()).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(2)
      },
    )

    it("shows the checking state while a retry is in flight", async () => {
      serve({ kind: "network-error" })
      await mount()
      serve({ kind: "pending" })

      await act(async () => {
        button("Try again")!.click()
      })

      expect(state()).toBe("checking")
      expect(toolsShown()).toBe(false)
    })
  })

  describe("forged state", () => {
    it("ignores ?unlocked=1, forged storage and synthetic events", async () => {
      window.history.replaceState(
        null,
        "",
        "/watch/jesus.html?as=partner&unlocked=1",
      )
      for (const key of [
        "unlocked",
        "forge.watch.account",
        "forge.watch.partner",
        "watch-partner-unlocked",
      ]) {
        localStorage.setItem(key, JSON.stringify({ authenticated: true }))
      }
      await mount()
      const callsAfterMount = fetchMock.mock.calls.length

      act(() => {
        window.dispatchEvent(
          new StorageEvent("storage", { key: "forge.watch.account" }),
        )
        window.dispatchEvent(new CustomEvent("watch-account-change"))
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { authenticated: true, accountGateEnabled: true },
          }),
        )
      })
      await settle()

      expect(state()).toBe("signed-out")
      expect(toolsShown()).toBe(false)
      expect(fetchMock.mock.calls.length).toBe(callsAfterMount)
    })

    it("lets only the server's answer unlock, even when a real focus event triggers the check", async () => {
      await mount()
      expect(toolsShown()).toBe(false)

      serve({ kind: "json", body: SIGNED_IN })
      await act(async () => {
        window.dispatchEvent(new Event("focus"))
      })
      await settle()

      expect(state()).toBe("signed-in")
      expect(toolsShown()).toBe(true)
    })
  })

  describe("expiry and sign-out while the page stays open", () => {
    it("locks the tools when the tab regains focus after the session ended", async () => {
      serve({ kind: "json", body: SIGNED_IN })
      await mount()
      expect(toolsShown()).toBe(true)

      serve({ kind: "json", body: SIGNED_OUT })
      await act(async () => {
        window.dispatchEvent(new Event("focus"))
      })
      await settle()

      expect(state()).toBe("signed-out")
      expect(toolsShown()).toBe(false)
      expect(link("watch-partner-sign-in")).not.toBeNull()
    })

    it("re-checks when the tab becomes visible, and not while it is hidden", async () => {
      serve({ kind: "json", body: SIGNED_IN })
      await mount()
      const callsAfterMount = fetchMock.mock.calls.length
      const visibility = vi.spyOn(document, "visibilityState", "get")

      visibility.mockReturnValue("hidden")
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"))
      })
      expect(fetchMock.mock.calls.length).toBe(callsAfterMount)
      expect(toolsShown()).toBe(true)

      serve({ kind: "json", body: SIGNED_OUT })
      visibility.mockReturnValue("visible")
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"))
      })
      await settle()

      expect(fetchMock.mock.calls.length).toBe(callsAfterMount + 1)
      expect(state()).toBe("signed-out")
      expect(toolsShown()).toBe(false)
      visibility.mockRestore()
    })

    it("locks the tools, rather than keeping them, when the re-check itself fails", async () => {
      serve({ kind: "json", body: SIGNED_IN })
      await mount()

      serve({ kind: "network-error" })
      await act(async () => {
        window.dispatchEvent(new Event("focus"))
      })
      await settle()

      expect(state()).toBe("unavailable")
      expect(toolsShown()).toBe(false)
    })

    it("lets a newer answer win over a slower, older one", async () => {
      let releaseSlow: (response: Response) => void = () => undefined
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseSlow = resolve
          }),
      )
      await mount()

      serve({ kind: "json", body: SIGNED_OUT })
      await act(async () => {
        window.dispatchEvent(new Event("focus"))
      })
      await settle()
      expect(state()).toBe("signed-out")

      await act(async () => {
        releaseSlow(Response.json(SIGNED_IN))
      })
      await settle()

      expect(state()).toBe("signed-out")
      expect(toolsShown()).toBe(false)
    })

    it("stops listening, and ignores a late answer, after unmount", async () => {
      serve({ kind: "json", body: SIGNED_IN })
      await mount()
      act(() => root.unmount())
      const calls = fetchMock.mock.calls.length

      window.dispatchEvent(new Event("focus"))
      await settle()

      expect(fetchMock.mock.calls.length).toBe(calls)
      root = createRoot(container)
    })
  })

  it("still unlocks under React StrictMode's mount, unmount, mount cycle", async () => {
    serve({ kind: "json", body: SIGNED_IN })
    await act(async () => {
      root.render(
        <StrictMode>
          <WatchPartnerAccount>{() => tools()}</WatchPartnerAccount>
        </StrictMode>,
      )
    })
    await settle()

    expect(state()).toBe("signed-in")
    expect(toolsShown()).toBe(true)

    serve({ kind: "json", body: SIGNED_OUT })
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    await settle()
    expect(toolsShown()).toBe(false)
  })
})
