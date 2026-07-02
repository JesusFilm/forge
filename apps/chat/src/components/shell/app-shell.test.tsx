import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildStubReply, STUB_REPLY_DELAY_MS } from "@/lib/chat-stub"
import { deriveTitle } from "@/lib/conversations"
import { encodeSseFrame } from "@/lib/sse"

import { AppShell } from "./app-shell"

let user: UserEvent
let view: ReturnType<typeof render>
let container: HTMLElement

// Render the shell with a given flag value and capture the view/container. The
// outer beforeEach renders flag-off (the stub path); Seeker-path tests unmount
// that and re-render flag-on after stubbing fetch.
function renderShell(seekerEnabled = false) {
  view = render(<AppShell seekerEnabled={seekerEnabled} />)
  container = view.container
}

beforeEach(() => {
  // shouldAdvanceTime lets user-event's awaited interactions resolve AND lets
  // real microtasks flow, so the promise-driven streaming seam settles under the
  // fake clock (the stub path's 800ms timer is jumped by awaitReply). cleanup()
  // (vitest.setup.ts) unmounts after each test.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderShell(false)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
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

// Read only the answer text of each turn (the [data-message-content] node), so
// the engine marker / grounded badge / sources metadata never leak into counts.
function messageTexts(): string[] {
  return Array.from(getLog().querySelectorAll("[data-message-content]")).map(
    (el) => el.textContent ?? "",
  )
}

function isPending(): boolean {
  return getLog().querySelector("[data-pending]") !== null
}

function getNewConversationAction(): HTMLButtonElement {
  const nav = getConversationNav()
  const action = screen
    .getAllByRole("button", { name: "New conversation" })
    .find((b) => !nav.contains(b))
  if (!action) throw new Error("New conversation action button not found")
  return action as HTMLButtonElement
}

function sidebarReplyingCount(): number {
  return getConversationNav().querySelectorAll("[data-replying]").length
}

async function sendMessage(text: string) {
  await user.type(getTextarea(), text)
  await user.click(getSendButton())
}

// Jump the stub reply's 800ms timer AND flush the microtasks the streaming seam
// resolves on (the reply now lands via an awaited promise, not a sync callback).
async function awaitReply() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STUB_REPLY_DELAY_MS)
  })
}

async function clickNewConversation() {
  await user.click(getNewConversationAction())
}

async function selectSidebarConversation(title: string) {
  await user.click(
    within(getConversationNav()).getByRole("button", { name: title }),
  )
}

// ---------------------------------------------------------------------------
// Seeker-path helpers (flag on): a mocked fetch returning an SSE Response.
// ---------------------------------------------------------------------------

type Frame = { event: string; data: unknown }

function sseResponse(frames: Frame[], init?: ResponseInit): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) {
        controller.enqueue(encoder.encode(encodeSseFrame(f.event, f.data)))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200, ...init })
}

// Stub global fetch (the hook calls streamReply with no fetchImpl → global
// fetch), render flag-on, and return the mock. `framesFor` is called per request
// so each turn gets a fresh, un-consumed stream.
function renderSeeker(framesFor: () => Frame[] | { reject: true } = () => []) {
  view.unmount()
  const fetchMock = vi.fn().mockImplementation(() => {
    const out = framesFor()
    if (!Array.isArray(out) && out.reject)
      return Promise.reject(new Error("down"))
    return Promise.resolve(sseResponse(out as Frame[]))
  })
  vi.stubGlobal("fetch", fetchMock)
  renderShell(true)
  return fetchMock
}

