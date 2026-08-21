// feat-209 behavioral suites for the deep-link shell wiring (a sibling of
// app-shell.test.tsx / app-shell.history.test.tsx so no file crosses the
// 1k-line bar); the shared render harness lives in app-shell-test-harness.tsx.
import { act, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { encodeSseFrame } from "@/lib/sse"

import {
  container,
  drawerOpen,
  getConversationNav,
  getLog,
  getMain,
  getNewConversationAction,
  getSendButton,
  jsonRes,
  messageTexts,
  navRowTitles,
  renderSeeker,
  renderShell,
  selectRow,
  sendMessage,
  setupShellTest,
  teardownShellTest,
  user,
  view,
} from "./app-shell-test-harness"

beforeEach(() => {
  setupShellTest()
})

afterEach(() => {
  teardownShellTest()
})

// UUID-shaped fixtures: the popstate path validates ids against the UUID
// pattern, so the feat-241 "thread-alpha" style fixtures can't traverse.
const A = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Alpha thread",
  updatedAt: "2026-08-01T08:00:00.000Z",
}
const B = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  title: "Beta thread",
  updatedAt: "2026-07-31T08:00:00.000Z",
}
const DEEP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const UNKNOWN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

function liveRegion(): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-history-announcement]")
  if (!el) throw new Error("history live region not found")
  return el
}

// Simulate a browser Back/Forward traverse: jsdom's pushState fires no
// popstate, so set the URL first and dispatch the event by hand.
async function traverseTo(pathname: string) {
  await act(async () => {
    window.history.replaceState(null, "", pathname)
    window.dispatchEvent(new PopStateEvent("popstate"))
  })
}

describe("Deep-link shell — URL walk + traversal (AE1 shell half)", () => {
  it("walks the URL on rail selection; Back restores A while B's reply keeps streaming into B", async () => {
    const encoder = new TextEncoder()
    let seekerController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined
    const fetchMock = vi.fn().mockImplementation((url, init?: RequestInit) => {
      const target = String(url)
      if (target === "/api/history/list") {
        return Promise.resolve(
          jsonRes(200, {
            threads: [A, B],
            page: 0,
            perPage: 20,
            total: 2,
            hasMore: false,
          }),
        )
      }
      if (target === "/api/history/thread") {
        const { conversationId } = JSON.parse(String(init?.body)) as {
          conversationId: string
        }
        return Promise.resolve(
          jsonRes(200, {
            messages:
              conversationId === A.id
                ? [
                    { id: "a1", role: "user", text: "question in A" },
                    { id: "a2", role: "assistant", text: "answer in A" },
                  ]
                : [],
          }),
        )
      }
      // /api/seeker: an OPEN stream — the reply must survive the traverse.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          seekerController = controller
          controller.enqueue(
            encoder.encode(
              encodeSseFrame("token_delta", { text: "partial in B" }),
            ),
          )
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    })
    view.unmount()
    vi.stubGlobal("fetch", fetchMock)
    renderShell(true)

    await waitFor(() => expect(navRowTitles()).toContain("Beta thread"))

    await selectRow("Alpha thread")
    await waitFor(() => expect(messageTexts()).toContain("answer in A"))
    expect(window.location.pathname).toBe(`/c/${A.id}`)

    await selectRow("Beta thread")
    await waitFor(() =>
      expect(getLog().querySelector('[data-replay="loading"]')).toBeNull(),
    )
    expect(window.location.pathname).toBe(`/c/${B.id}`)

    await sendMessage("question in B")
    await waitFor(() => expect(messageTexts()).toContain("partial in B"))

    await traverseTo(`/c/${A.id}`)
    expect(messageTexts()).toContain("answer in A")
    expect(messageTexts()).not.toContain("partial in B")
    expect(window.location.pathname).toBe(`/c/${A.id}`)

    // The stream stayed open through the traverse — finish it and prove the
    // reply landed in B, not in the on-screen conversation.
    await act(async () => {
      seekerController?.enqueue(
        encoder.encode(
          encodeSseFrame("result", {
            text: "final answer in B",
            grounded: false,
            sources: [],
          }),
        ),
      )
      seekerController?.close()
    })
    expect(messageTexts()).not.toContain("final answer in B")

    await selectRow("Beta thread")
    await waitFor(() => expect(messageTexts()).toContain("final answer in B"))
    expect(messageTexts()).toContain("question in B")
    expect(window.location.pathname).toBe(`/c/${B.id}`)
  })
})

