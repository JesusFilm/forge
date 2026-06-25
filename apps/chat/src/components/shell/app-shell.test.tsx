import { act, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as chatStub from "@/lib/chat-stub"
import { buildStubReply, STUB_REPLY_DELAY_MS } from "@/lib/chat-stub"
import { deriveTitle } from "@/lib/conversations"

import { AppShell } from "./app-shell"

let user: UserEvent
let view: ReturnType<typeof render>
let container: HTMLElement

beforeEach(() => {
  // shouldAdvanceTime lets user-event's awaited interactions resolve (a plain
  // fake clock hangs them); awaitReply() still jumps the 800ms reply timer
  // deterministically. cleanup() (vitest.setup.ts) unmounts after each test.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  view = render(<AppShell />)
  container = view.container
})

afterEach(() => {
  vi.useRealTimers()
})

function getTextarea(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" })
}

function getSendButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Send" })
}

function getLog(): HTMLElement {
  return screen.getByRole("log", { name: "Conversation" })
}

function getConversationNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Conversations" })
}

// Scope message reads to the conversation log so sidebar rows (also listitems)
// never leak in. The pending turn is a listitem too (as the old querySelectorAll
// "li" was), so exact-count assertions run after awaitReply(), never mid-pending.
function messageTexts(): string[] {
  return within(getLog())
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "")
}

function isPending(): boolean {
  return getLog().querySelector("[data-pending]") !== null
}

// The "New conversation" action and a default-titled conversation row share the
// same accessible name; the action is the one outside the conversation nav.
function getNewConversationAction(): HTMLButtonElement {
  const nav = getConversationNav()
  const action = screen
    .getAllByRole("button", { name: "New conversation" })
    .find((b) => !nav.contains(b))
  if (!action) throw new Error("New conversation action button not found")
  return action as HTMLButtonElement
}

// How many sidebar rows show the per-conversation "replying" pulse.
function sidebarReplyingCount(): number {
  return getConversationNav().querySelectorAll("[data-replying]").length
}

async function sendMessage(text: string) {
  await user.type(getTextarea(), text)
  await user.click(getSendButton())
}

function awaitReply() {
  act(() => {
    vi.advanceTimersByTime(STUB_REPLY_DELAY_MS)
  })
}

async function clickNewConversation() {
  await user.click(getNewConversationAction())
}

// Click a conversation in the rail by its visible title. Scoped to the nav so
// the "New conversation" action is never matched.
async function selectSidebarConversation(title: string) {
  await user.click(
    within(getConversationNav()).getByRole("button", { name: title }),
  )
}

