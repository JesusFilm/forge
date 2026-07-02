import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { type ChatIdentity } from "@/auth/session-cookie"

import { SidebarAccount } from "./sidebar-account"
import { collapsedStyles } from "./sidebar-collapsed-styles"

function renderAccount({
  authConfigured = true,
  identity = null,
  signInError = false,
  collapsed = false,
}: {
  authConfigured?: boolean
  identity?: ChatIdentity | null
  signInError?: boolean
  collapsed?: boolean
} = {}) {
  return render(
    <SidebarAccount
      authConfigured={authConfigured}
      identity={identity}
      signInError={signInError}
      collapsed={collapsed}
      styles={collapsedStyles(collapsed)}
    />,
  )
}

describe("SidebarAccount — signed out (AE1)", () => {
  it("shows a 'Sign in' anchor to /api/auth/login when configured", () => {
    renderAccount()
    const link = screen.getByRole("link", { name: /sign in/i })
    expect(link).toHaveAttribute("href", "/api/auth/login")
  })

  it("renders nothing when auth is unconfigured (KTD6)", () => {
    const { container } = renderAccount({ authConfigured: false })
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull()
  })
})

describe("SidebarAccount — signed in (R4, F2)", () => {
  it("renders name + avatar, and sign-out is a POST form to /api/auth/logout", () => {
    renderAccount({
      identity: {
        sub: "u1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        picture: "https://cdn.example.com/ada.png",
      },
    })
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0)

    const img = document.querySelector("img")
    expect(img?.getAttribute("src")).toContain("cdn.example.com/ada.png")

    const signOut = screen.getByRole("button", { name: "Sign out" })
    const form = signOut.closest("form")
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute("method", "post")
    expect(form).toHaveAttribute("action", "/api/auth/logout")
    // Sign out is NOT a link (a GET logout would be prefetchable/crawlable).
    expect(screen.queryByRole("link", { name: /sign out/i })).toBeNull()
  })

  it("falls back name → email → generic label", () => {
    const { rerender } = renderAccount({
      identity: { sub: "u1", email: "ada@example.com" },
    })
    expect(screen.getAllByText("ada@example.com").length).toBeGreaterThan(0)

    rerender(
      <SidebarAccount
        authConfigured
        identity={{ sub: "u1" }}
        signInError={false}
        collapsed={false}
        styles={collapsedStyles(false)}
      />,
    )
    expect(screen.getAllByText("Signed in").length).toBeGreaterThan(0)
  })

  it("shows initials when picture is absent (not a broken image)", () => {
    renderAccount({
      identity: { sub: "u1", name: "Ada Lovelace", email: "a@example.com" },
    })
    expect(document.querySelector("img")).toBeNull()
    expect(screen.getByText("AL")).toBeInTheDocument()
  })

  it("shows a generic icon when name and email are both absent", () => {
    const { container } = renderAccount({ identity: { sub: "u1" } })
    expect(document.querySelector("img")).toBeNull()
    // No initials text; a generic UserIcon svg stands in.
    expect(screen.queryByText(/^[A-Z]{1,2}$/)).toBeNull()
    expect(container.querySelector("svg")).not.toBeNull()
    // Accessible name still announced (never nothing).
    expect(screen.getAllByText("Signed in").length).toBeGreaterThan(0)
  })
})

describe("SidebarAccount — collapsed rail (persistent, not hidden)", () => {
  it("still renders the signed-in identity (account row is persistent)", () => {
    renderAccount({
      collapsed: true,
      identity: { sub: "u1", name: "Ada Lovelace" },
    })
    // The account row is not removed when collapsed — the name stays accessible.
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0)
  })

  it("shows a titled 'Sign in' target when signed out", () => {
    renderAccount({ collapsed: true })
    const link = screen.getByRole("link", { name: /sign in/i })
    expect(link).toHaveAttribute("title", "Sign in")
  })
})

describe("SidebarAccount — R12 failure notice (AE4)", () => {
  it("renders a brief non-PII notice with the affordance still present", () => {
    renderAccount({ signInError: true, identity: null })
    const notice = screen.getByRole("status")
    expect(
      within(notice).getAllByText(/didn't complete/i).length,
    ).toBeGreaterThan(0)
    // No identity claim values in the notice.
    expect(notice.textContent).not.toMatch(/@/)
    // The retry affordance remains.
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/api/auth/login",
    )
  })

  it("surfaces the cue in the collapsed rail too (never silently dropped)", () => {
    renderAccount({ signInError: true, collapsed: true })
    // A titled icon cue carries the same message where text can't render.
    const notice = screen.getByRole("status")
    expect(
      within(notice).getAllByText(/didn't complete/i).length,
    ).toBeGreaterThan(0)
  })
})
