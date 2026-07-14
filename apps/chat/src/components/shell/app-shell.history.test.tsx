// feat-241 behavioral suites for the server-history surfaces (split from
// app-shell.test.tsx so neither file crosses the 1k-line bar); the shared
// render harness + fixtures live in app-shell-test-harness.tsx.
import { act, fireEvent, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildStubReply } from "@/lib/chat-stub"
import { deriveTitle, fallbackTitle } from "@/lib/conversations"

import {
  ALPHA,
  ALPHA_TRANSCRIPT,
  BETA,
  container,
  deferredResponse,
  getConversationNav,
  getLog,
  getSendButton,
  getTextarea,
  isPending,
  jsonRes,
  messageTexts,
  navRowTitles,
  historyThreadCallCount,
  renderSeeker,
  renderShell,
  seekerCallBodies,
  selectRow,
  sendMessage,
  setupShellTest,
  teardownShellTest,
  UNTITLED,
  user,
  view,
} from "./app-shell-test-harness"

beforeEach(() => {
  setupShellTest()
})

afterEach(() => {
  teardownShellTest()
})

describe("Server history — hydration + sidebar states (feat-241)", () => {
  it("makes no hydration fetch when seekerEnabled is false (AE2 client half)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    view.unmount()
    renderShell(false)
    // Flush a tick — a mount effect would have fired by now.
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("hydrates the first page post-mount: titles + date fallback labels, most-recent-first, fresh pane on top (AE8, AE6)", async () => {
    renderSeeker(() => [], {
      listFor: () => ({ threads: [ALPHA, BETA, UNTITLED] }),
    })
    await waitFor(() =>
      expect(navRowTitles()).toEqual([
        "New conversation",
        "Alpha thread",
        "Beta thread",
        fallbackTitle(UNTITLED.updatedAt),
      ]),
    )
    // AE8: the main pane is a fresh chat — starter questions, composer live.
    expect(container).toHaveTextContent("What would you like to ask?")
    expect(getTextarea()).toBeEnabled()
    const active = within(getConversationNav()).getByRole("button", {
      name: "New conversation",
    })
    expect(active).toHaveAttribute("aria-current", "true")
  })

  it("appends the next page on Load more without duplicating rows (AE13)", async () => {
    renderSeeker(() => [], {
      listFor: (call) =>
        call === 0
          ? { threads: [ALPHA, BETA], hasMore: true }
          : { threads: [BETA, UNTITLED], hasMore: false },
    })
    const nav = getConversationNav()
    await waitFor(() =>
      expect(
        within(nav).getByRole("button", { name: "Load more" }),
      ).toBeEnabled(),
    )
    await user.click(within(nav).getByRole("button", { name: "Load more" }))
    await waitFor(() =>
      expect(navRowTitles()).toContain(fallbackTitle(UNTITLED.updatedAt)),
    )
    // First-seen dedupe: the thread present on both pages renders once.
    expect(
      navRowTitles().filter((title) => title === "Beta thread"),
    ).toHaveLength(1)
    // No more pages → the control disappears.
    expect(within(nav).queryByRole("button", { name: "Load more" })).toBeNull()
  })

  it("renders the sidebar error state on hydration failure and recovers via retry (R16)", async () => {
    renderSeeker(() => [], {
      listFor: (call) => (call === 0 ? { status: 500 } : { threads: [ALPHA] }),
    })
    const nav = getConversationNav()
    await waitFor(() =>
      expect(nav.querySelector('[data-history="error"]')).not.toBeNull(),
    )
    await user.click(within(nav).getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    expect(nav.querySelector('[data-history="error"]')).toBeNull()
  })

  it("reverts silently to the client-only sidebar on a mid-session access denial (KTD8/R16)", async () => {
    renderSeeker(() => [], {
      listFor: (call) =>
        call === 0
          ? { threads: [ALPHA, BETA], hasMore: true }
          : { status: 401, body: { reason: "invalid_session" } },
    })
    const nav = getConversationNav()
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    await user.click(within(nav).getByRole("button", { name: "Load more" }))
    await waitFor(() => expect(navRowTitles()).toEqual(["New conversation"]))
    // Quiet: no error banner, no nudge — today's client-only look.
    expect(nav.querySelector("[data-history]")).toBeNull()
  })

  it("keeps in-session messages and adopts a non-empty server title when a listed row matches a local conversation (merge precedence)", async () => {
    let capturedId = ""
    const fetchMock = renderSeeker(
      () => [
        {
          event: "result",
          data: { text: "seeker says", grounded: false, sources: [] },
        },
      ],
      {
        listFor: (call) =>
          call === 0
            ? { threads: [], hasMore: true }
            : {
                threads: [
                  {
                    id: capturedId,
                    title: "LLM Title",
                    updatedAt: "2026-07-13T09:00:00.000Z",
                  },
                ],
              },
      },
    )
    await sendMessage("first message here")
    await waitFor(() => expect(isPending()).toBe(false))
    capturedId = seekerCallBodies(fetchMock)[0].conversationId

    await user.click(
      within(getConversationNav()).getByRole("button", { name: "Load more" }),
    )
    // The server LLM title replaces the deriveTitle snippet…
    await waitFor(() => expect(navRowTitles()).toContain("LLM Title"))
    expect(navRowTitles()).not.toContain(deriveTitle("first message here"))
    // …and the in-session messages stay authoritative (no replay wipe).
    expect(messageTexts()).toContain("first message here")
    expect(messageTexts()).toContain("seeker says")
    // Exactly one row for the conversation (dedupe by id).
    expect(navRowTitles().filter((t) => t === "LLM Title")).toHaveLength(1)
  })

  it("keeps the client snippet when the matching listed row has an empty title", async () => {
    let capturedId = ""
    const fetchMock = renderSeeker(
      () => [
        { event: "result", data: { text: "ok", grounded: false, sources: [] } },
      ],
      {
        listFor: (call) =>
          call === 0
            ? { threads: [], hasMore: true }
            : {
                threads: [
                  {
                    id: capturedId,
                    title: "",
                    updatedAt: "2026-07-13T09:00:00.000Z",
                  },
                ],
              },
      },
    )
    await sendMessage("keep my snippet")
    await waitFor(() => expect(isPending()).toBe(false))
    capturedId = seekerCallBodies(fetchMock)[0].conversationId

    await user.click(
      within(getConversationNav()).getByRole("button", { name: "Load more" }),
    )
    await waitFor(() =>
      expect(
        within(getConversationNav()).queryByRole("button", {
          name: "Load more",
        }),
      ).toBeNull(),
    )
    expect(navRowTitles()).toContain(deriveTitle("keep my snippet"))
  })

  it("aborts an in-flight history fetch on unmount", async () => {
    const fetchMock = renderSeeker(() => [], {
      listFor: () => ({ hang: true }),
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.signal as AbortSignal).aborted).toBe(false)
    view.unmount()
    expect((init.signal as AbortSignal).aborted).toBe(true)
  })
})

describe("Server history — replay + resume (feat-241)", () => {
  it("lazy-loads a transcript exactly once: none before select, one on select, cached after (AE14)", async () => {
    const fetchMock = renderSeeker(() => [], {
      listFor: () => ({ threads: [ALPHA] }),
      threadFor: () => ALPHA_TRANSCRIPT,
    })
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    expect(historyThreadCallCount(fetchMock)).toBe(0)

    await selectRow("Alpha thread")
    await waitFor(() => expect(messageTexts()).toContain("old answer"))
    expect(historyThreadCallCount(fetchMock)).toBe(1)
    // Replayed turns render as bare text: no engine marker, no badges (R21).
    expect(getLog().querySelector("[data-engine]")).toBeNull()
    expect(getLog().querySelector("[data-grounded]")).toBeNull()

    // Select away and back — the transcript is session-cached, no refetch.
    await selectRow("New conversation")
    await selectRow("Alpha thread")
    await waitFor(() => expect(messageTexts()).toContain("old answer"))
    expect(historyThreadCallCount(fetchMock)).toBe(1)
  })

  it("stays single-flight during a slow replay; the loading pane suppresses starter questions (AE14, U7)", async () => {
    const fetchMock = renderSeeker(() => [], {
      listFor: () => ({ threads: [ALPHA] }),
      threadFor: () => ({ hang: true }),
    })
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    await selectRow("Alpha thread")
    await waitFor(() =>
      expect(getLog().querySelector('[data-replay="loading"]')).not.toBeNull(),
    )
    // Mutually exclusive pane bodies: no dead starter questions while blocked.
    expect(container).not.toHaveTextContent("What would you like to ask?")

    await selectRow("New conversation")
    await selectRow("Alpha thread")
    expect(historyThreadCallCount(fetchMock)).toBe(1)
  })

  it("blocks sends while the transcript loads (draft preserved) and allows them after load (AE18, R22)", async () => {
    const deferred = deferredResponse()
    const fetchMock = renderSeeker(
      () => [
        {
          event: "result",
          data: { text: "resumed reply", grounded: false, sources: [] },
        },
      ],
      {
        listFor: () => ({ threads: [ALPHA] }),
        threadFor: () => deferred.promise,
      },
    )
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    await selectRow("Alpha thread")
    await waitFor(() =>
      expect(getLog().querySelector('[data-replay="loading"]')).not.toBeNull(),
    )

    // The composer surfaces the per-state reason; the textarea stays editable.
    expect(container).toHaveTextContent("Loading conversation…")
    expect(getTextarea()).toBeEnabled()
    await user.type(getTextarea(), "resume question")
    expect(getTextarea()).toHaveValue("resume question")
    expect(getSendButton()).toBeDisabled()
    fireEvent.submit(getSendButton().closest("form")!)
    expect(seekerCallBodies(fetchMock)).toHaveLength(0)

    // Transcript lands → sends unblock; the draft survived the wait.
    deferred.resolve(jsonRes(200, ALPHA_TRANSCRIPT))
    await waitFor(() => expect(messageTexts()).toContain("old answer"))
    expect(container).not.toHaveTextContent("Loading conversation…")
    await user.click(getSendButton())
    await waitFor(() => expect(isPending()).toBe(false))
    const bodies = seekerCallBodies(fetchMock)
    expect(bodies).toHaveLength(1)
    // AE7: the resume rides the SAME server thread id through the send path.
    expect(bodies[0].conversationId).toBe(ALPHA.id)
    expect(bodies[0].text).toBe("resume question")
    expect(messageTexts()).toContain("resumed reply")
  })

  it("bumps a resumed thread to the top and never duplicates its row (AE7)", async () => {
    renderSeeker(
      () => [
        { event: "result", data: { text: "ok", grounded: false, sources: [] } },
      ],
      {
        listFor: () => ({ threads: [ALPHA, BETA] }),
        threadFor: () => ({ messages: [] }),
      },
    )
    await waitFor(() => expect(navRowTitles()).toContain("Beta thread"))
    await selectRow("Beta thread")
    // Empty transcript loads instantly → sends allowed.
    await waitFor(() =>
      expect(getLog().querySelector('[data-replay="loading"]')).toBeNull(),
    )
    await sendMessage("resume the older thread")
    await waitFor(() => expect(isPending()).toBe(false))

    await waitFor(() =>
      expect(navRowTitles()).toEqual([
        "New conversation",
        "Beta thread",
        "Alpha thread",
      ]),
    )
    expect(navRowTitles().filter((t) => t === "Beta thread")).toHaveLength(1)
  })

  it("keeps the server title after a send into an empty replayed thread (KTD9 retitle skip)", async () => {
    renderSeeker(
      () => [
        { event: "result", data: { text: "ok", grounded: false, sources: [] } },
      ],
      {
        listFor: () => ({ threads: [ALPHA] }),
        threadFor: () => ({ messages: [] }),
      },
    )
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    await selectRow("Alpha thread")
    await waitFor(() =>
      expect(getLog().querySelector('[data-replay="loading"]')).toBeNull(),
    )
    await sendMessage("this must not become the title")
    await waitFor(() => expect(isPending()).toBe(false))
    expect(navRowTitles()).toContain("Alpha thread")
    expect(navRowTitles()).not.toContain(
      deriveTitle("this must not become the title"),
    )
  })

  it("renders the replay failure state with a working retry; sends stay blocked until it loads (R18)", async () => {
    const fetchMock = renderSeeker(() => [], {
      listFor: () => ({ threads: [ALPHA] }),
      threadFor: () => ({ status: 500 }),
    })
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    await selectRow("Alpha thread")
    await waitFor(() =>
      expect(getLog().querySelector('[data-replay="failed"]')).not.toBeNull(),
    )
    expect(within(getLog()).getByRole("alert")).toHaveTextContent(
      /couldn't be loaded/i,
    )
    expect(container).toHaveTextContent("This conversation is unavailable")
    expect(getSendButton()).toBeDisabled()

    // Retry succeeds → transcript renders, composer unblocks.
    fetchMock.mockImplementation((url, init?: RequestInit) => {
      if (String(url) === "/api/history/thread") {
        void init
        return Promise.resolve(jsonRes(200, ALPHA_TRANSCRIPT))
      }
      return Promise.resolve(jsonRes(200, { threads: [], hasMore: false }))
    })
    await user.click(within(getLog()).getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(messageTexts()).toContain("old answer"))
    expect(container).not.toHaveTextContent("This conversation is unavailable")
  })

  it("renders the no-longer-available state with an in-pane recovery action (R18)", async () => {
    renderSeeker(() => [], {
      listFor: () => ({ threads: [ALPHA] }),
      threadFor: () => ({ status: 404, body: { reason: "thread_not_found" } }),
    })
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    await selectRow("Alpha thread")
    await waitFor(() =>
      expect(
        getLog().querySelector('[data-replay="not_available"]'),
      ).not.toBeNull(),
    )
    expect(container).toHaveTextContent(
      "This conversation is no longer available.",
    )
    // The sidebar row goes muted with the sr-only note.
    const row = within(getConversationNav()).getByRole("button", {
      name: /Alpha thread/,
    })
    expect(row.className).toContain("opacity-50")
    expect(row).toHaveTextContent("(unavailable)")

    // Starter questions stay suppressed; recovery is one click away.
    expect(container).not.toHaveTextContent("What would you like to ask?")
    await user.click(
      within(getLog().parentElement ?? container).getByRole("button", {
        name: "Start new conversation",
      }),
    )
    await waitFor(() =>
      expect(container).toHaveTextContent("What would you like to ask?"),
    )
    expect(getSendButton().closest("form")).not.toHaveTextContent(
      "This conversation is unavailable",
    )
  })
})

describe("Denied sends on persisted conversations (feat-241, KTD10/AE16)", () => {
  it("fails visibly with the access-changed copy on a replayed server conversation — no stub text", async () => {
    renderSeeker(() => [{ event: "error", data: { reason: "gate_denied" } }], {
      listFor: () => ({ threads: [ALPHA] }),
      threadFor: () => ALPHA_TRANSCRIPT,
    })
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    await selectRow("Alpha thread")
    await waitFor(() => expect(messageTexts()).toContain("old answer"))

    await sendMessage("still there?")
    await waitFor(() => expect(isPending()).toBe(false))
    const alert = within(getLog()).getByRole("alert")
    expect(alert).toHaveTextContent(/Your access to Seeker has changed/)
    expect(container).not.toHaveTextContent("Stubbed reply")
  })

  it("fails visibly after a completed Seeker turn persisted the conversation this session", async () => {
    let turn = 0
    renderSeeker(() => {
      turn += 1
      return turn === 1
        ? [
            {
              event: "result",
              data: { text: "real answer", grounded: false, sources: [] },
            },
          ]
        : [{ event: "error", data: { reason: "gate_denied" } }]
    })
    await sendMessage("first — succeeds")
    await waitFor(() => expect(messageTexts()).toContain("real answer"))
    await sendMessage("second — denied")
    await waitFor(() => expect(isPending()).toBe(false))
    expect(within(getLog()).getByRole("alert")).toHaveTextContent(
      /Your access to Seeker has changed/,
    )
    expect(container).not.toHaveTextContent("Stubbed reply")
  })

  it("still stub-degrades on a never-persisted conversation", async () => {
    renderSeeker(() => [{ event: "error", data: { reason: "gate_denied" } }])
    await sendMessage("fresh conversation")
    await waitFor(() => expect(isPending()).toBe(false))
    expect(messageTexts()).toContain(buildStubReply("fresh conversation"))
    expect(within(getLog()).queryByRole("alert")).toBeNull()
  })

  it("still stub-degrades when the only Seeker turn FAILED before reaching the server (predicate keys on success)", async () => {
    let turn = 0
    renderSeeker(() => {
      turn += 1
      return turn === 1
        ? [{ event: "error", data: { reason: "config_missing" } }]
        : [{ event: "error", data: { reason: "gate_denied" } }]
    })
    await sendMessage("first — config failure")
    await waitFor(() => expect(isPending()).toBe(false))
    // The failed turn carries the seeker engine tag — the predicate must not.
    expect(getLog().querySelector('[data-engine="seeker"]')).not.toBeNull()

    await sendMessage("second — denied")
    await waitFor(() => expect(isPending()).toBe(false))
    expect(messageTexts()).toContain(buildStubReply("second — denied"))
  })
})

describe("Remount safety (dev StrictMode cycle)", () => {
  it("hydrates the sidebar under a StrictMode double-mount instead of wedging at loading", async () => {
    renderSeeker(() => [], {
      listFor: () => ({ threads: [ALPHA] }),
      strictMode: true,
    })
    // StrictMode runs effect setup -> cleanup -> setup on the same hook
    // instance; the cleanup aborts the first hydration fetch, so this only
    // passes when the remounted effects re-arm and refetch (C1 regression).
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    expect(
      getConversationNav().querySelector('[data-history="loading"]'),
    ).toBeNull()
  })

  it("still replays and sends after a StrictMode mount cycle", async () => {
    const fetchMock = renderSeeker(
      () => [
        {
          event: "result",
          data: { text: "post-remount reply", grounded: false, sources: [] },
        },
      ],
      {
        listFor: () => ({ threads: [ALPHA] }),
        threadFor: () => ALPHA_TRANSCRIPT,
        strictMode: true,
      },
    )
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    await selectRow("Alpha thread")
    await waitFor(() => expect(messageTexts()).toContain("old answer"))
    await sendMessage("still alive?")
    await waitFor(() => expect(isPending()).toBe(false))
    expect(messageTexts()).toContain("post-remount reply")
    expect(seekerCallBodies(fetchMock)).toHaveLength(1)
  })
})

describe("KTD10 predicate — mid-stream-failed turns count as persisted", () => {
  it("fails visibly on gate_denied after a turn that died mid-stream WITH partial text", async () => {
    let turn = 0
    renderSeeker(() => {
      turn += 1
      return turn === 1
        ? [
            { event: "token_delta", data: { text: "partial before crash" } },
            { event: "error", data: { reason: "generation_failed" } },
          ]
        : [{ event: "error", data: { reason: "gate_denied" } }]
    })
    await sendMessage("first — dies mid-stream")
    await waitFor(() => expect(isPending()).toBe(false))
    // The stream opened (tokens arrived), so Mastra created the thread row —
    // the conversation is server-persisted despite the failed turn.
    expect(messageTexts()).toContain("partial before crash")

    await sendMessage("second — denied")
    await waitFor(() => expect(isPending()).toBe(false))
    expect(container).toHaveTextContent(/Your access to Seeker has changed/)
    expect(container).not.toHaveTextContent("Stubbed reply")
  })
})

describe("Replay access loss — KTD8 uniformity", () => {
  it("reverts silently to the client-only sidebar when replay hits an access denial", async () => {
    renderSeeker(() => [], {
      listFor: () => ({ threads: [ALPHA, BETA] }),
      threadFor: () => ({ status: 401, body: { reason: "invalid_session" } }),
    })
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    await selectRow("Alpha thread")

    // Same silent fall-back the list path uses: server rows disappear, a
    // fresh pane takes over — never the data-loss "no longer available" copy.
    await waitFor(() => expect(navRowTitles()).toEqual(["New conversation"]))
    expect(container).not.toHaveTextContent("no longer available")
    expect(container).toHaveTextContent("What would you like to ask?")
    expect(getConversationNav().querySelector("[data-history]")).toBeNull()
  })

  it("keeps a clean revert when a Load-more denial lands while a replay is in flight (race)", async () => {
    const deferred = deferredResponse()
    renderSeeker(() => [], {
      listFor: (call) =>
        call === 0
          ? { threads: [ALPHA, BETA], hasMore: true }
          : { status: 401, body: { reason: "invalid_session" } },
      threadFor: () => deferred.promise,
    })
    await waitFor(() => expect(navRowTitles()).toContain("Alpha thread"))
    await selectRow("Alpha thread")
    await waitFor(() =>
      expect(getLog().querySelector('[data-replay="loading"]')).not.toBeNull(),
    )

    // The list-path denial sweeps the (message-less, still-loading) active
    // row and lands on a fresh pane.
    await user.click(
      within(getConversationNav()).getByRole("button", { name: "Load more" }),
    )
    await waitFor(() => expect(navRowTitles()).toEqual(["New conversation"]))
    expect(container).toHaveTextContent("What would you like to ask?")

    // The in-flight replay resolving later is a harmless no-op — no zombie
    // transcript, no "no longer available" pane, sends stay usable.
    deferred.resolve(jsonRes(200, ALPHA_TRANSCRIPT))
    await act(async () => {})
    expect(messageTexts()).not.toContain("old answer")
    expect(container).not.toHaveTextContent("no longer available")
    expect(getTextarea()).toBeEnabled()
  })
})
