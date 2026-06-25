// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as chatStub from "@/lib/chat-stub"
import { buildStubReply, STUB_REPLY_DELAY_MS } from "@/lib/chat-stub"
import { deriveTitle } from "@/lib/conversations"
import { AppShell } from "./app-shell"

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
    root.render(<AppShell />)
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

// Scope message reads to the conversation log so sidebar list items (also <li>)
// never leak into the counts.
function messageTexts(): string[] {
  return Array.from(getLog().querySelectorAll("li")).map(
    (li) => li.textContent ?? "",
  )
}

function isPending(): boolean {
  return getLog().querySelector("[data-pending]") !== null
}

function getConversationNav(): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    'nav[aria-label="Conversations"]',
  )
  if (!el) throw new Error("conversation nav not found")
  return el
}

function clickNewConversation() {
  act(() => {
    const newButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
    ).find((b) => b.textContent?.includes("New conversation"))
    if (!newButton) throw new Error("New conversation button not found")
    newButton.click()
  })
}

// Click a conversation in the sidebar rail by its visible title. Scoped to the
// nav so the "New conversation" action is never matched.
function selectSidebarConversation(title: string) {
  act(() => {
    const btn = Array.from(
      getConversationNav().querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent?.includes(title))
    if (!btn) throw new Error(`sidebar conversation "${title}" not found`)
    btn.click()
  })
}

// How many sidebar rows show the per-conversation "replying" pulse.
function sidebarReplyingCount(): number {
  return getConversationNav().querySelectorAll("[data-replying]").length
}