describe("AppShell — reply lifecycle (stub path, flag off)", () => {
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

    await awaitReply()

    expect(isPending()).toBe(false)
    expect(getTextarea()).toBeEnabled()
    expect(messageTexts()).toHaveLength(2)
  })

  it("replies with exactly buildStubReply of the sent text", async () => {
    await sendMessage("what is this?")
    await awaitReply()
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
    await user.keyboard("{Enter}")
    expect(messageTexts()).toHaveLength(0)
    expect(container).toHaveTextContent("What would you like to ask?")
  })

  it("ignores a rapid double-submit before re-render", async () => {
    await user.type(getTextarea(), "once")
    const form = container.querySelector("form")
    if (!form) throw new Error("form not found")
    fireEvent.submit(form)
    fireEvent.submit(form)
    await awaitReply()
    // One user turn + one assistant turn — the double-send guard collapsed them.
    expect(messageTexts()).toHaveLength(2)
  })

  it("sends on Enter; Shift+Enter does not send", async () => {
    await user.type(getTextarea(), "enter sends{Enter}")
    expect(messageTexts()).toContain("enter sends")

    await awaitReply()

    await user.type(getTextarea(), "no send")
    await user.keyboard("{Shift>}{Enter}{/Shift}")
    expect(messageTexts()).not.toContain("no send")
    expect(getTextarea()).toHaveValue("no send\n")
  })

  it("clears the input on send", async () => {
    await sendMessage("clear me")
    expect(getTextarea()).toHaveValue("")
  })

  it("aborts the in-flight stream on unmount without state-update warnings", async () => {
    const errorSpy = vi.spyOn(console, "error")

    await sendMessage("unmount race")
    view.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUB_REPLY_DELAY_MS)
    })

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("keeps history append-only with alternating roles across exchanges", async () => {
    await sendMessage("first")
    await awaitReply()
    await sendMessage("second")
    await awaitReply()

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
    await awaitReply()
    expect(messageTexts()).toHaveLength(2)

    await clickNewConversation()

    expect(messageTexts()).toHaveLength(0)
    expect(container).toHaveTextContent("What would you like to ask?")
    expect(container).toHaveTextContent("keep me")
  })

  it("auto-titles the prior conversation in the rail from its first message", async () => {
    await sendMessage("keep me titled")
    await awaitReply()

    const titles = within(getConversationNav())
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
    expect(titles).toContain(deriveTitle("keep me titled"))
    expect(titles).not.toContain("New conversation")
  })

  it("keeps a reply routed to its originating conversation when the user switches mid-reply", async () => {
    await sendMessage("question in A")
    await clickNewConversation()

    expect(messageTexts()).toHaveLength(0)
    expect(isPending()).toBe(false)
    expect(getTextarea()).toBeEnabled()

    await awaitReply()

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
    expect(isPending()).toBe(false)
    expect(getTextarea()).toBeEnabled()
    expect(sidebarReplyingCount()).toBe(1)

    await awaitReply()
    expect(sidebarReplyingCount()).toBe(0)
  })

  it("allows sending in a second conversation while the first is still pending", async () => {
    await sendMessage("alpha")
    await clickNewConversation()
    await sendMessage("beta")

    expect(messageTexts()).toContain("beta")
    expect(sidebarReplyingCount()).toBe(2)

    await awaitReply()
    expect(sidebarReplyingCount()).toBe(0)

    expect(messageTexts()).toEqual(["beta", buildStubReply("beta")])
    await selectSidebarConversation(deriveTitle("alpha"))
    expect(messageTexts()).toEqual(["alpha", buildStubReply("alpha")])
  })

  it("restores a prior conversation's messages when reselected from the rail", async () => {
    await sendMessage("conv one")
    await awaitReply()
    await clickNewConversation()
    await sendMessage("conv two")
    await awaitReply()

    await selectSidebarConversation(deriveTitle("conv one"))
    expect(messageTexts()).toEqual(["conv one", buildStubReply("conv one")])
  })

  it("treats reselecting the active conversation as a no-op and keeps the draft", async () => {
    await user.type(getTextarea(), "draft in progress")
    await selectSidebarConversation("New conversation")
    expect(getTextarea()).toHaveValue("draft in progress")
  })

  it("marks stub turns with the Stub engine marker (AE8 — never unmarked)", async () => {
    await sendMessage("stub turn")
    await awaitReply()
    expect(getLog().querySelector('[data-engine="stub"]')).not.toBeNull()
    expect(getLog().querySelector('[data-engine="seeker"]')).toBeNull()
  })
})

