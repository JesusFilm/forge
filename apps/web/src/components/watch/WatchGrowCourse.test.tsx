// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LESSONS } from "@/lib/beginning-with-jesus"
import { movementStepIds } from "./watch-grow-prototype-adapter"
import { createWatchLearningDraftStore } from "./watch-learning-drafts"
import { WatchGrowCourse, type WatchGrowCourseProps } from "./WatchGrowCourse"

vi.mock("next/image", () => ({
  default: ({ fill: _fill, ...props }: Record<string, unknown>) =>
    createElement("img", props),
}))

let root: Root
let container: HTMLDivElement
const drafts = createWatchLearningDraftStore()
const fetchMock = vi.fn()
function render(props: WatchGrowCourseProps = {}) {
  act(() => root.render(<WatchGrowCourse drafts={drafts} {...props} />))
}
const q = <T extends Element = HTMLElement>(id: string) =>
  container.querySelector<T & HTMLElement>(`[data-testid="${id}"]`)
function clickId(id: string) {
  act(() => q(id)!.click())
}
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  drafts.clear()
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockClear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("the original nine-lesson block", () => {
  it("uses one native radio group and preserves selection through progress rerenders without writes", () => {
    render()
    const radios = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ]
    expect(radios).toHaveLength(3)
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1)
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false])
    act(() => radios[1]!.click())
    render({ progressStatus: <p>Still unsaved</p> })
    expect(radios.map((radio) => radio.checked)).toEqual([false, true, false])
    expect(radios[1]!.labels?.[0]?.textContent).toContain("In a group")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows the cover, nine lesson cards and honest unsaved status without completing anything", () => {
    const changed = vi.fn()
    render({ onProgressChange: changed })
    expect(container.textContent).toContain("Beginning With Jesus")
    expect(container.textContent).toContain("Three is the turn.")
    expect(container.textContent).toContain(
      "Progress is not saved to an account",
    )
    expect(
      container.querySelectorAll('[data-testid="watch-grow-course-card"]'),
    ).toHaveLength(9)
    // Opening each lesson is navigation only.
    for (const card of container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="watch-grow-course-card"]',
    ))
      act(() => card.click())
    expect(q("watch-grow-course-sheet")!.dataset.lesson).toBe("9")
    expect(changed).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("completes a third only through its Finish control, with the real step ids", () => {
    const changed = vi.fn()
    render({ onProgressChange: changed })
    clickId("watch-grow-course-start")
    // Typing an answer is a reflection, not completion.
    const chip = q<HTMLButtonElement>("watch-grow-course-chip")!
    act(() => chip.click())
    expect(changed).not.toHaveBeenCalled()
    clickId("watch-grow-course-advance")
    expect(changed.mock.calls[0]?.[0]).toEqual({
      courseId: "beginning-with-jesus",
      contentVersion: "2026-10-17-v1",
      lessonId: "lesson-1",
      progress: {
        completedStepIds: movementStepIds(LESSONS[0]!, "back"),
        completed: false,
      },
    })
    expect(q("watch-grow-course-third-back")!.textContent).toContain("Done")
    expect(q("watch-grow-course-sheet")!.dataset.third).toBe("up")
    expect(JSON.stringify(changed.mock.calls)).not.toContain(chip.textContent)
  })

  it("finishing Looking Forward completes the lesson", () => {
    const changed = vi.fn()
    render({ onProgressChange: changed })
    clickId("watch-grow-course-start")
    clickId("watch-grow-course-third-forward")
    clickId("watch-grow-course-advance")
    expect(changed.mock.lastCall?.[0].progress.completed).toBe(true)
  })

  it("keeps answers in the memory-only draft store under the shared card ids", () => {
    render()
    clickId("watch-grow-course-start")
    act(() => q<HTMLButtonElement>("watch-grow-course-chip")!.click())
    expect(
      drafts.get({
        courseId: "beginning-with-jesus",
        contentVersion: "2026-10-17-v1",
        lessonId: "lesson-1",
        stepId: "back-how",
      }),
    ).toBe(q("watch-grow-course-chip")!.textContent)
  })

  it("shows group joining as unavailable rather than a mock group", () => {
    render()
    clickId("watch-grow-course-mode-joining")
    const panel = q("watch-grow-course-group")!
    expect(panel.dataset.available).toBe("false")
    expect(panel.textContent).toContain("not available")
    expect(panel.querySelector("input, select")).toBeNull()
  })

  it("hands the story the lesson context and restores focus when it closes", () => {
    const story = vi.fn(
      (
        context: Parameters<
          NonNullable<WatchGrowCourseProps["renderStory"]>
        >[0],
      ) => (
        <button type="button" onClick={context.showSheet}>
          Return to sheet
        </button>
      ),
    )
    render({ renderStory: story })
    clickId("watch-grow-course-start")
    const play = q<HTMLButtonElement>("watch-grow-course-play-story")!
    act(() => play.click())
    expect(story.mock.lastCall?.[0].cards[0]?.id).toBe("cover")
    const back = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Return to sheet",
    )!
    act(() => back.click())
    expect(document.activeElement).toBe(q("watch-grow-course-play-story"))
  })
})