describe("AppShell", () => {
  it("renders the empty-state prompt and stub note when no messages exist", () => {
    expect(container.textContent).toContain("What would you like to ask?")
    expect(container.textContent).toContain("no agent is connected yet")
  })

  it("removes the empty state after the first send, before the reply arrives", () => {
    sendMessage("hello")
    expect(container.textContent).not.toContain("What would you like to ask?")
  })

  it("appends the user message, shows pending, disables controls, then replies and re-enables", () => {
    sendMessage("hello")

    expect(messageTexts()).toContain("hello")
    expect(isPending()).toBe(true)
    expect(getTextarea().disabled).toBe(true)
    expect(getSendButton().disabled).toBe(true)

    awaitReply()

    expect(isPending()).toBe(false)
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
    expect(container.textContent).toContain("What would you like to ask?")
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
      localRoot.render(<AppShell />)
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
    expect(isPending()).toBe(false)
  })

  it("exposes the conversation as a labeled log with the pending turn inside it", () => {
    const log = getLog()
    expect(log.getAttribute("aria-label")).toBe("Conversation")
    expect(getTextarea().getAttribute("aria-label")).toBe("Message")

    sendMessage("a11y")
    expect(log.querySelector("[data-pending]")).not.toBeNull()
  })

  it("starts a fresh empty conversation from the New conversation action", () => {
    sendMessage("keep me")
    awaitReply()
    expect(messageTexts()).toHaveLength(2)

    act(() => {
      const newButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
      ).find((b) => b.textContent?.includes("New conversation"))
      if (!newButton) throw new Error("New conversation button not found")
      newButton.click()
    })

    // New active conversation is empty again; the old one still lives in the rail.
    expect(messageTexts()).toHaveLength(0)
    expect(container.textContent).toContain("What would you like to ask?")
    expect(container.textContent).toContain("keep me")
  })

  it("auto-titles the prior conversation in the rail from its first message", () => {
    sendMessage("keep me titled")
    awaitReply()

    const titles = Array.from(
      getConversationNav().querySelectorAll<HTMLButtonElement>("button"),
    ).map((b) => b.textContent ?? "")
    // Explicit: the rail row shows the derived title, not the default
    // "New conversation" placeholder (the message-list text is excluded
    // because we only read the sidebar nav).
    expect(titles).toContain(deriveTitle("keep me titled"))
    expect(titles).not.toContain("New conversation")
  })

  it("keeps a reply routed to its originating conversation when the user switches mid-reply", () => {
    sendMessage("question in A")
    // Switch to a fresh conversation before A's stub reply fires.
    clickNewConversation()

    // The new conversation is genuinely idle: empty, not pending, composer live.
    expect(messageTexts()).toHaveLength(0)
    expect(isPending()).toBe(false)
    expect(getTextarea().disabled).toBe(false)

    awaitReply()

    // The reply landed in A, not the conversation that was active when it fired.
    selectSidebarConversation(deriveTitle("question in A"))
    const texts = messageTexts()
    expect(texts).toHaveLength(2)
    expect(texts[0]).toBe("question in A")
    expect(texts[1]).toBe(buildStubReply("question in A"))
  })

  it("attaches the pending pulse to the awaiting conversation, not whichever is active", () => {
    sendMessage("first")
    expect(sidebarReplyingCount()).toBe(1)

    clickNewConversation()
    // Active pane (the new, empty conversation) shows no pending cursor...
    expect(isPending()).toBe(false)
    expect(getTextarea().disabled).toBe(false)
    // ...but the rail still marks the original conversation as replying.
    expect(sidebarReplyingCount()).toBe(1)

    awaitReply()
    expect(sidebarReplyingCount()).toBe(0)
  })

  it("allows sending in a second conversation while the first is still pending", () => {
    sendMessage("alpha")
    clickNewConversation()
    // This send must NOT be swallowed by a cross-conversation lock.
    sendMessage("beta")

    expect(messageTexts()).toContain("beta")
    expect(sidebarReplyingCount()).toBe(2)

    awaitReply()
    expect(sidebarReplyingCount()).toBe(0)

    // Each reply landed in its own conversation.
    expect(messageTexts()).toEqual(["beta", buildStubReply("beta")])
    selectSidebarConversation(deriveTitle("alpha"))
    expect(messageTexts()).toEqual(["alpha", buildStubReply("alpha")])
  })

  it("restores a prior conversation's messages when reselected from the rail", () => {
    sendMessage("conv one")
    awaitReply()
    clickNewConversation()
    sendMessage("conv two")
    awaitReply()

    selectSidebarConversation(deriveTitle("conv one"))
    expect(messageTexts()).toEqual(["conv one", buildStubReply("conv one")])
  })

  it("releases the pending slot when reply generation throws, so the conversation can send again", () => {
    // Latent with the pure stub, but this is the slot-leak guard that matters
    // once the real (rejectable) Mastra call replaces buildStubReply: the
    // finally must clear the timer/pending slot even on a throw.
    const spy = vi
      .spyOn(chatStub, "buildStubReply")
      .mockImplementationOnce(() => {
        throw new Error("reply boom")
      })

    sendMessage("trigger throw")
    expect(isPending()).toBe(true)

    // The thrown reply propagates out of the timer, but the finally already
    // ran clearTimer, freeing the per-conversation slot.
    expect(() => awaitReply()).toThrow("reply boom")

    // Proof the slot was released: a fresh send is accepted (not swallowed by
    // the double-send guard) and resolves cleanly, leaving the pane idle.
    spy.mockRestore()
    sendMessage("after throw")
    expect(messageTexts()).toContain("after throw")
    awaitReply()
    expect(isPending()).toBe(false)
    expect(getTextarea().disabled).toBe(false)
  })

  it("treats reselecting the active conversation as a no-op and keeps the draft", () => {
    // The sole conversation starts active with the default title. Reselecting
    // it must hit the early-return guard (no draft reset).
    typeDraft("draft in progress")
    selectSidebarConversation("New conversation")
    expect(getTextarea().value).toBe("draft in progress")
  })
})

// Sidebar collapse + mobile drawer (state lives in AppShell, so this suite
// belongs here per apps/chat/CLAUDE.md). jsdom applies no CSS, so assertions
// read structural signals — which toggle is rendered, the `data-open` attr.
function getAside(): HTMLElement {
  const el = container.querySelector("aside")
  if (!el) throw new Error("aside not found")
  return el
}

function getMain(): HTMLElement {
  const el = container.querySelector("main")
  if (!el) throw new Error("main not found")
  return el
}

// Find a button by accessible label, scoped so the desktop expand toggle and
// the mobile menu trigger don't collide across responsive contexts.
function buttonByLabel(label: string, scope: ParentNode = container) {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.getAttribute("aria-label") === label,
  )
}

function clickButton(el: HTMLButtonElement | undefined) {
  if (!el) throw new Error("button to click not found")
  act(() => {
    el.click()
  })
}

function drawerOpen(): boolean {
  return getAside().getAttribute("data-open") === "true"
}

