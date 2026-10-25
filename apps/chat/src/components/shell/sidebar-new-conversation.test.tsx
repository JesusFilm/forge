import { render, screen } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { collapsedStyles } from "./sidebar-collapsed-styles"
import { NewConversationButton } from "./sidebar-new-conversation"

// Built per test (not at module load) so the instance never predates a future
// fake-timer install in this file — matches app-shell.test.tsx.
let user: UserEvent
beforeEach(() => {
  user = userEvent.setup()
})

function renderButton(onNew: () => void, onCloseMobile: () => void) {
  render(
    <NewConversationButton
      styles={collapsedStyles(false)}
      onNew={onNew}
      onCloseMobile={onCloseMobile}
    />,
  )
}

describe("NewConversationButton", () => {
  it("renders the labeled action", () => {
    renderButton(
      () => {},
      () => {},
    )
    expect(
      screen.getByRole("button", { name: "New conversation" }),
    ).toBeInTheDocument()
  })

  it("starts a new conversation and closes the mobile drawer on click", async () => {
    const onNew = vi.fn()
    const onCloseMobile = vi.fn()
    renderButton(onNew, onCloseMobile)

    await user.click(screen.getByRole("button", { name: "New conversation" }))

    // Both fire on a single click — a new chat also dismisses the drawer.
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onCloseMobile).toHaveBeenCalledTimes(1)
  })
})
