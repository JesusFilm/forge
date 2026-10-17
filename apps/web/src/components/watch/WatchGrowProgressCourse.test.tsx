// @vitest-environment jsdom
import {
  act,
  createElement,
  useLayoutEffect,
  useSyncExternalStore,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  LearningRequest,
  LearningResponse,
} from "@/lib/watch-learning-progress-client"
import type { WatchAccountSession } from "./use-watch-account-session"
import { createWatchLearningDraftStore } from "./watch-learning-drafts"
import {
  WatchGrowProgressCourse,
  createWatchGrowLearningClient,
} from "./WatchGrowProgressCourse"

let root: Root
let container: HTMLDivElement
const drafts = createWatchLearningDraftStore()

type Call = {
  request: LearningRequest
  resolve: (response: LearningResponse) => void
}
let calls: Call[]
const transport = vi.fn(
  (request: LearningRequest) =>
    new Promise<LearningResponse>((resolve) => {
      calls.push({ request, resolve })
    }),
)

function sessionStore(initial: WatchAccountSession) {
  let current = { session: initial, revalidating: false }
  const listeners = new Set<() => void>()
  const retry = vi.fn()
  return {
    retry,
    set(next: WatchAccountSession, revalidating = false) {
      current = { session: next, revalidating }
      act(() => listeners.forEach((listener) => listener()))
    },
    /** A focus re-read that has not answered yet. */
    revalidate() {
      this.set(current.session, true)
    },
    use() {
      const { session, revalidating } = useSyncExternalStore(
        (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        () => current,
      )
      return { session, retry, revalidating }
    },
  }
}

const KEY = {
  courseId: "beginning-with-jesus",
  contentVersion: "2026-10-17-v1",
} as const
function lesson(overrides: Record<string, unknown> = {}) {
  return {
    ...KEY,
    lessonId: "lesson-1",
    completedMovementIds: [],
    completedStepIds: [],
    completed: false,
    completedAt: null,
    resumeCardId: null,
    revision: 0,
    updatedAt: null,
    ...overrides,
  }
}

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
function text() {
  return container.textContent ?? ""
}
function button(label: string) {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((b) => b.textContent === label)
  if (!found) throw new Error(`No button ${label}: ${text()}`)
  return found
}
async function click(label: string) {
  await act(async () => button(label).click())
}
function mount(session: ReturnType<typeof sessionStore>) {
  const client = createWatchGrowLearningClient({ transport, drafts })
  act(() =>
    root.render(
      <WatchGrowProgressCourse
        client={client}
        useSession={session.use}
        drafts={drafts}
      />,
    ),
  )
  return client
}
async function answerRead(lessons: unknown[] = [], userId = "user-a") {
  const read = calls.at(-1)!
  expect(read.request.method).toBe("GET")
  await act(async () =>
    read.resolve({
      status: 200,
      body: { authenticated: true, userId, lessons },
    }),
  )
}
function firstCheckbox() {
  return container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
}

beforeEach(() => {
  calls = []
  transport.mockClear()
  drafts.clear()
  window.history.replaceState(null, "", "/watch?as=grow")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("anonymous visitor", () => {
  it("keeps progress unsaved on the page and asks for the real hosted sign-in only on request", async () => {
    mount(
      sessionStore({
        status: "signed-out",
        loginUrl: "/watch/api/auth/login?returnTo=%2Fwatch",
      }),
    )
    expect(text()).toContain("Progress is not saved to an account")
    await act(async () => firstCheckbox().click())
    expect(firstCheckbox().checked).toBe(true)
    expect(transport).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-testid="watch-grow-sign-in"]'),
    ).toBeNull()

    await click("Save progress to an account")
    expect(text()).toContain(
      "Checked steps and reflections in this tab are not carried over",
    )
    const href = container
      .querySelector('[data-testid="watch-grow-sign-in"]')!
      .getAttribute("href")!
    const login = new URL(href)
    expect(login.origin).toBe(window.location.origin)
    expect(login.pathname).toBe("/watch/api/auth/login")
    expect(login.searchParams.get("returnTo")).toBe(
      "/watch?as=grow&growLesson=lesson-1",
    )
    await click("Not now")
    expect(
      container.querySelector('[data-testid="watch-grow-sign-in"]'),
    ).toBeNull()
    expect(firstCheckbox().checked).toBe(true)
  })

  it("opens the story only on request, carries its card in the return address, and returns focus on close", async () => {
    mount(sessionStore({ status: "signed-out" }))
    expect(
      container.querySelector('[data-testid="watch-grow-story"]'),
    ).toBeNull()
    await click("Read as story")
    await settle(20)
    const story = container.querySelector<HTMLElement>(
      '[data-testid="watch-grow-story"]',
    )!
    expect(story.dataset.cardId).toBe("cover")
    await click("Next")
    const textarea = () =>
      container.querySelector<HTMLTextAreaElement>(
        '[data-testid="watch-grow-story"] textarea',
      )!
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!
    act(() => {
      setter.call(textarea(), "never-in-url")
      textarea().dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("Save progress to an account")
    const href = container
      .querySelector('[data-testid="watch-grow-sign-in"]')!
      .getAttribute("href")!
    expect(new URL(href).searchParams.get("returnTo")).toBe(
      "/watch?as=grow&growLesson=lesson-1&growCard=back-how",
    )
    expect(href).not.toContain("never-in-url")
    expect(transport).not.toHaveBeenCalled()

    await click("Back to lesson sheet")
    expect(document.activeElement).toBe(button("Read as story"))
    // The sheet shows the same browser-only draft.
    expect(
      container.querySelector<HTMLTextAreaElement>(
        '[data-step-id="back-how"] textarea',
      )!.value,
    ).toBe("never-in-url")
  })

  it("after a cancelled sign-in, reopens the same card, says nothing was saved, and clears the address", async () => {
    window.history.replaceState(
      null,
      "",
      "/watch?as=grow&growLesson=lesson-1&growCard=up-question-2&auth=failed&reason=access_denied",
    )
    mount(sessionStore({ status: "signed-out" }))
    await settle(20)
    expect(
      container.querySelector<HTMLElement>('[data-testid="watch-grow-story"]')!
        .dataset.cardId,
    ).toBe("up-question-2")
    expect(text()).toContain("Sign-in did not finish. Nothing was saved")
    expect(window.location.pathname + window.location.search).toBe(
      "/watch?as=grow",
    )
    expect(transport).not.toHaveBeenCalled()
  })
})

describe("signed-in visitor", () => {
  it("returns from sign-in to the same card unsaved and saves only on a fresh explicit request", async () => {
    window.history.replaceState(
      null,
      "",
      "/watch?growLesson=lesson-1&growCard=forward-retell",
    )
    mount(sessionStore({ status: "signed-in", user: { id: "user-a" } }))
    await answerRead()
    await settle(20)
    expect(
      container.querySelector<HTMLElement>('[data-testid="watch-grow-story"]')!
        .dataset.cardId,
    ).toBe("forward-retell")
    expect(text()).toContain("This lesson is not saved to your account yet")
    expect(calls).toHaveLength(1)

    await click("Save to your account")
    expect(calls[1]!.request).toMatchObject({
      method: "POST",
      body: { expectedRevision: 0, completed: false, completedStepIds: [] },
    })
    await act(async () =>
      calls[1]!.resolve({
        status: 200,
        body: { status: "saved", progress: lesson({ revision: 1 }) },
      }),
    )
    expect(text()).toContain("Saved to your account.")
  })

  it("saves explicit changes, shows failure without a false Saved label, and retries", async () => {
    mount(sessionStore({ status: "signed-in", user: { id: "user-a" } }))
    expect(text()).toContain("Loading your saved progress")
    await answerRead()
    await act(async () => firstCheckbox().click())
    expect(text()).toContain("Saving…")
    await act(async () =>
      calls[1]!.resolve({ status: 502, body: { error: "upstream" } }),
    )
    expect(text()).toContain("Not saved. The progress service had a problem.")
    expect(text()).not.toContain("Saved to your account")
    expect(firstCheckbox().checked).toBe(true)
    await click("Retry")
    await act(async () =>
      calls[2]!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: lesson({ completedStepIds: ["back-how"], revision: 1 }),
        },
      }),
    )
    expect(text()).toContain("Saved to your account.")
  })

  it("on conflict keeps this tab's changes and offers an explicit choice", async () => {
    mount(sessionStore({ status: "signed-in", user: { id: "user-a" } }))
    await answerRead([lesson({ revision: 2 })])
    await act(async () => firstCheckbox().click())
    await act(async () =>
      calls[1]!.resolve({
        status: 200,
        body: {
          status: "conflict",
          progress: lesson({ completedStepIds: ["up-watch"], revision: 3 }),
        },
      }),
    )
    expect(text()).toContain("This lesson changed in another tab or device")
    expect(firstCheckbox().checked).toBe(true)
    expect(calls).toHaveLength(2)
    await click("Use saved version")
    expect(firstCheckbox().checked).toBe(false)
    expect(
      container.querySelector<HTMLInputElement>(
        '[data-step-id="up-watch"] input[type="checkbox"]',
      )!.checked,
    ).toBe(true)
  })

  it("after closing and re-opening on a conflict, still waits for the visitor's choice", async () => {
    const client = mount(
      sessionStore({ status: "signed-in", user: { id: "user-a" } }),
    )
    await answerRead([lesson({ revision: 1 })])
    await act(async () => firstCheckbox().click())
    // Another device reset the lesson.
    await act(async () =>
      calls[1]!.resolve({
        status: 200,
        body: { status: "conflict", progress: lesson({ revision: 2 }) },
      }),
    )
    act(() => root.render(<div />))

    // Re-opening mounts a fresh session read that starts out checking.
    const reopened = sessionStore({ status: "checking" })
    act(() =>
      root.render(
        <WatchGrowProgressCourse
          client={client}
          useSession={reopened.use}
          drafts={drafts}
        />,
      ),
    )
    reopened.set({ status: "signed-in", user: { id: "user-a" } })
    await answerRead([lesson({ revision: 2 })])
    await settle()
    expect(calls.map((call) => call.request.method)).toEqual([
      "GET",
      "POST",
      "GET",
    ])
    expect(text()).toContain("This lesson changed in another tab or device")
    expect(firstCheckbox().checked).toBe(true)
  })

  it("holds writes while a focus re-read of the session is pending", async () => {
    const session = sessionStore({
      status: "signed-in",
      user: { id: "user-a" },
    })
    mount(session)
    await answerRead([lesson({ revision: 1 })])
    session.revalidate()
    await act(async () => firstCheckbox().click())
    expect(calls).toHaveLength(1)

    expect(text()).toContain("Saving…")
    expect(text()).not.toContain("Checking your account")

    // Same account confirmed: the held change is sent at the loaded revision,
    // with no second progress read (the revision guards newer progress).
    session.set({ status: "signed-in", user: { id: "user-a" } })
    expect(calls.map((call) => call.request.method)).toEqual(["GET", "POST"])
    expect(calls.at(-1)!.request).toMatchObject({
      method: "POST",
      subject: "user-a",
      body: { expectedRevision: 1, completedStepIds: ["back-how"] },
    })
  })

  it("keeps the last card read through a focus re-check and pagehide, then saves it for the same account", async () => {
    const session = sessionStore({
      status: "signed-in",
      user: { id: "user-a" },
    })
    mount(session)
    await answerRead([
      lesson({
        completedStepIds: ["back-how"],
        resumeCardId: "back-how",
        revision: 4,
      }),
    ])
    await click("Read as story")
    await settle(20)
    // Opening on the saved card changes nothing: still Saved.
    expect(text()).toContain("Saved to your account.")
    await click("Next")
    // The new card is not on the account yet, so nothing reads as Saved.
    expect(text()).toContain("Saving…")
    expect(text()).not.toContain("Saved to your account")
    session.revalidate()
    await settle(1700)
    act(() => window.dispatchEvent(new Event("pagehide")))
    expect(calls).toHaveLength(1)
    expect(text()).toContain("Saving…")
    expect(text()).not.toContain("Saved to your account")
    expect(text()).not.toContain("Checking your account")
    expect(text()).not.toContain("Loading your saved progress")

    session.set({ status: "signed-in", user: { id: "user-a" } })
    expect(calls.map((call) => call.request.method)).toEqual(["GET", "POST"])
    const resumed = calls[1]!
    expect(resumed.request).toMatchObject({
      subject: "user-a",
      body: {
        expectedRevision: 4,
        completedStepIds: ["back-how"],
        resumeCardId: expect.not.stringMatching(/^back-how$/),
      },
    })
    const cardId = (resumed.request as { body: { resumeCardId: string } }).body
      .resumeCardId
    await act(async () =>
      resumed.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: lesson({
            completedStepIds: ["back-how"],
            resumeCardId: cardId,
            revision: 5,
          }),
        },
      }),
    )
    expect(text()).toContain("Saved to your account.")
    expect(text()).not.toContain("Not saved yet")
  })

  it("keeps conflict choices mounted through a focus re-check of the same account", async () => {
    const session = sessionStore({
      status: "signed-in",
      user: { id: "user-a" },
    })
    mount(session)
    await answerRead([lesson({ revision: 2 })])
    await act(async () => firstCheckbox().click())
    await act(async () =>
      calls[1]!.resolve({
        status: 200,
        body: { status: "conflict", progress: lesson({ revision: 3 }) },
      }),
    )
    const keep = button("Keep my changes")
    session.revalidate()
    expect(button("Keep my changes")).toBe(keep)
    expect(button("Use saved version")).toBeTruthy()
    session.set({ status: "signed-in", user: { id: "user-a" } })
    expect(button("Keep my changes")).toBe(keep)
    expect(calls).toHaveLength(2)
  })

  it("drops a held change when the re-check reports another account", async () => {
    const session = sessionStore({
      status: "signed-in",
      user: { id: "user-a" },
    })
    mount(session)
    await answerRead([lesson({ revision: 1 })])
    session.revalidate()
    await act(async () => firstCheckbox().click())
    session.set({ status: "signed-in", user: { id: "user-b" } })
    await answerRead([], "user-b")
    await settle()
    expect(calls.map((call) => call.request.method)).toEqual(["GET", "GET"])
    expect(firstCheckbox().checked).toBe(false)
  })

  it("resumes a second device's saved position and flushes resume writes when the course closes", async () => {
    mount(sessionStore({ status: "signed-in", user: { id: "user-a" } }))
    await answerRead([
      lesson({
        completedStepIds: ["back-how"],
        resumeCardId: "up-retell",
        revision: 4,
      }),
    ])
    expect(firstCheckbox().checked).toBe(true)
    await click("Read as story")
    await settle(20)
    const story = () =>
      container.querySelector<HTMLElement>('[data-testid="watch-grow-story"]')!
    expect(story().dataset.cardId).toBe("up-retell")
    await click("Next")
    expect(calls).toHaveLength(1)
    act(() => root.unmount())
    root = createRoot(container)
    expect(calls[1]!.request).toMatchObject({
      method: "POST",
      keepalive: true,
      body: {
        expectedRevision: 4,
        resumeCardId: "up-question-1",
        completedStepIds: ["back-how"],
        completed: false,
      },
    })
  })

  it("on account switch drops the old account's progress and drafts and ignores its late answers", async () => {
    const session = sessionStore({
      status: "signed-in",
      user: { id: "user-a" },
    })
    mount(session)
    await answerRead([lesson({ completedStepIds: ["back-how"], revision: 1 })])
    act(() =>
      drafts.set(
        { ...KEY, lessonId: "lesson-1", stepId: "back-how" },
        "A's note",
      ),
    )
    await act(async () =>
      container
        .querySelector<HTMLInputElement>(
          '[data-step-id="back-carrying"] input[type="checkbox"]',
        )!
        .click(),
    )
    const late = calls.at(-1)!
    session.set({ status: "signed-in", user: { id: "user-b" } })
    expect(
      drafts.get({ ...KEY, lessonId: "lesson-1", stepId: "back-how" }),
    ).toBe("")
    expect(firstCheckbox().checked).toBe(false)
    await act(async () =>
      late.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: lesson({
            completedStepIds: ["back-how", "back-carrying"],
            revision: 2,
          }),
        },
      }),
    )
    await answerRead([], "user-b")
    expect(firstCheckbox().checked).toBe(false)
    session.set({ status: "signed-out" })
    expect(text()).toContain("Progress is not saved to an account")
  })
})

