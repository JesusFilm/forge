// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ConfirmSendModal } from "./confirm-send-modal"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function confirmButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    '[data-testid="push-confirm-submit"]',
  )
  if (!button) throw new Error("no confirm button rendered")
  return button
}

function type(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    '[data-testid="push-confirm-input"]',
  )
  if (!input) throw new Error("no confirm input rendered")
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("ConfirmSendModal with a required value", () => {
  it("holds the confirm button until the typed value matches exactly", () => {
    const onConfirm = vi.fn()
    act(() => {
      root.render(
        <ConfirmSendModal
          open
          title="Send this announcement now?"
          consequence="Some viewers receive it in the middle of their night."
          requiredValue="1234"
          confirmLabel="Send now"
          onCancel={() => {}}
          onConfirm={onConfirm}
        />,
      )
    })

    expect(confirmButton().disabled).toBe(true)
    type("1233")
    expect(confirmButton().disabled).toBe(true)
    type("1234")
    expect(confirmButton().disabled).toBe(false)

    act(() => confirmButton().click())
    expect(onConfirm).toHaveBeenCalledWith("1234")
  })

  it("names the consequence the editor is confirming", () => {
    act(() => {
      root.render(
        <ConfirmSendModal
          open
          title="Send this announcement now?"
          consequence="This reaches 1234 phone(s) in SA, FR at once. It ignores the local hour, so some viewers receive it in the middle of their night."
          detail="7 phone(s) cannot be reached."
          requiredValue="1234"
          confirmLabel="Send now"
          onCancel={() => {}}
          onConfirm={() => {}}
        />,
      )
    })
    expect(container.textContent).toContain("middle of their night")
    expect(container.textContent).toContain("SA, FR")
    expect(container.textContent).toContain("7 phone(s) cannot be reached.")
  })

  it("clears the typed value when it closes, so a reopen starts blocked", () => {
    function render(open: boolean) {
      act(() => {
        root.render(
          <ConfirmSendModal
            open={open}
            title="Send this announcement now?"
            consequence="Consequence"
            requiredValue="5"
            confirmLabel="Send now"
            onCancel={() => {}}
            onConfirm={() => {}}
          />,
        )
      })
    }
    render(true)
    type("5")
    expect(confirmButton().disabled).toBe(false)
    render(false)
    render(true)
    expect(confirmButton().disabled).toBe(true)
  })
})

describe("ConfirmSendModal without a required value", () => {
  it("confirms directly, which is the cancel action's shape", () => {
    const onConfirm = vi.fn()
    act(() => {
      root.render(
        <ConfirmSendModal
          open
          title="Cancel this campaign?"
          consequence="Every zone that has not started is not sent."
          confirmLabel="Cancel the campaign"
          onCancel={() => {}}
          onConfirm={onConfirm}
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="push-confirm-input"]'),
    ).toBeNull()
    expect(confirmButton().disabled).toBe(false)
    act(() => confirmButton().click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("renders nothing while closed", () => {
    act(() => {
      root.render(
        <ConfirmSendModal
          open={false}
          title="Cancel this campaign?"
          consequence="Consequence"
          confirmLabel="Cancel the campaign"
          onCancel={() => {}}
          onConfirm={() => {}}
        />,
      )
    })
    expect(container.innerHTML).toBe("")
  })

  it("cancels on Escape unless an action is already in flight", () => {
    const onCancel = vi.fn()
    function render(pending: boolean) {
      act(() => {
        root.render(
          <ConfirmSendModal
            open
            title="Cancel this campaign?"
            consequence="Consequence"
            confirmLabel="Cancel the campaign"
            pending={pending}
            onCancel={onCancel}
            onConfirm={() => {}}
          />,
        )
      })
    }
    render(false)
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)

    render(true)
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