describe("AppShell", () => {
  it("renders the empty-state prompt and stub note when no messages exist", () => {
    expect(container).toHaveTextContent("What would you like to ask?")
    expect(container).toHaveTextContent("no agent is connected yet")
  })

  it("removes the empty state after the first send, before the reply arrives", async () => {
    await sendMessage("hello")
    expect(container).not.toHaveTextContent("What would you like to ask?")
  })

  it("appends the user message, shows pending, disables controls, then replies and re-enables", async () => {
    await sendMessage("hello")

    expect(messageTexts()).toContain("hello")
    expect(isPending()).toBe(true)
    expect(getTextarea()).toBeDisabled()
    expect(getSendButton()).toBeDisabled()

    awaitReply()

    expect(isPending()).toBe(false)
    expect(getTextarea()).toBeEnabled()
    expect(messageTexts()).toHaveLength(2)
  })

  it("replies with exactly buildStubReply of the sent text", async () => {
    await sendMessage("what is this?")
    awaitReply()
    expect(messageTexts()[1]).toBe(buildStubReply("what is this?"))
  })

  it("disables the send button on empty or whitespace-only input while idle", async () => {
    expect(getSendButton()).toBeDisabled()
    await user.type(getTextarea(), "   ")
    expect(getSendButton()).toBeDisabled()
    await user.type(getTextarea(), "hi")
    expect(getSendButton()).toBeEnabled()
  })

  it("treats whitespace-only submit as a no-op", async () => {
    await user.type(getTextarea(), "   ")
    // Enter bypasses the disabled send button, so this exercises the hook's
    // whitespace guard rather than the button's disabled state.
    await user.keyboard("{Enter}")
    expect(messageTexts()).toHaveLength(0)
    expect(container).toHaveTextContent("What would you like to ask?")
  })

  it("ignores a rapid double-submit before re-render", async () => {
    await user.type(getTextarea(), "once")
    // Two synchronous submits in one render cycle — the double-send guard must
    // collapse them to one message (awaited user.click would re-render between and
    // dissolve the test). The form has no role/name, so query it from container.
    const form = container.querySelector("form")
    if (!form) throw new Error("form not found")
    fireEvent.submit(form)
    fireEvent.submit(form)
    awaitReply()
    expect(messageTexts()).toHaveLength(2)
  })

  it("sends on Enter; Shift+Enter does not send", async () => {
    await user.type(getTextarea(), "enter sends{Enter}")
    expect(messageTexts()).toContain("enter sends")

    awaitReply()

    // Shift+Enter inserts a newline instead of sending — user-event simulates
    // the native newline the old synthetic dispatch could not, so the retained
    // draft now carries the "\n".
    await user.type(getTextarea(), "no send")
    await user.keyboard("{Shift>}{Enter}{/Shift}")
    expect(messageTexts()).not.toContain("no send")
    expect(getTextarea()).toHaveValue("no send\n")
  })

  it("clears the input on send", async () => {
    await sendMessage("clear me")
    expect(getTextarea()).toHaveValue("")
  })

  it("cleans up the pending timer on unmount without state-update warnings", async () => {
    const errorSpy = vi.spyOn(console, "error")

    await sendMessage("unmount race")
    view.unmount()
    act(() => {
      vi.runAllTimers()
    })

    expect(vi.getTimerCount()).toBe(0)
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("keeps history append-only with alternating roles across exchanges", async () => {
    await sendMessage("first")
    awaitReply()
    await sendMessage("second")
    awaitReply()

    const texts = messageTexts()
    expect(texts).toHaveLength(4)
    expect(texts[0]).toBe("first")
    expect(texts[1]).toBe(buildStubReply("first"))
    expect(texts[2]).toBe("second")
    expect(texts[3]).toBe(buildStubReply("second"))
    expect(isPending()).toBe(false)
  })

  it("exposes the conversation as a labeled log with the pending turn inside it", async () => {
    const log = getLog()
    expect(log).toHaveAttribute("aria-label", "Conversation")
    expect(getTextarea()).toHaveAttribute("aria-label", "Message")

    await sendMessage("a11y")
    expect(getLog().querySelector("[data-pending]")).not.toBeNull()
  })

  it("starts a fresh empty conversation from the New conversation action", async () => {
    await sendMessage("keep me")
    awaitReply()
    expect(messageTexts()).toHaveLength(2)

    await clickNewConversation()

    // New active conversation is empty again; the old one still lives in the rail.
    expect(messageTexts()).toHaveLength(0)
    expect(container).toHaveTextContent("What would you like to ask?")
    expect(container).toHaveTextContent("keep me")
  })

  it("auto-titles the prior conversation in the rail from its first message", async () => {
    await sendMessage("keep me titled")
    awaitReply()

    const titles = within(getConversationNav())
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
    // Explicit: the rail row shows the derived title, not the default
    // "New conversation" placeholder (the message-list text is excluded
    // because we only read the sidebar nav).
    expect(titles).toContain(deriveTitle("keep me titled"))
    expect(titles).not.toContain("New conversation")
  })

  it("keeps a reply routed to its originating conversation when the user switches mid-reply", async () => {
    await sendMessage("question in A")
    // Switch to a fresh conversation before A's stub reply fires.
    await clickNewConversation()

    // The new conversation is genuinely idle: empty, not pending, composer live.
    expect(messageTexts()).toHaveLength(0)
    expect(isPending()).toBe(false)
    expect(getTextarea()).toBeEnabled()

    awaitReply()

    // The reply landed in A, not the conversation that was active when it fired.
    await selectSidebarConversation(deriveTitle("question in A"))
    const texts = messageTexts()
    expect(texts).toHaveLength(2)
    expect(texts[0]).toBe("question in A")
    expect(texts[1]).toBe(buildStubReply("question in A"))
  })

  it("attaches the pending pulse to the awaiting conversation, not whichever is active", async () => {
    await sendMessage("first")
    expect(sidebarReplyingCount()).toBe(1)

    await clickNewConversation()
    // Active pane (the new, empty conversation) shows no pending cursor...
    expect(isPending()).toBe(false)
    expect(getTextarea()).toBeEnabled()
    // ...but the rail still marks the original conversation as replying.
    expect(sidebarReplyingCount()).toBe(1)

    awaitReply()
    expect(sidebarReplyingCount()).toBe(0)
  })

  it("allows sending in a second conversation while the first is still pending", async () => {
    await sendMessage("alpha")
    await clickNewConversation()
    // This send must NOT be swallowed by a cross-conversation lock.
    await sendMessage("beta")

    expect(messageTexts()).toContain("beta")
    expect(sidebarReplyingCount()).toBe(2)

    awaitReply()
    expect(sidebarReplyingCount()).toBe(0)

    // Each reply landed in its own conversation.
    expect(messageTexts()).toEqual(["beta", buildStubReply("beta")])
    await selectSidebarConversation(deriveTitle("alpha"))
    expect(messageTexts()).toEqual(["alpha", buildStubReply("alpha")])
  })

  it("restores a prior conversation's messages when reselected from the rail", async () => {
    await sendMessage("conv one")
    awaitReply()
    await clickNewConversation()
    await sendMessage("conv two")
    awaitReply()

    await selectSidebarConversation(deriveTitle("conv one"))
    expect(messageTexts()).toEqual(["conv one", buildStubReply("conv one")])
  })

  it("releases the pending slot when reply generation throws, so the conversation can send again", async () => {
    // Latent with the pure stub, but this is the slot-leak guard that matters
    // once the real (rejectable) Mastra call replaces buildStubReply: the
    // finally must clear the timer/pending slot even on a throw.
    const spy = vi
      .spyOn(chatStub, "buildStubReply")
      .mockImplementationOnce(() => {
        throw new Error("reply boom")
      })

    await sendMessage("trigger throw")
    expect(isPending()).toBe(true)

    // The thrown reply propagates out of the timer, but the finally already
    // ran clearTimer, freeing the per-conversation slot.
    expect(() => awaitReply()).toThrow("reply boom")

    // The throw escaped before React committed the slot-release re-render;
    // flush it so the composer reflects the cleared (enabled) state.
    act(() => {})
    expect(getTextarea()).toBeEnabled()

    // Proof the slot was released: a fresh send is accepted (not swallowed by
    // the double-send guard) and resolves cleanly, leaving the pane idle.
    spy.mockRestore()
    await sendMessage("after throw")
    expect(messageTexts()).toContain("after throw")
    awaitReply()
    expect(isPending()).toBe(false)
    expect(getTextarea()).toBeEnabled()
  })

  it("treats reselecting the active conversation as a no-op and keeps the draft", async () => {
    // The sole conversation starts active with the default title. Reselecting
    // it must hit the early-return guard (no draft reset).
    await user.type(getTextarea(), "draft in progress")
    await selectSidebarConversation("New conversation")
    expect(getTextarea()).toHaveValue("draft in progress")
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

function drawerOpen(): boolean {
  return getAside().getAttribute("data-open") === "true"
}

describe("Sidebar shell", () => {
  it("starts expanded: wordmark, collapse toggle, and the conversation list are present", () => {
    const aside = getAside()
    expect(aside).toHaveTextContent("jesusfilm.ai")
    expect(
      within(aside).getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument()
    expect(
      within(aside).queryByRole("button", { name: "Open sidebar" }),
    ).toBeNull()
    expect(
      within(aside).getByRole("navigation", { name: "Conversations" }),
    ).toBeInTheDocument()
  })

  it("collapses and re-expands the desktop rail via the toggle", async () => {
    const aside = getAside()
    await user.click(
      within(aside).getByRole("button", { name: "Collapse sidebar" }),
    )
    // Collapsed: the in-rail expand affordance appears; collapse toggle is gone.
    expect(
      within(aside).getByRole("button", { name: "Open sidebar" }),
    ).toBeInTheDocument()
    expect(
      within(aside).queryByRole("button", { name: "Collapse sidebar" }),
    ).toBeNull()

    await user.click(
      within(aside).getByRole("button", { name: "Open sidebar" }),
    )
    expect(
      within(aside).getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument()
    expect(
      within(aside).queryByRole("button", { name: "Open sidebar" }),
    ).toBeNull()
  })

  it("opens the mobile drawer from the menu trigger and closes it via the X, toggling aria-expanded", async () => {
    expect(drawerOpen()).toBe(false)
    expect(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    ).toHaveAttribute("aria-expanded", "false")

    await user.click(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    )
    expect(drawerOpen()).toBe(true)
    expect(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    ).toHaveAttribute("aria-expanded", "true")
    // Open drawer carries dialog semantics; the desktop rail does not.
    expect(getAside()).toHaveAttribute("role", "dialog")

    await user.click(
      within(getAside()).getByRole("button", { name: "Close sidebar" }),
    )
    expect(drawerOpen()).toBe(false)
    expect(getAside()).not.toHaveAttribute("role")
  })

  it("closes the mobile drawer on Escape", async () => {
    await user.click(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    )
    expect(drawerOpen()).toBe(true)

    await user.keyboard("{Escape}")
    expect(drawerOpen()).toBe(false)
  })

  it("closes the mobile drawer when the scrim is clicked", async () => {
    await user.click(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    )
    expect(drawerOpen()).toBe(true)

    // The scrim is the aria-hidden sibling of the aside carrying onCloseMobile.
    const scrim = container.querySelector<HTMLElement>(
      'div[aria-hidden="true"]',
    )
    if (!scrim) throw new Error("scrim not found")
    await user.click(scrim)
    expect(drawerOpen()).toBe(false)
  })

  it("closes the mobile drawer when New conversation is tapped", async () => {
    await user.click(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    )
    expect(drawerOpen()).toBe(true)

    await clickNewConversation()
    expect(drawerOpen()).toBe(false)
  })

  it("navigates and closes the drawer when a non-active conversation is selected", async () => {
    // Two conversations so the selection actually changes the active one
    // (clicking the already-active row early-returns and proves nothing).
    await sendMessage("first conversation")
    awaitReply()
    await clickNewConversation()

    await user.click(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    )
    expect(drawerOpen()).toBe(true)

    await selectSidebarConversation(deriveTitle("first conversation"))
    expect(drawerOpen()).toBe(false)
    expect(messageTexts()).toEqual([
      "first conversation",
      buildStubReply("first conversation"),
    ])
  })

  it("marks <main> inert only while the mobile drawer is open (focus trap)", async () => {
    expect(getMain()).not.toHaveAttribute("inert")

    await user.click(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    )
    expect(getMain()).toHaveAttribute("inert")

    await user.click(
      within(getAside()).getByRole("button", { name: "Close sidebar" }),
    )
    expect(getMain()).not.toHaveAttribute("inert")
  })

  it("locks body scroll while the mobile drawer is open and restores it on close", async () => {
    expect(document.body.style.overflow).toBe("")

    await user.click(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    )
    expect(document.body.style.overflow).toBe("hidden")

    await user.click(
      within(getAside()).getByRole("button", { name: "Close sidebar" }),
    )
    expect(document.body.style.overflow).toBe("")
  })

  it("moves focus to the close button when the mobile drawer opens", async () => {
    // Open direction is jsdom-testable; focus *restore* on close depends on a
    // visibility guard jsdom can't represent (no layout), so it's browser-verified.
    await user.click(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    )
    expect(
      within(getAside()).getByRole("button", { name: "Close sidebar" }),
    ).toHaveFocus()
  })
})
