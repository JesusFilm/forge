// feat-366 U2: the whole-tree suggested-follow-up chip loop (split from
// app-shell.test.tsx so neither file crosses the 1k-line bar); the shared
// render harness lives in app-shell-test-harness.tsx.
import { screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { encodeSseFrame } from "@/lib/sse"

import {
  ALPHA,
  getLog,
  getTextarea,
  isPending,
  messageTexts,
  navRowTitles,
  renderSeeker,
  selectSidebarConversation,
  sendMessage,
  setupShellTest,
  teardownShellTest,
  user,
} from "./app-shell-test-harness"

beforeEach(() => {
  setupShellTest()
})

afterEach(() => {
  teardownShellTest()
})

// ===========================================================================
// feat-366 U2: the WHOLE-TREE chip loop. The unit suites pin Chat -> onSend
// and session -> seam separately; the one line joining them (`onSend={send}`
// in app-shell.tsx) is a production revert surface a wrapper like
// `onSend={(t) => send(t)}` would silently disarm with every other test
// still green — so it gets its own end-to-end assertion here.
// ===========================================================================

describe("Suggested follow-up chips, end to end (feat-366)", () => {
  const QUESTIONS = ["Why pray?", "Who wrote the gospels?"]

  function answerFrames(followUps?: string[]) {
    return [
      {
        event: "result",
        data: {
          text: "A grounded answer about prayer.",
          grounded: true,
          sources: [],
          ...(followUps ? { followUps } : {}),
        },
      },
    ]
  }

  function chipButtons(): HTMLButtonElement[] {
    const nav = screen.queryByRole("navigation", {
      name: "Suggested follow-up questions",
    })
    return nav
      ? Array.from(nav.querySelectorAll<HTMLButtonElement>("button"))
      : []
  }

  function seekerBodies(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls
      .filter((call) => String(call[0]) === "/api/seeker")
      .map(
        (call) =>
          JSON.parse(String((call[1] as RequestInit).body)) as {
            text: string
            promptSource?: string
          },
      )
  }

  it("renders chips from the terminal frame and sends a tap VERBATIM with promptSource", async () => {
    let turn = 0
    const fetchMock = renderSeeker(() =>
      turn++ === 0 ? answerFrames(QUESTIONS) : answerFrames(["Fresh one?"]),
    )
    await sendMessage("what is prayer?")
    await waitFor(() => expect(isPending()).toBe(false))
    expect(chipButtons().map((c) => c.textContent)).toEqual(QUESTIONS)

    await user.click(chipButtons()[0])
    await waitFor(() => expect(isPending()).toBe(false))

    const bodies = seekerBodies(fetchMock)
    expect(bodies).toHaveLength(2)
    // The typed send carries NO tag; the chip send carries exactly one, and
    // the question text crosses the wire verbatim (KD4).
    expect(bodies[0].promptSource).toBeUndefined()
    expect(bodies[1]).toMatchObject({
      text: "Why pray?",
      promptSource: "follow_up",
    })
    // The tap became the person's own message, and the new answer brought a
    // fresh chip set that replaced the old one.
    expect(messageTexts()).toContain("Why pray?")
    expect(chipButtons().map((c) => c.textContent)).toEqual(["Fresh one?"])
  })

  it("shows no chips while the reply to a tap is still streaming", async () => {
    let turn = 0
    renderSeeker(() => (turn++ === 0 ? answerFrames(QUESTIONS) : []))
    await sendMessage("what is prayer?")
    await waitFor(() => expect(isPending()).toBe(false))
    await user.click(chipButtons()[0])
    // The seam is mid-flight: the old answer is no longer last, and the new
    // one has not finalized.
    expect(chipButtons()).toEqual([])
  })

  it("moves focus to the conversation log on the tap, then back to the composer at finalize", async () => {
    renderSeeker(() => answerFrames(QUESTIONS))
    await sendMessage("what is prayer?")
    await waitFor(() => expect(isPending()).toBe(false))

    // A DISCRIMINATING fixture for moment one: every other seeker response in
    // this suite resolves instantly, so the reply would already have
    // finalized (and the composer taken focus back) before the click await
    // returns — the pending window would be unobservable. This SSE body never
    // closes, so the tap's reply genuinely stays in flight.
    let releaseHang: () => void = () => {}
    const hangingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        releaseHang = () => {
          controller.enqueue(
            new TextEncoder().encode(
              encodeSseFrame("result", {
                text: "A second grounded answer.",
                grounded: true,
                sources: [],
              }),
            ),
          )
          controller.close()
        }
      },
    })
    const hangingFetch = vi.fn().mockImplementation((url: unknown) => {
      if (String(url) !== "/api/seeker") return Promise.reject(new Error("n/a"))
      return Promise.resolve(new Response(hangingBody, { status: 200 }))
    })
    vi.stubGlobal("fetch", hangingFetch)

    await user.click(chipButtons()[0])
    expect(isPending()).toBe(true)
    expect(getTextarea()).toBeDisabled()
    expect(document.activeElement).toBe(getLog())

    // Finalize: the composer's not-pending effect takes focus back.
    releaseHang()
    await waitFor(() => expect(isPending()).toBe(false))
    await waitFor(() => expect(document.activeElement).toBe(getTextarea()))
  })

  it("renders NO chips on a turn whose frame carried none", async () => {
    renderSeeker(() => answerFrames())
    await sendMessage("what is prayer?")
    await waitFor(() => expect(isPending()).toBe(false))
    expect(chipButtons()).toEqual([])
  })

  it("replays the stored chips on the last turn of a reopened thread (AE3)", async () => {
    const fetchMock = renderSeeker(() => answerFrames(["Fresh one?"]), {
      listFor: () => ({ threads: [ALPHA] }),
      threadFor: () => ({
        messages: [
          {
            id: "m1",
            role: "user",
            text: "what is prayer?",
            createdAt: "2026-07-12T08:00:00.000Z",
          },
          {
            id: "m2",
            role: "assistant",
            text: "A grounded answer about prayer.",
            createdAt: "2026-07-12T08:00:01.000Z",
            followUps: QUESTIONS,
          },
        ],
      }),
    })
    await waitFor(() => expect(navRowTitles()).toContain(ALPHA.title))
    await selectSidebarConversation(ALPHA.title)
    await waitFor(() =>
      expect(messageTexts()).toContain("A grounded answer about prayer."),
    )
    // Same chips, enabled, on the replayed last turn.
    expect(chipButtons().map((c) => c.textContent)).toEqual(QUESTIONS)
    for (const button of chipButtons()) expect(button).toBeEnabled()

    // And a replayed chip still sends, tagged.
    await user.click(chipButtons()[1])
    await waitFor(() => expect(isPending()).toBe(false))
    expect(seekerBodies(fetchMock).at(-1)).toMatchObject({
      text: "Who wrote the gospels?",
      promptSource: "follow_up",
    })
  })
})
