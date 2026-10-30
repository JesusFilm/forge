/**
 * @vitest-environment jsdom
 */

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { session, retry } = vi.hoisted(() => ({
  session: { current: { status: "checking" } as Record<string, unknown> },
  retry: vi.fn(),
}))
vi.mock("./use-watch-account-session", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useWatchAccountSession: () => ({
    session: session.current,
    retry,
    revalidating: false,
  }),
}))
vi.mock("next/dynamic", () => ({
  default: () => (props: { accountId?: string }) =>
    createElement("div", {
      "data-testid": "download-tools",
      "data-account": props.accountId,
    }),
}))
vi.mock("./WatchPartnerResources", () => ({
  WatchPartnerResources: () =>
    createElement("div", { "data-testid": "watch-partner-resources" }),
}))

import { WatchPartnerPanel } from "./WatchPartnerPanel"

let container: HTMLDivElement
let root: Root

function render() {
  act(() =>
    root.render(
      <WatchPartnerPanel
        languageSlug="english"
        locale="en"
        journey={<div data-testid="journey" />}
      />,
    ),
  )
}
const has = (id: string) =>
  container.querySelector(`[data-testid="${id}"]`) !== null

beforeEach(() => {
  retry.mockReset()
  window.history.replaceState(null, "", "/watch/jesus.html?as=partner")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("WatchPartnerPanel", () => {
  it.each(["checking", "signed-out", "unavailable"])(
    "%s shows only the original promo, never the journey, library or tools",
    (status) => {
      session.current = { status }
      render()
      expect(has("watch-partner-promo")).toBe(true)
      expect(has("journey")).toBe(false)
      expect(has("watch-partner-resources")).toBe(false)
      expect(has("download-tools")).toBe(false)
    },
  )

  it("ignores the prototype ?unlocked=1 escape hatch", () => {
    window.history.replaceState(null, "", "/watch/jesus.html?unlocked=1")
    session.current = { status: "signed-out" }
    render()
    expect(has("watch-partner-unlocked")).toBe(false)
  })

  it("sends every sign-in choice to the real hosted login, returning to Partner", () => {
    session.current = {
      status: "signed-out",
      loginUrl: "/watch/api/auth/login",
    }
    render()
    const rows = [
      ...container.querySelectorAll<HTMLAnchorElement>(
        "[data-testid=watch-partner-login] a",
      ),
    ].filter((a) => !a.href.includes("/contact/"))
    // jsdom cannot navigate; stop the default after the component's handler.
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener("click", stop)
    expect(rows.length).toBeGreaterThanOrEqual(4)
    for (const a of rows) {
      act(() =>
        a.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        ),
      )
      const url = new URL(a.href)
      expect(url.pathname).toBe("/watch/api/auth/login")
      const back = new URL(url.searchParams.get("returnTo")!, "http://x")
      expect(back.searchParams.get("as")).toBe("partner")
      expect(back.searchParams.get("partnerPanel")).toBe("account")
    }
    document.removeEventListener("click", stop)
    expect(container.querySelector("input")).toBeNull()
  })

  it("keeps the choices inert while the session is still checking", () => {
    session.current = { status: "checking" }
    render()
    const a = container.querySelector<HTMLAnchorElement>(
      "[data-testid=watch-partner-sign-in]",
    )!
    expect(a.getAttribute("aria-disabled")).toBe("true")
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    act(() => a.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
  })

  it("offers a retry when the session cannot be confirmed", () => {
    session.current = { status: "unavailable" }
    render()
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Try again",
    )!
    act(() => button.click())
    expect(retry).toHaveBeenCalled()
  })

  it("shows the journey, unlocked note, library and tools for a real session", () => {
    session.current = {
      status: "signed-in",
      user: { id: "u1", name: "Ada" },
    }
    render()
    expect(has("journey")).toBe(true)
    expect(container.textContent).toContain(
      "Ada, your partner materials are unlocked.",
    )
    expect(has("watch-partner-resources")).toBe(true)
    expect(
      container
        .querySelector("[data-testid=download-tools]")
        ?.getAttribute("data-account"),
    ).toBe("u1")
    expect(has("watch-partner-promo")).toBe(false)
  })
})
