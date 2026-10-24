// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LESSONS, chapterHref, lessonCards } from "@/lib/beginning-with-jesus"
import { createWatchLearningDraftStore } from "./watch-learning-drafts"
import { WatchGrowLessonSheet } from "./WatchGrowCourse"
import { WatchGrowStory, type WatchGrowStoryProps } from "./WatchGrowStory"

const lesson = LESSONS[0]!
const cards = lessonCards(lesson)
let root: Root
let container: HTMLDivElement
const drafts = createWatchLearningDraftStore()

function render(props: Partial<WatchGrowStoryProps> = {}) {
  const all: WatchGrowStoryProps = {
    lesson,
    cards,
    progress: { completedStepIds: [], completed: false },
    onProgressChange: vi.fn(),
    drafts,
    showSheet: vi.fn(),
    ...props,
  }
  act(() =>
    root.render(
      <div role="dialog">
        <WatchGrowStory {...all} />
        <input aria-label="outside-typing" />
      </div>,
    ),
  )
  return all
}
function story() {
  return container.querySelector<HTMLElement>(
    '[data-testid="watch-grow-story"]',
  )!
}
function key(target: Element, value: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true }),
    )
  })
}
function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === label,
  )!
}

beforeEach(() => {
  drafts.clear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("lesson-1 story", () => {
  it("opens on the benefit, reaches all 26 cards, and the last card alone completes nothing", () => {
    const visited: string[] = []
    const props = render({ onCardChange: (id) => visited.push(id) })
    expect(cards).toHaveLength(26)
    expect(story().dataset.cardId).toBe("cover")
    expect(story().textContent).toContain(`Start here if ${lesson.why.ifYou}`)
    expect(story().textContent).toContain(lesson.why.promise)
    expect(story().textContent).toContain("Card 1 of 26")
    // Focus starts on the card heading, inside the dialog.
    expect(document.activeElement?.tagName).toBe("H4")

    for (let index = 1; index < 26; index++) {
      key(document.activeElement ?? story(), "ArrowRight")
      expect(story().dataset.cardIndex).toBe(String(index))
    }
    key(document.activeElement!, "ArrowRight")
    expect(story().dataset.cardId).toBe("end")
    expect(visited).toEqual(cards.slice(1).map((card) => card.id))
    expect(story().textContent).toContain(
      "Reaching the last card does not complete the lesson",
    )
    expect(story().textContent).toContain("Lesson not marked complete.")
    expect(button("Next").disabled).toBe(true)
    expect(props.onProgressChange).not.toHaveBeenCalled()

    key(document.activeElement!, "Home")
    expect(story().dataset.cardId).toBe("cover")
    key(document.activeElement!, "End")
    expect(story().dataset.cardId).toBe("end")
    key(document.activeElement!, "ArrowLeft")
    expect(story().dataset.cardId).toBe("forward-for-them")
  })

  it("keeps the buttons focused while moving, and keyboard moves land on the heading", () => {
    render()
    act(() => button("Next").focus())
    act(() => button("Next").click())
    expect(story().dataset.cardId).toBe("back-how")
    expect(document.activeElement).toBe(button("Next"))
    act(() => button("Previous").click())
    // The first card disables Previous, so focus moves to the heading.
    expect(document.activeElement?.tagName).toBe("H4")
  })

  it("handles navigation before the enclosing dialog stops key propagation", () => {
    render()
    const dialog = container.querySelector('[role="dialog"]')!
    dialog.addEventListener("keydown", (event) => event.stopPropagation())
    key(document.activeElement!, "ArrowRight")
    expect(story().dataset.cardId).toBe("back-how")
  })

  it("does not intercept arrows while typing a reflection or a field outside the story", () => {
    render({ initialCardId: "back-how" })
    const textarea = story().querySelector("textarea")!
    act(() => textarea.focus())
    key(textarea, "ArrowRight")
    key(textarea, "Home")
    expect(story().dataset.cardId).toBe("back-how")
    const outside = container.querySelector(
      'input[aria-label="outside-typing"]',
    )!
    key(outside, "ArrowRight")
    expect(story().dataset.cardId).toBe("back-how")
    key(document.body, "ArrowRight")
    expect(story().dataset.cardId).toBe("back-how")
  })

  it("shares reflection drafts with the sheet and sends only structured progress", () => {
    const onProgressChange = vi.fn()
    render({ initialCardId: "back-how", onProgressChange })
    const textarea = story().querySelector("textarea")!
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!
    act(() => {
      setter.call(textarea, "A private thought")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(story().textContent).toContain("Only in this browser session")

    act(() =>
      root.render(
        <WatchGrowLessonSheet
          lesson={lesson}
          cards={cards}
          progress={{ completedStepIds: [], completed: false }}
          onProgressChange={onProgressChange}
          drafts={drafts}
        />,
      ),
    )
    const sheetDraft = container.querySelector<HTMLTextAreaElement>(
      '[data-step-id="back-how"] textarea',
    )!
    expect(sheetDraft.value).toBe("A private thought")
    expect(onProgressChange).not.toHaveBeenCalled()
  })

  it("completes steps and the lesson only through their explicit controls", () => {
    const onProgressChange = vi.fn()
    render({ initialCardId: "up-question-2", onProgressChange })
    const checkbox = story().querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!
    act(() => checkbox.click())
    expect(onProgressChange).toHaveBeenLastCalledWith({
      completedStepIds: ["up-question-2"],
      completed: false,
    })
    key(document.body.querySelector("h4")!, "End")
    act(() => button("Mark lesson complete").click())
    expect(onProgressChange).toHaveBeenLastCalledWith({
      completedStepIds: [],
      completed: true,
    })
    expect(JSON.stringify(onProgressChange.mock.calls)).not.toMatch(/thought/)
  })

  it("links the watch card to the canonical chapter and returns to the sheet", () => {
    const props = render({ initialCardId: "up-watch" })
    const link = story().querySelector("a")!
    expect(link.getAttribute("href")).toBe(chapterHref(lesson.slug))
    expect(link.textContent).toBe(`Watch ${lesson.segment}`)
    act(() => button("Back to lesson sheet").click())
    expect(props.showSheet).toHaveBeenCalledTimes(1)
  })

  it("starts at the cover for an unknown resume card and animates only without reduced motion", () => {
    render({ initialCardId: "retired-card" })
    expect(story().dataset.cardId).toBe("cover")
    const animated = story().querySelector('[class*="animate-in"]')!
    for (const token of animated.className.split(/\s+/)) {
      if (/animate-in|fade-in|slide-in/.test(token))
        expect(token.startsWith("motion-safe:")).toBe(true)
    }
    expect(story().className).toContain("min-w-0")
  })
})