describe("committed lesson scrolling", () => {
  let laterPlan: HTMLAnchorElement
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    )
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    )
    laterPlan = document.createElement("a")
    laterPlan.href = "#reading-plan-7"
    laterPlan.textContent = "Seventh reading plan"
    document.body.append(laterPlan)
  })
  afterEach(() => {
    act(() => root.render(null))
    laterPlan.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
  })
  const flushScroll = () => act(() => vi.advanceTimersByTime(100))
  const closeLesson = () =>
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close the lesson"]',
        )!
        .click(),
    )
  const open = () => {
    const start = q<HTMLButtonElement>("watch-grow-course-start")!
    start.focus()
    act(() => start.click())
  }

  it("never scrolls an empty wrapper after open/close and later keyboard focus", () => {
    render()
    open()
    closeLesson()
    laterPlan.focus()
    flushScroll()
    expect(q("watch-grow-course-sheet")).toBeNull()
    expect(document.activeElement).toBe(laterPlan)
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it("scrolls the still-active committed lesson exactly once across rerenders", () => {
    render()
    open()
    const wrapper = q("watch-grow-course-sheet")!.parentElement
    render({ progressStatus: <p>Refreshed status</p> })
    flushScroll()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      behavior: "smooth",
      block: "start",
    })
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.instances).toEqual([
      wrapper,
    ])
    flushScroll()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it("only scrolls the newest lesson when A is replaced by B", () => {
    render()
    open()
    const cards = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="watch-grow-course-card"]',
    )
    cards[1]!.focus()
    act(() => cards[1]!.click())
    flushScroll()
    expect(q("watch-grow-course-sheet")!.dataset.lesson).toBe("2")
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it("coalesces repeated opens of the same lesson", () => {
    render()
    open()
    open()
    open()
    flushScroll()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it("invalidates scrolling after repeated toggles and unmount", () => {
    render()
    for (let i = 0; i < 5; i++) {
      open()
      closeLesson()
    }
    open()
    act(() => root.render(null))
    flushScroll()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it("yields to a newer focus even while the lesson remains open", () => {
    render()
    open()
    laterPlan.focus()
    flushScroll()
    expect(q("watch-grow-course-sheet")).not.toBeNull()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it("does not revive canceled work when focus returns to the opener", () => {
    render()
    open()
    laterPlan.focus()
    q<HTMLButtonElement>("watch-grow-course-start")!.focus()
    flushScroll()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  for (const event of ["popstate", "hashchange", "pagehide"]) {
    it(`cancels pending scrolling on ${event} navigation`, () => {
      render()
      open()
      window.dispatchEvent(new Event(event))
      flushScroll()
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    })
  }

  it("cancels a pending scroll when a link starts soft navigation", () => {
    render()
    open()
    laterPlan.addEventListener("click", (event) => event.preventDefault())
    laterPlan.click()
    flushScroll()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it("does not add an automatic scroll to direct lesson returns", () => {
    render({ initialOpen: true })
    flushScroll()
    expect(q("watch-grow-course-sheet")).not.toBeNull()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it("respects reduced motion for an active lesson", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    render()
    open()
    flushScroll()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      behavior: "instant",
      block: "start",
    })
  })
})