describe("Denial shells (feat-209, KTD5/KTD6/KTD8)", () => {
  it("deniedScreen=sign_in: no composer, no starters, returnTo on BOTH sign-in anchors, New is an anchor", () => {
    view.unmount()
    renderShell(false, {
      deniedScreen: "sign_in",
      initialConversationId: DEEP,
      authConfigured: true,
    })

    expect(container.querySelector('[data-denial="sign_in"]')).not.toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(container).not.toHaveTextContent("What would you like to ask?")

    // KTD8: the pane CTA and the familiar rail-foot control must agree.
    const expectedHref = `/api/auth/login?returnTo=${encodeURIComponent(`/c/${DEEP}`)}`
    const signInLinks = screen.getAllByRole("link", { name: "Sign in" })
    expect(signInLinks).toHaveLength(2)
    for (const link of signInLinks) {
      expect(link).toHaveAttribute("href", expectedHref)
    }

    expect(
      screen.getByRole("link", { name: "Start new conversation" }),
    ).toHaveAttribute("href", "/")

    // The rail's New control is a real anchor — no session-mutating handler
    // reachable outside the nav rows (KTD6).
    const newLink = screen.getByRole("link", { name: "New conversation" })
    expect(newLink.tagName).toBe("A")
    expect(newLink).toHaveAttribute("href", "/")
    const nav = getConversationNav()
    for (const button of screen.queryAllByRole("button", {
      name: "New conversation",
    })) {
      expect(nav.contains(button)).toBe(true)
    }
  })

  it("deniedScreen=unavailable: exact no-longer-available copy + home anchor, no composer", () => {
    view.unmount()
    renderShell(false, {
      deniedScreen: "unavailable",
      initialConversationId: DEEP,
    })

    expect(
      container.querySelector('[data-denial="unavailable"]'),
    ).not.toBeNull()
    // Anti-drift pin lives in denial-screens.test.tsx; this asserts the shell
    // actually surfaces the literal.
    expect(
      screen.getByText("This conversation is no longer available."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(
      screen.getByRole("link", { name: "Start new conversation" }),
    ).toHaveAttribute("href", "/")
  })

  it("a denial shell never seeds an adopted row or fires any fetch (the KTD5 guard)", async () => {
    view.unmount()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    renderShell(false, {
      deniedScreen: "unavailable",
      initialConversationId: DEEP,
    })
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
    // The rail holds only the fresh local row — the denied id was not adopted.
    expect(navRowTitles()).toEqual(["New conversation"])
  })

  it("a FLAG-ON denial shell keeps the URL-sync layer and hydration inert", async () => {
    // SYNTHETIC prop pair (label refreshed 2026-08-20, feat-399): the producer
    // is now c/[id]/page.tsx's `deepLinkShell(entry.kind)`, whose granted arms
    // never carry a deniedScreen — pinned in deep-link-entry.test.ts.
    window.history.replaceState(null, "", "/c/not-a-uuid")
    const pushSpy = vi.spyOn(window.history, "pushState")
    const replaceSpy = vi.spyOn(window.history, "replaceState")
    const fetchMock = renderSeeker(() => [], {
      deniedScreen: "unavailable",
      initialConversationId: DEEP,
    })
    await act(async () => {})
    try {
      // History hydration inert: not even the /api/history/list call fires.
      expect(fetchMock).not.toHaveBeenCalled()
      // The server-decided pane owns the address bar — no rewrite under it.
      expect(pushSpy).not.toHaveBeenCalled()
      expect(replaceSpy).not.toHaveBeenCalled()
      expect(window.location.pathname).toBe("/c/not-a-uuid")
      // Rail rows stay non-mutating: New is an anchor (deniedScreen-driven —
      // already pinned flag-off above; restated here for the flag-on shell).
      const newLink = screen.getByRole("link", { name: "New conversation" })
      expect(newLink.tagName).toBe("A")
      expect(newLink).toHaveAttribute("href", "/")
    } finally {
      pushSpy.mockRestore()
      replaceSpy.mockRestore()
    }
  })
})

describe("Granted malformed deep link (feat-399)", () => {
  it("keeps the rail, history and URL layer LIVE while the pane says unavailable", async () => {
    // The one production-reachable quadrant feat-209 could not express:
    // seekerEnabled ON, no deniedScreen, no id (the segment was malformed so
    // the route passes none), deepLinkUnresolvable ON.
    window.history.replaceState(null, "", "/c/not-a-uuid")
    const fetchMock = renderSeeker(() => [], {
      listFor: () => ({ threads: [A, B] }),
      deepLinkUnresolvable: true,
    })

    // The pane: the same sentence every other denial cause renders.
    await waitFor(() =>
      expect(
        container.querySelector('[data-denial="unavailable"]'),
      ).not.toBeNull(),
    )
    expect(
      screen.getByText("This conversation is no longer available."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).toBeNull()

    // The defect feat-399 fixes: the rail hydrated and holds the user's rows.
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    expect(navRowTitles()).toContain("Beta thread")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/history/list",
      expect.anything(),
    )

    // A real BUTTON here, not the denial shell's anchor — this shell is
    // granted, so session mutation is allowed. getNewConversationAction() is
    // the RAIL action; a fresh ROW carries the same accessible name.
    expect(screen.queryByRole("link", { name: "New conversation" })).toBeNull()
    expect(getNewConversationAction()).toBeInTheDocument()

    // ADDRESS BAR (the decision this ticket left open): the URL layer's
    // existing rule normalizes the broken path via REPLACE, so Back still
    // leaves the app rather than returning to the dead link.
    expect(window.location.pathname).toBe("/")
  })

  it("RELEASES the pane when the user selects a rail row", async () => {
    window.history.replaceState(null, "", "/c/not-a-uuid")
    renderSeeker(() => [], {
      listFor: () => ({ threads: [A] }),
      threadFor: () => ({
        messages: [{ id: "a2", role: "assistant", text: "answer in A" }],
      }),
      deepLinkUnresolvable: true,
    })
    await waitFor(() =>
      expect(
        container.querySelector('[data-denial="unavailable"]'),
      ).not.toBeNull(),
    )
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))

    await selectRow("Alpha thread")

    // The live chat pane is back: no denial pane, a real transcript, and a
    // composer to type into.
    await waitFor(() => expect(messageTexts()).toContain("answer in A"))
    expect(container.querySelector("[data-denial]")).toBeNull()
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument()
    expect(window.location.pathname).toBe(`/c/${A.id}`)
  })

  it("RELEASES the pane on New conversation, landing ready-to-type", async () => {
    window.history.replaceState(null, "", "/c/not-a-uuid")
    renderSeeker(() => [], { deepLinkUnresolvable: true })
    await waitFor(() =>
      expect(
        container.querySelector('[data-denial="unavailable"]'),
      ).not.toBeNull(),
    )

    // The RAIL action, not the same-named row. The landing conversation is
    // already the fresh empty one, so newConversation() is a full no-op and
    // moves no id: only the explicit dismiss can release the pane.
    await user.click(getNewConversationAction())

    // The RELEASE is what this guards — removing the dismiss turns it red.
    // Focus rides along as the outcome, from composer.tsx's own mount effect
    // (not feat-270's deferred path), so no shell-side branch is needed.
    const composer = await screen.findByRole("textbox", { name: "Message" })
    expect(container.querySelector("[data-denial]")).toBeNull()
    await waitFor(() => expect(composer).toHaveFocus())
  })

  it("RELEASES the pane from the ACTIVE landing row — the natural escape", async () => {
    // The path no other case reaches: the landing row is already active, so
    // selectConversation early-returns and moves NO id — selectFromRail's
    // dismiss is the sole release. The Alpha-thread click moves activeId too.
    window.history.replaceState(null, "", "/c/not-a-uuid")
    renderSeeker(() => [], {
      listFor: () => ({ threads: [A] }),
      deepLinkUnresolvable: true,
    })
    await waitFor(() =>
      expect(
        container.querySelector('[data-denial="unavailable"]'),
      ).not.toBeNull(),
    )

    await selectRow("New conversation")

    expect(container.querySelector("[data-denial]")).toBeNull()
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument()
  })

  it("RELEASES the pane on a history traverse that changes nothing", async () => {
    // Isolates onHistoryNavigation's dismiss: a traverse to "/" while already
    // on the fresh local row makes the hook's newConversation() a no-op, so
    // again no id moves and only the dismiss can release.
    window.history.replaceState(null, "", "/c/not-a-uuid")
    renderSeeker(() => [], { deepLinkUnresolvable: true })
    await waitFor(() =>
      expect(
        container.querySelector('[data-denial="unavailable"]'),
      ).not.toBeNull(),
    )

    await traverseTo("/")

    expect(container.querySelector("[data-denial]")).toBeNull()
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument()
  })

  it("is INERT on a flag-off shell — the belt, not the caller, decides", async () => {
    // SYNTHETIC prop pair (2026-08-20): deepLinkShell only emits
    // deepLinkUnresolvable:true alongside seekerEnabled:true, so this pins the
    // CONSUMER belt — dropping `grantedShell` panes an anonymous user's chat.
    view.unmount()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    renderShell(false, { deepLinkUnresolvable: true })
    await act(async () => {})

    expect(container.querySelector("[data-denial]")).toBeNull()
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("is INERT under a server-decided denial shell — deniedScreen still wins", async () => {
    // SYNTHETIC prop pair (2026-08-20), same producer argument as above:
    // deepLinkShell never pairs deepLinkUnresolvable with a deniedScreen.
    // Pins that the denial shell keeps its inertness if one ever did.
    window.history.replaceState(null, "", "/c/not-a-uuid")
    const replaceSpy = vi.spyOn(window.history, "replaceState")
    const fetchMock = renderSeeker(() => [], {
      deniedScreen: "unavailable",
      deepLinkUnresolvable: true,
    })
    await act(async () => {})
    try {
      expect(fetchMock).not.toHaveBeenCalled()
      expect(replaceSpy).not.toHaveBeenCalled()
      expect(window.location.pathname).toBe("/c/not-a-uuid")
      expect(
        screen.getByRole("link", { name: "New conversation" }),
      ).toBeInTheDocument()
    } finally {
      replaceSpy.mockRestore()
    }
  })
})

describe("Client-side escalation (KTD5)", () => {
  it("renders the unavailable denial pane when the DEEP-LINK conversation's replay is not_available", async () => {
    renderSeeker(() => [], {
      threadFor: () => ({ status: 404, body: { reason: "thread_not_found" } }),
      initialConversationId: DEEP,
    })
    await waitFor(() =>
      expect(
        container.querySelector('[data-denial="unavailable"]'),
      ).not.toBeNull(),
    )
    expect(container).toHaveTextContent(
      "This conversation is no longer available.",
    )
    // The full denial pane, not chat.tsx's in-pane state: NO composer at all.
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("keeps today's in-pane state (disabled composer) for a rail-selected OTHER conversation", async () => {
    renderSeeker(() => [], {
      listFor: () => ({ threads: [A] }),
      threadFor: (conversationId) =>
        conversationId === DEEP
          ? { messages: [] }
          : { status: 404, body: { reason: "thread_not_found" } },
      initialConversationId: DEEP,
    })
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))

    await selectRow("Alpha thread")
    await waitFor(() =>
      expect(
        getLog().querySelector('[data-replay="not_available"]'),
      ).not.toBeNull(),
    )
    // In-pane replay state, not the denial pane: composer present, disabled.
    expect(container.querySelector("[data-denial]")).toBeNull()
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument()
    expect(getSendButton()).toBeDisabled()
  })
})

describe("Popstate shell behaviors (drawer + announcement)", () => {
  it("closes the mobile drawer on popstate, mirroring the row-click path", async () => {
    renderSeeker(() => [])
    await user.click(
      within(getMain()).getByRole("button", { name: "Open menu" }),
    )
    expect(drawerOpen()).toBe(true)

    await traverseTo("/")
    expect(drawerOpen()).toBe(false)
    // No conversation change happened, so nothing is announced.
    expect(liveRegion().textContent).toBe("")
  })

  it("announces a popstate-driven selection with the row label", async () => {
    renderSeeker(() => [], {
      listFor: () => ({ threads: [A] }),
      threadFor: () => ({ messages: [] }),
    })
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    expect(liveRegion()).toHaveAttribute("aria-live", "polite")

    await traverseTo(`/c/${A.id}`)
    await waitFor(() =>
      expect(liveRegion().textContent).toBe("Opened Alpha thread"),
    )
  })

  it("announces a freshly adopted (empty-title) row as 'Opened Conversation', never a blank", async () => {
    renderSeeker(() => [], {
      threadFor: () => ({ messages: [] }),
    })
    await waitFor(() => expect(navRowTitles()).toContain("New conversation"))

    await traverseTo(`/c/${UNKNOWN}`)
    await waitFor(() =>
      expect(liveRegion().textContent).toBe("Opened Conversation"),
    )
  })

  it("does NOT announce a click-driven selection", async () => {
    renderSeeker(() => [], {
      listFor: () => ({ threads: [A] }),
      threadFor: () => ({ messages: [] }),
    })
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))

    await selectRow("Alpha thread")
    await waitFor(() =>
      expect(getLog().querySelector('[data-replay="loading"]')).toBeNull(),
    )
    expect(liveRegion().textContent).toBe("")
  })

  it("stays silent on a click AFTER a no-op traverse left the ref armed (the disarm guard)", async () => {
    renderSeeker(() => [], {
      listFor: () => ({ threads: [A] }),
      threadFor: () => ({ messages: [] }),
    })
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))

    // Invalid-path traverse while already on the fresh local row: the hook's
    // newConversation() no-ops and the drawer is closed, so NO re-render
    // consumes the armed ref — only selectFromRail's disarm can clear it.
    await traverseTo("/c/not-a-uuid")
    expect(liveRegion().textContent).toBe("")

    await selectRow("Alpha thread")
    await waitFor(() =>
      expect(getLog().querySelector('[data-replay="loading"]')).toBeNull(),
    )
    // Deleting the disarm line in selectFromRail turns this into
    // "Opened Alpha thread" — the click path must stay silent.
    expect(liveRegion().textContent).toBe("")
  })
})
