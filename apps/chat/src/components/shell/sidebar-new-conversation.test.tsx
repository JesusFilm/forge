// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { collapsedStyles } from "./sidebar-collapsed-styles"
import { NewConversationButton } from "./sidebar-new-conversation"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function render(onNew: () => void, onCloseMobile: () => void) {
  act(() => {
    root.render(
      <NewConversationButton
        styles={collapsedStyles(false)}
        onNew={onNew}
        onCloseMobile={onCloseMobile}
      />,
    )
  })
}

describe("NewConversationButton", () => {
  it("renders the labeled action", () => {
    render(
      () => {},
      () => {},
    )
    expect(container.textContent).toContain("New conversation")
  })

  it("starts a new conversation and closes the mobile drawer on click", () => {
    const onNew = vi.fn()
    const onCloseMobile = vi.fn()
    render(onNew, onCloseMobile)

    const button = container.querySelector("button")
    if (!button) throw new Error("New conversation button not found")
    act(() => {
      button.click()
    })

    // Both fire on a single click — a new chat also dismisses the drawer.
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onCloseMobile).toHaveBeenCalledTimes(1)
  })
})
