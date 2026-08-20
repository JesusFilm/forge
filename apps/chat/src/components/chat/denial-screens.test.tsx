import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CONVERSATION_UNAVAILABLE_COPY, DenialScreen } from "./denial-screens"

const DENIED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const RETURN_TO = `/c/${DENIED_ID}`

describe("DenialScreen — sign_in", () => {
  it("renders the heading, the returnTo-carrying sign-in anchor, and the home anchor", () => {
    render(<DenialScreen screen="sign_in" returnTo={RETURN_TO} />)

    expect(
      screen.getByRole("heading", {
        name: "Sign in to view this conversation",
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/api/auth/login?returnTo=${encodeURIComponent(RETURN_TO)}`,
    )
    expect(
      screen.getByRole("link", { name: "Start new conversation" }),
    ).toHaveAttribute("href", "/")
    expect(document.querySelector('[data-denial="sign_in"]')).not.toBeNull()
  })

  it("falls back to the bare login route when no returnTo is provided", () => {
    render(<DenialScreen screen="sign_in" />)
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/auth/login",
    )
  })

  it("is a denial, not an error: no alert, no composer, anchors only", () => {
    render(<DenialScreen screen="sign_in" returnTo={RETURN_TO} />)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    // Real anchors only — leaving a denial is a clean navigation (KTD6).
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("DenialScreen — unavailable", () => {
  it("renders the shared unavailable copy, a home anchor, and no alert/composer/buttons", () => {
    render(<DenialScreen screen="unavailable" />)

    // Single-sourced with chat.tsx's ReplayNotAvailable (both render the
    // exported constant); app-shell.history.test.tsx pins the literal
    // rendered output externally, so a copy change still goes red somewhere.
    expect(screen.getByText(CONVERSATION_UNAVAILABLE_COPY)).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Start new conversation" }),
    ).toHaveAttribute("href", "/")
    expect(document.querySelector('[data-denial="unavailable"]')).not.toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })
})