describe("Seeker wiring (flag on)", () => {
  it("flag on: empty-state + composer copy name Seeker, not the stub", () => {
    renderSeeker(() => [])
    expect(container).toHaveTextContent("Answers come from Seeker")
    expect(container).toHaveTextContent("Seeker — grounded answers")
    expect(container).not.toHaveTextContent("no agent is connected yet")
  })

  // AE1
  it("flag OFF makes no fetch (the stub path never reaches Mastra)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    // already rendered flag-off in the outer beforeEach
    await sendMessage("offline")
    await awaitReply()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(messageTexts()[1]).toBe(buildStubReply("offline"))
  })

  // AE2
  it("streams tokens then renders final text, a sources list, and a grounded indicator", async () => {
    renderSeeker(() => [
      { event: "token_delta", data: { text: "Jesus " } },
      { event: "token_delta", data: { text: "wept." } },
      {
        event: "result",
        data: {
          text: "Jesus wept.",
          grounded: true,
          sources: [
            {
              sourceName: "John",
              title: "John 11:35",
              url: "https://bible.example/john-11-35",
              score: 0.99,
              snippet: "the shortest verse",
            },
          ],
        },
      },
    ])
    await sendMessage("shortest verse?")
    await waitFor(() => expect(isPending()).toBe(false))

    expect(messageTexts()).toContain("Jesus wept.")
    expect(getLog().querySelector('[data-grounded="cited"]')).not.toBeNull()
    expect(
      within(getLog()).getByRole("link", { name: /John 11:35/ }),
    ).toHaveAttribute("href", "https://bible.example/john-11-35")
    expect(getLog().querySelector('[data-engine="seeker"]')).not.toBeNull()
  })

  // AE3
  it("forwards the same threadId across turns in one conversation", async () => {
    const fetchMock = renderSeeker(() => [
      { event: "result", data: { text: "ok", grounded: false, sources: [] } },
    ])
    await sendMessage("first turn")
    await waitFor(() => expect(isPending()).toBe(false))
    await sendMessage("second turn")
    await waitFor(() => expect(isPending()).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(firstBody.conversationId).toBe(secondBody.conversationId)
  })

  // AE4
  it("renders a distinct timeout message (not a generic network error)", async () => {
    renderSeeker(() => [{ event: "error", data: { reason: "timeout" } }])
    await sendMessage("slow one")
    await waitFor(() => expect(isPending()).toBe(false))

    const alert = within(getLog()).getByRole("alert")
    expect(alert).toHaveTextContent(/timed out/i)
    expect(getTextarea()).toBeEnabled()
  })

  // AE5
  it("keeps partial text and re-enables the composer on a mid-stream error", async () => {
    renderSeeker(() => [
      { event: "token_delta", data: { text: "partial answer" } },
      { event: "error", data: { reason: "generation_failed" } },
    ])
    await sendMessage("interrupt me")
    await waitFor(() => expect(isPending()).toBe(false))

    expect(messageTexts()).toContain("partial answer")
    expect(within(getLog()).getByRole("alert")).toBeInTheDocument()
    expect(getTextarea()).toBeEnabled()
    // The per-conversation slot is released on the error path (not just the
    // composer re-enabled) — guards against a leaked in-flight AbortController.
    expect(sidebarReplyingCount()).toBe(0)
  })

  // AE6
  it("surfaces a visible failure on 401/auth_failed rather than silently re-enabling", async () => {
    renderSeeker(() => [{ event: "error", data: { reason: "auth_failed" } }])
    await sendMessage("who am i")
    await waitFor(() => expect(isPending()).toBe(false))

    expect(within(getLog()).getByRole("alert")).toBeInTheDocument()
    expect(getTextarea()).toBeEnabled()
    expect(sidebarReplyingCount()).toBe(0)
  })

  // AE6 variant — transport failure (fetch rejects) is also visible.
  it("surfaces a visible failure when the fetch rejects, and can send again", async () => {
    let reject = true
    renderSeeker(() => (reject ? { reject: true } : []))
    await sendMessage("drop me")
    await waitFor(() => expect(isPending()).toBe(false))
    expect(within(getLog()).getByRole("alert")).toBeInTheDocument()
    expect(getTextarea()).toBeEnabled()

    // Slot released → a fresh send is accepted.
    reject = false
    await sendMessage("try again")
    expect(messageTexts()).toContain("try again")
  })

  // AE7
  it("renders 'No sources cited' and a distinct grounded-no-citations badge", async () => {
    renderSeeker(() => [
      {
        event: "result",
        data: { text: "grounded but uncited", grounded: true, sources: [] },
      },
    ])
    await sendMessage("any sources?")
    await waitFor(() => expect(isPending()).toBe(false))

    expect(within(getLog()).getByText("No sources cited")).toBeInTheDocument()
    expect(
      getLog().querySelector('[data-grounded="no-citations"]'),
    ).not.toBeNull()
    expect(getLog().querySelector('[data-grounded="cited"]')).toBeNull()
  })

  // AE8
  it("marks Seeker turns with the Seeker engine marker", async () => {
    renderSeeker(() => [
      {
        event: "result",
        data: { text: "from seeker", grounded: false, sources: [] },
      },
    ])
    await sendMessage("who answered")
    await waitFor(() => expect(isPending()).toBe(false))

    expect(getLog().querySelector('[data-engine="seeker"]')).not.toBeNull()
    expect(getLog().querySelector('[data-engine="stub"]')).toBeNull()
  })

  it("renders an ungrounded badge when grounded is false", async () => {
    renderSeeker(() => [
      {
        event: "result",
        data: { text: "no grounding", grounded: false, sources: [] },
      },
    ])
    await sendMessage("ungrounded?")
    await waitFor(() => expect(isPending()).toBe(false))
    expect(
      getLog().querySelector('[data-grounded="ungrounded"]'),
    ).not.toBeNull()
  })

  it("aborts the in-flight Seeker stream on unmount without state-update warnings", async () => {
    const errorSpy = vi.spyOn(console, "error")
    let fetchSignal: AbortSignal | undefined
    // A stream that stays open and idle, erroring its body on abort (mirroring
    // real fetch) so the unmount-driven abort is what unwinds it.
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      fetchSignal = (init as { signal?: AbortSignal }).signal
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          fetchSignal?.addEventListener("abort", () => {
            try {
              controller.error(new DOMException("aborted", "AbortError"))
            } catch {
              // already errored
            }
          })
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    })
    view.unmount()
    vi.stubGlobal("fetch", fetchMock)
    renderShell(true)

    await sendMessage("unmount mid-stream")
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    view.unmount()

    // Unmount aborts the in-flight fetch (resource cleanup) and the post-abort
    // resolution fires no setState-after-unmount warning.
    await waitFor(() => expect(fetchSignal?.aborted).toBe(true))
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
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
    await sendMessage("first conversation")
    await awaitReply()
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
    await user.click(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    )
    expect(
      within(getAside()).getByRole("button", { name: "Close sidebar" }),
    ).toHaveFocus()
  })
})

describe("R12 sign-in-error marker strip (KTD7)", () => {
  afterEach(() => {
    // Restore the jsdom URL so leftover query params don't bleed into siblings.
    window.history.replaceState(null, "", "/")
  })

  it("strips ?signin=failed after showing the notice, preserving other params", async () => {
    view.unmount() // drop the flag-off shell from the outer beforeEach
    window.history.replaceState(null, "", "/?signin=failed&keep=1")
    render(<AppShell authConfigured signInError />)
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).has("signin")).toBe(
        false,
      )
    })
    // The strip is surgical — unrelated params survive.
    expect(new URLSearchParams(window.location.search).get("keep")).toBe("1")
  })

  it("leaves the URL untouched when there is no sign-in error", async () => {
    view.unmount()
    window.history.replaceState(null, "", "/?keep=1")
    render(<AppShell authConfigured />)
    await act(async () => {})
    expect(window.location.search).toBe("?keep=1")
  })
})
