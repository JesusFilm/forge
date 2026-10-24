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
import { LESSONS } from "@/lib/beginning-with-jesus"
import type { WatchAccountSession } from "./use-watch-account-session"
import { movementStepIds } from "./watch-grow-prototype-adapter"
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
// The first lazy import can outlast a timer when other test files transform.
// Await the rendered story; product mount budgets are verified separately.
async function waitForStory() {
  await vi.waitFor(async () => {
    await settle()
    expect(
      document.querySelector('[data-testid="watch-grow-story"]'),
    ).not.toBeNull()
  })
}
function text() {
  return container.textContent ?? ""
}
function button(label: string) {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
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
// The original sheet has no per-step boxes: each third's Finish control
// checks that third's steps, and the third reads "Done" once they all are.
const BACK = movementStepIds(LESSONS[0]!, "back")
const UP = movementStepIds(LESSONS[0]!, "up")
async function storyNext() {
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>(
        '[data-testid="watch-grow-story-next"]',
      )!
      .click(),
  )
}
async function openLessonOne() {
  if (container.querySelector('[data-testid="watch-grow-course-sheet"]')) return
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[data-testid="watch-grow-course-start"]',
      )!
      .click(),
  )
}
async function finish(third: "back" | "up" | "forward") {
  await openLessonOne()
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        `[data-testid="watch-grow-course-third-${third}"]`,
      )!
      .click(),
  )
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[data-testid="watch-grow-course-advance"]',
      )!
      .click(),
  )
}
async function thirdDone(third: "back" | "up" | "forward") {
  await openLessonOne()
  return (
    container.querySelector(`[data-testid="watch-grow-course-third-${third}"]`)!
      .textContent ?? ""
  ).includes("Done")
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
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
    await finish("back")
    expect(await thirdDone("back")).toBe(true)
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
    expect(await thirdDone("back")).toBe(true)
  })

  it("opens the story only on request, carries its card in the return address, and returns focus on close", async () => {
    mount(sessionStore({ status: "signed-out" }))
    expect(
      document.querySelector('[data-testid="watch-grow-story"]'),
    ).toBeNull()
    await openLessonOne()
    await click("Play it, one card at a time")
    await waitForStory()
    // The story is portalled to the body, over the page.
    const story = () =>
      document.querySelector<HTMLElement>('[data-testid="watch-grow-story"]')!
    expect(story().dataset.cardId).toBe("cover")
    await storyNext()
    const option = story().querySelector<HTMLButtonElement>(
      '[data-testid="watch-grow-story-poll-option"]',
    )!
    const chosen = option.textContent!
    await act(async () => option.click())
    await click("Save progress to an account")
    const href = container
      .querySelector('[data-testid="watch-grow-sign-in"]')!
      .getAttribute("href")!
    expect(new URL(href).searchParams.get("returnTo")).toBe(
      "/watch?as=grow&growLesson=lesson-1&growCard=back-how",
    )
    expect(href).not.toContain(encodeURIComponent(chosen))
    expect(transport).not.toHaveBeenCalled()

    await act(async () =>
      story()
        .querySelector<HTMLButtonElement>(
          '[data-testid="watch-grow-story-close"]',
        )!
        .click(),
    )
    expect(
      document.querySelector('[data-testid="watch-grow-story"]'),
    ).toBeNull()
    expect(document.activeElement).toBe(button("Play it, one card at a time"))
    // The sheet shows the same browser-only draft.
    const chip = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="watch-grow-course-chip"]',
      ),
    ].find((b) => b.textContent === chosen)!
    expect(chip.getAttribute("aria-pressed")).toBe("true")
  })

  it("after a cancelled sign-in, reopens the same card, says nothing was saved, and clears the address", async () => {
    window.history.replaceState(
      null,
      "",
      "/watch?as=grow&growLesson=lesson-1&growCard=up-question-2&auth=failed&reason=access_denied",
    )
    mount(sessionStore({ status: "signed-out" }))
    await waitForStory()
    expect(
      document.querySelector<HTMLElement>('[data-testid="watch-grow-story"]')!
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
    await waitForStory()
    expect(
      document.querySelector<HTMLElement>('[data-testid="watch-grow-story"]')!
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
    await finish("back")
    expect(text()).toContain("Saving…")
    await act(async () =>
      calls[1]!.resolve({ status: 502, body: { error: "upstream" } }),
    )
    expect(text()).toContain("Not saved. The progress service had a problem.")
    expect(text()).not.toContain("Saved to your account")
    expect(await thirdDone("back")).toBe(true)
    await click("Retry")
    await act(async () =>
      calls[2]!.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: lesson({ completedStepIds: BACK, revision: 1 }),
        },
      }),
    )
    expect(text()).toContain("Saved to your account.")
  })

  it("on conflict keeps this tab's changes and offers an explicit choice", async () => {
    mount(sessionStore({ status: "signed-in", user: { id: "user-a" } }))
    await answerRead([lesson({ revision: 2 })])
    await finish("back")
    await act(async () =>
      calls[1]!.resolve({
        status: 200,
        body: {
          status: "conflict",
          progress: lesson({ completedStepIds: UP, revision: 3 }),
        },
      }),
    )
    expect(text()).toContain("This lesson changed in another tab or device")
    expect(await thirdDone("back")).toBe(true)
    expect(calls).toHaveLength(2)
    await click("Use saved version")
    expect(await thirdDone("back")).toBe(false)
    expect(await thirdDone("up")).toBe(true)
  })

  it("after closing and re-opening on a conflict, still waits for the visitor's choice", async () => {
    const client = mount(
      sessionStore({ status: "signed-in", user: { id: "user-a" } }),
    )
    await answerRead([lesson({ revision: 1 })])
    await finish("back")
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
    expect(await thirdDone("back")).toBe(true)
  })

  it("holds writes while a focus re-read of the session is pending", async () => {
    const session = sessionStore({
      status: "signed-in",
      user: { id: "user-a" },
    })
    mount(session)
    await answerRead([lesson({ revision: 1 })])
    session.revalidate()
    await finish("back")
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
      body: { expectedRevision: 1, completedStepIds: BACK },
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
        completedStepIds: BACK,
        resumeCardId: "back-how",
        revision: 4,
      }),
    ])
    await openLessonOne()
    await click("Play it, one card at a time")
    await waitForStory()
    // Opening on the saved card changes nothing: still Saved.
    expect(text()).toContain("Saved to your account.")
    await storyNext()
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
        completedStepIds: BACK,
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
            completedStepIds: BACK,
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
    await finish("back")
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
    await finish("back")
    session.set({ status: "signed-in", user: { id: "user-b" } })
    await answerRead([], "user-b")
    await settle()
    expect(calls.map((call) => call.request.method)).toEqual(["GET", "GET"])
    expect(await thirdDone("back")).toBe(false)
  })

  it("resumes a second device's saved position and flushes resume writes when the course closes", async () => {
    mount(sessionStore({ status: "signed-in", user: { id: "user-a" } }))
    await answerRead([
      lesson({
        completedStepIds: BACK,
        resumeCardId: "up-retell",
        revision: 4,
      }),
    ])
    expect(await thirdDone("back")).toBe(true)
    await openLessonOne()
    await click("Play it, one card at a time")
    await waitForStory()
    const story = () =>
      document.querySelector<HTMLElement>('[data-testid="watch-grow-story"]')!
    expect(story().dataset.cardId).toBe("up-retell")
    await storyNext()
    expect(calls).toHaveLength(1)
    act(() => root.unmount())
    root = createRoot(container)
    expect(calls[1]!.request).toMatchObject({
      method: "POST",
      keepalive: true,
      body: {
        expectedRevision: 4,
        resumeCardId: "up-question-1",
        completedStepIds: BACK,
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
    await answerRead([lesson({ completedStepIds: BACK, revision: 1 })])
    act(() =>
      drafts.set(
        { ...KEY, lessonId: "lesson-1", stepId: "back-how" },
        "A's note",
      ),
    )
    await finish("up")
    const late = calls.at(-1)!
    session.set({ status: "signed-in", user: { id: "user-b" } })
    expect(
      drafts.get({ ...KEY, lessonId: "lesson-1", stepId: "back-how" }),
    ).toBe("")
    expect(await thirdDone("back")).toBe(false)
    await act(async () =>
      late.resolve({
        status: 200,
        body: {
          status: "saved",
          progress: lesson({
            completedStepIds: [...BACK, ...UP],
            revision: 2,
          }),
        },
      }),
    )
    await answerRead([], "user-b")
    expect(await thirdDone("back")).toBe(false)
    session.set({ status: "signed-out" })
    expect(text()).toContain("Progress is not saved to an account")
  })
})

describe("identity change", () => {
  function type(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!
    act(() => {
      setter.call(el, value)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  function blur(el: Element) {
    act(() => {
      el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    })
  }
  const field = (id: string) =>
    container.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!
  async function fillPrivateInputs() {
    await openLessonOne()
    // Looking Back: a name typed but not added.
    type(field("watch-grow-course-person"), "Alice draft name")
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="watch-grow-course-third-forward"]',
        )!
        .click(),
    )
    // Looking Forward: the name to tell (committed) and a written commitment
    // left uncommitted in its input.
    type(field("watch-grow-course-tell"), "Alice private contact")
    blur(field("watch-grow-course-tell"))
    const commit = field("watch-grow-course-line")
    type(commit, "Alice uncommitted words")
    return commit
  }

  it("on a confirmed switch to another account, clears every private input and fences stale writes", async () => {
    const session = sessionStore({
      status: "signed-in",
      user: { id: "user-a" },
    })
    mount(session)
    await answerRead()
    const staleCommit = await fillPrivateInputs()

    session.set({ status: "signed-in", user: { id: "user-b" } })
    await answerRead([], "user-b")
    // The old input's late blur cannot carry A's words into B's store.
    blur(staleCommit)
    await openLessonOne()

    const inputs = [
      ...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea",
      ),
    ]
    expect(inputs.map((el) => el.value).join("")).not.toContain("Alice")
    expect(text()).not.toContain("Alice")
    for (const stepId of ["forward-differently", "forward-tell"])
      expect(drafts.get({ ...KEY, lessonId: "lesson-1", stepId })).toBe("")
  })

  it("keeps the same visitor's inputs through a focus re-check", async () => {
    const session = sessionStore({
      status: "signed-in",
      user: { id: "user-a" },
    })
    mount(session)
    await answerRead()
    await fillPrivateInputs()
    session.revalidate()
    session.set({ status: "signed-in", user: { id: "user-a" } })
    await settle()
    expect(field("watch-grow-course-tell").value).toBe("Alice private contact")
    expect(field("watch-grow-course-line").value).toBe(
      "Alice uncommitted words",
    )
  })
})

describe("WatchGrow integration", () => {
  it("loads the progress course only on the long shelf", async () => {
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
    await settle(50)
    // The short shape never loads the course.
    expect(state.atImport).toEqual([])
    act(() => root.unmount())
    root = createRoot(container)
    window.history.replaceState(null, "", "/watch?as=grow&grow=full")
    act(() =>
      root.render(
        <WatchModalActivityProvider>
          <Activity />
          <WatchGrow />
        </WatchModalActivityProvider>,
      ),
    )
    await settle(50)
    expect(state.atImport).toEqual([false])
    expect(document.body.textContent).toContain("Progress course ready")
    vi.doUnmock("./WatchGrowProgressCourse")
    vi.doUnmock("next/image")
  })
})