describe("Sidebar shell", () => {
  it("starts expanded: wordmark, collapse toggle, and the conversation list are present", () => {
    const aside = getAside()
    expect(aside.textContent).toContain("jesusfilm.ai")
    expect(buttonByLabel("Collapse sidebar", aside)).toBeTruthy()
    expect(buttonByLabel("Open sidebar", aside)).toBeFalsy()
    expect(
      aside.querySelector('nav[aria-label="Conversations"]'),
    ).not.toBeNull()
  })

  it("collapses and re-expands the desktop rail via the toggle", () => {
    const aside = getAside()
    clickButton(buttonByLabel("Collapse sidebar", aside))
    // Collapsed: the in-rail expand affordance appears; collapse toggle is gone.
    expect(buttonByLabel("Open sidebar", aside)).toBeTruthy()
    expect(buttonByLabel("Collapse sidebar", aside)).toBeFalsy()

    clickButton(buttonByLabel("Open sidebar", aside))
    expect(buttonByLabel("Collapse sidebar", aside)).toBeTruthy()
    expect(buttonByLabel("Open sidebar", aside)).toBeFalsy()
  })

  it("opens the mobile drawer from the menu trigger and closes it via the X, toggling aria-expanded", () => {
    const trigger = buttonByLabel("Open menu", getMain())
    expect(drawerOpen()).toBe(false)
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")

    clickButton(trigger)
    expect(drawerOpen()).toBe(true)
    expect(
      buttonByLabel("Open menu", getMain())?.getAttribute("aria-expanded"),
    ).toBe("true")
    // Open drawer carries dialog semantics; the desktop rail does not.
    expect(getAside().getAttribute("role")).toBe("dialog")

    clickButton(buttonByLabel("Close sidebar", getAside()))
    expect(drawerOpen()).toBe(false)
    expect(getAside().getAttribute("role")).toBeNull()
  })

  it("closes the mobile drawer on Escape", () => {
    clickButton(buttonByLabel("Open menu", getMain()))
    expect(drawerOpen()).toBe(true)

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(drawerOpen()).toBe(false)
  })

  it("closes the mobile drawer when the scrim is clicked", () => {
    clickButton(buttonByLabel("Open menu", getMain()))
    expect(drawerOpen()).toBe(true)

    // The scrim is the aria-hidden sibling of the aside carrying onCloseMobile.
    const scrim = container.querySelector<HTMLElement>(
      'div[aria-hidden="true"]',
    )
    if (!scrim) throw new Error("scrim not found")
    act(() => {
      scrim.click()
    })
    expect(drawerOpen()).toBe(false)
  })

  it("closes the mobile drawer when New conversation is tapped", () => {
    clickButton(buttonByLabel("Open menu", getMain()))
    expect(drawerOpen()).toBe(true)

    clickNewConversation()
    expect(drawerOpen()).toBe(false)
  })

  it("navigates and closes the drawer when a non-active conversation is selected", () => {
    // Two conversations so the selection actually changes the active one
    // (clicking the already-active row early-returns and proves nothing).
    sendMessage("first conversation")
    awaitReply()
    clickNewConversation()

    clickButton(buttonByLabel("Open menu", getMain()))
    expect(drawerOpen()).toBe(true)

    selectSidebarConversation(deriveTitle("first conversation"))
    expect(drawerOpen()).toBe(false)
    expect(messageTexts()).toEqual([
      "first conversation",
      buildStubReply("first conversation"),
    ])
  })

  it("marks <main> inert only while the mobile drawer is open (focus trap)", () => {
    expect(getMain().hasAttribute("inert")).toBe(false)

    clickButton(buttonByLabel("Open menu", getMain()))
    expect(getMain().hasAttribute("inert")).toBe(true)

    clickButton(buttonByLabel("Close sidebar", getAside()))
    expect(getMain().hasAttribute("inert")).toBe(false)
  })

  it("locks body scroll while the mobile drawer is open and restores it on close", () => {
    expect(document.body.style.overflow).toBe("")

    clickButton(buttonByLabel("Open menu", getMain()))
    expect(document.body.style.overflow).toBe("hidden")

    clickButton(buttonByLabel("Close sidebar", getAside()))
    expect(document.body.style.overflow).toBe("")
  })

  it("moves focus to the close button when the mobile drawer opens", () => {
    // Open direction is jsdom-testable; focus *restore* on close depends on a
    // visibility guard jsdom can't represent (no layout), so it's browser-verified.
    clickButton(buttonByLabel("Open menu", getMain()))
    expect(document.activeElement).toBe(
      buttonByLabel("Close sidebar", getAside()),
    )
  })
})