describe("WatchGrow integration", () => {
  it("acquires shared modal activity before the progress course module loads", async () => {
    vi.resetModules()
    const state = { active: false, atImport: [] as boolean[] }
    vi.doMock("./WatchGrowProgressCourse", () => {
      state.atImport.push(state.active)
      return {
        WatchGrowProgressCourse: () => <p>Progress course ready</p>,
      }
    })
    vi.doMock("next/image", () => ({
      default: ({ fill: _fill, ...props }: Record<string, unknown>) =>
        createElement("img", props),
    }))
    const { WatchGrow } = await import("./WatchGrow")
    const { WatchModalActivityProvider, useIsWatchModalActive } =
      await import("./WatchModalActivityProvider")
    function Activity() {
      const active = useIsWatchModalActive()
      useLayoutEffect(() => {
        state.active = active
      }, [active])
      return null
    }
    act(() =>
      root.render(
        <WatchModalActivityProvider>
          <Activity />
          <WatchGrow />
        </WatchModalActivityProvider>,
      ),
    )
    expect(state.atImport).toEqual([])
    const trigger = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Open the nine lessons",
    )!
    await act(async () => trigger.click())
    await settle(50)
    expect(state.atImport).toEqual([true])
    expect(document.body.textContent).toContain("Progress course ready")
    vi.doUnmock("./WatchGrowProgressCourse")
    vi.doUnmock("next/image")
  })
})
