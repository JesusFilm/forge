// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LESSONS } from "@/lib/beginning-with-jesus"
import { createWatchLearningDraftStore } from "./watch-learning-drafts"
import { WatchGrowCourse, type WatchGrowCourseProps } from "./WatchGrowCourse"

let root: Root
let container: HTMLDivElement
const drafts = createWatchLearningDraftStore()
const fetchMock = vi.fn()
function render(props: WatchGrowCourseProps = {}) {
  act(() => root.render(<WatchGrowCourse drafts={drafts} {...props} />))
}
function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === label,
  )!
}
function click(label: string) {
  act(() => button(label).click())
}
beforeEach(() => {
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

describe("accessible nine-lesson sheet", () => {
  it("opens anonymously, explains the benefit first, and navigates all nine without completion", () => {
    const changed = vi.fn()
    render({ onProgressChange: changed })
    expect(container.textContent).toContain(LESSONS[0]!.why.promise)
    expect(container.textContent).toContain("Only in this browser session")
    expect(container.textContent).toContain(
      "Progress is not saved to an account",
    )
    expect(container.textContent).toContain("Watch adaptation")
    for (let index = 0; index < 9; index++) {
      expect(
        container
          .querySelector("[data-lesson-id]")
          ?.getAttribute("data-lesson-id"),
      ).toBe(`lesson-${index + 1}`)
      expect(container.textContent).toContain(LESSONS[index]!.questions[0])
      expect(container.textContent).toContain("Looking Back")
      expect(container.textContent).toContain("Looking Up")
      expect(container.textContent).toContain("Looking Forward")
      expect(
        container.querySelectorAll('input[type="checkbox"]:checked'),
      ).toHaveLength(0)
      if (index < 8) click("Next lesson")
    }
    expect(button("Next lesson").disabled).toBe(true)
    expect(changed).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("completes only by explicit controls, separately from reflection or navigation", () => {
    const changed = vi.fn()
    render({ onProgressChange: changed })
    const first = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!
    act(() => first.click())
    expect(changed.mock.calls[0]?.[0]).toEqual({
      courseId: "beginning-with-jesus",
      contentVersion: "2026-10-17-v1",
      lessonId: "lesson-1",
      progress: { completedStepIds: ["back-how"], completed: false },
    })
    click("Mark lesson complete")
    expect(changed.mock.lastCall?.[0].progress.completed).toBe(true)
    click("Next lesson")
    expect(container.textContent).toContain("Mark lesson complete")
    click("Previous lesson")
    expect(container.textContent).toContain("Mark lesson incomplete")
    expect(first.checked).toBe(true)
    expect(JSON.stringify(changed.mock.calls)).not.toContain("reflection")
  })

  it("shares private reflection edits with the story slot and survives switching views", () => {
    const story = vi.fn(
      ({
        drafts: store,
        showSheet,
      }: Parameters<NonNullable<WatchGrowCourseProps["renderStory"]>>[0]) => (
        <>
          <p>
            {store.get({
              courseId: "beginning-with-jesus",
              contentVersion: "2026-10-17-v1",
              lessonId: "lesson-1",
              stepId: "back-how",
            })}
          </p>
          <button onClick={showSheet}>Return to sheet</button>
        </>
      ),
    )
    render({ renderStory: story })
    const field = container.querySelector<HTMLTextAreaElement>("textarea")!
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(field, "Private words")
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
    click("Read as story")
    expect(container.textContent).toContain("Private words")
    click("Return to sheet")
    expect(container.querySelector("textarea")?.value).toBe("Private words")
    click("Clear reflections")
    expect(container.querySelector("textarea")?.value).toBe("")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
