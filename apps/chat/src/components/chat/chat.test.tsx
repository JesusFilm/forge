// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildStubReply, STUB_REPLY_DELAY_MS } from "@/lib/chat-stub"
import { Chat } from "./chat"

// Quiet React's "not configured to support act" warnings (same flag the
// admin experience-editor tests set).
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<Chat />)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.useRealTimers()
})

function getTextarea(): HTMLTextAreaElement {
  const el = container.querySelector("textarea")
  if (!el) throw new Error("textarea not found")
  return el
}

function getSendButton(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (!el) throw new Error("send button not found")
  return el
}

function getLog(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[role="log"]')
  if (!el) throw new Error("log container not found")
  return el
}

function typeDraft(value: string) {
  act(() => {
    const el = getTextarea()
    // React tracks the value through its own setter; use the native
    // prototype setter so the dispatched input event carries the change.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set
    setter?.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function pressEnter(options: { shiftKey?: boolean } = {}) {
  act(() => {
    getTextarea().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        shiftKey: options.shiftKey ?? false,
      }),
    )
  })
}

function submitForm() {
  act(() => {
    const form = container.querySelector("form")
    if (!form) throw new Error("form not found")
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
}

function sendMessage(text: string) {
  typeDraft(text)
  submitForm()
}

function awaitReply() {
  act(() => {
    vi.advanceTimersByTime(STUB_REPLY_DELAY_MS)
  })
}

function messageTexts(): string[] {
  return Array.from(container.querySelectorAll("li")).map(
    (li) => li.textContent ?? "",
  )
}

describe("Chat", () => {
  it("renders the centered placeholder with stub-identifying copy when empty", () => {
    expect(container.textContent).toContain("Ask a question")
    expect(container.textContent).toContain(
      "Replies come from a stub — no agent is connected yet.",
    )
  })

  it("removes the placeholder after the first send, before the reply arrives", () => {
    sendMessage("hello")
    expect(container.textContent).not.toContain("Ask a question")
  })

  it("appends the user message, shows pending, disables controls, then replies and re-enables", () => {
    sendMessage("hello")

    expect(messageTexts()).toContain("hello")
    expect(container.textContent).toContain("Stub is thinking…")
    expect(getTextarea().disabled).toBe(true)
    expect(getSendButton().disabled).toBe(true)

    awaitReply()

    expect(container.textContent).not.toContain("Stub is thinking…")
    expect(getTextarea().disabled).toBe(false)
    expect(messageTexts()).toHaveLength(2)
  })

  it("replies with exactly buildStubReply of the sent text", () => {
    sendMessage("what is this?")
    awaitReply()
    expect(messageTexts()[1]).toBe(buildStubReply("what is this?"))
  })

  it("disables the send button on empty or whitespace-only input while idle", () => {
    expect(getSendButton().disabled).toBe(true)
    typeDraft("   ")
    expect(getSendButton().disabled).toBe(true)
    typeDraft("hi")
    expect(getSendButton().disabled).toBe(false)
  })

  it("treats whitespace-only submit as a no-op", () => {
    typeDraft("   ")
    submitForm()
    expect(messageTexts()).toHaveLength(0)
    expect(container.textContent).toContain("Ask a question")
  })

  it("ignores a rapid double-submit before re-render", () => {
    typeDraft("once")
    act(() => {
      const form = container.querySelector("form")
      if (!form) throw new Error("form not found")
      const submit = () =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        )
      submit()
      submit()
    })
    awaitReply()
    expect(messageTexts()).toHaveLength(2)
  })

  it("sends on Enter; Shift+Enter does not send", () => {
    // Note: jsdom does not simulate native textarea newline insertion on
    // keydown, so this pins only the no-send half of the Shift+Enter
    // contract. The newline-insertion behavior is a manual smoke check.
    typeDraft("enter sends")
    pressEnter()
    expect(messageTexts()).toContain("enter sends")

    awaitReply()

    typeDraft("no send")
    pressEnter({ shiftKey: true })
    expect(messageTexts()).not.toContain("no send")
    expect(getTextarea().value).toBe("no send")
  })

  it("clears the input on send", () => {
    sendMessage("clear me")
    expect(getTextarea().value).toBe("")
  })

  it("cleans up the pending timer on unmount without state-update warnings", () => {
    // Own isolated root/container so unmounting here doesn't collide with
    // the shared root that afterEach tears down.
    const localContainer = document.createElement("div")
    document.body.appendChild(localContainer)
    const localRoot = createRoot(localContainer)
    act(() => {
      localRoot.render(<Chat />)
    })

    const errorSpy = vi.spyOn(console, "error")
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set
      const el = localContainer.querySelector("textarea")
      if (!el) throw new Error("textarea not found")
      setter?.call(el, "unmount race")
      el.dispatchEvent(new Event("input", { bubbles: true }))
    })
    act(() => {
      const form = localContainer.querySelector("form")
      if (!form) throw new Error("form not found")
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      )
    })

    act(() => {
      localRoot.unmount()
    })
    act(() => {
      vi.runAllTimers()
    })
    expect(vi.getTimerCount()).toBe(0)
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    localContainer.remove()
  })

  it("keeps history append-only with alternating roles across exchanges", () => {
    sendMessage("first")
    awaitReply()
    sendMessage("second")
    awaitReply()

    const texts = messageTexts()
    expect(texts).toHaveLength(4)
    expect(texts[0]).toBe("first")
    expect(texts[1]).toBe(buildStubReply("first"))
    expect(texts[2]).toBe("second")
    expect(texts[3]).toBe(buildStubReply("second"))
    expect(container.textContent).not.toContain("Stub is thinking…")
  })

  it("exposes the conversation as a labeled log with the pending bubble inside it", () => {
    const log = getLog()
    expect(log.getAttribute("aria-label")).toBe("Conversation")
    expect(getTextarea().getAttribute("aria-label")).toBe("Message")

    sendMessage("a11y")
    expect(log.textContent).toContain("Stub is thinking…")
  })
})
