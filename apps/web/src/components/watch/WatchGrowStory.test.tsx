// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { LESSONS, lessonCards } from "@/lib/beginning-with-jesus"
import { createWatchLearningDraftStore } from "./watch-learning-drafts"
import { WatchGrowStory, type WatchGrowStoryProps } from "./WatchGrowStory"

vi.mock("next/image", () => ({
  default: ({ fill: _fill, ...props }: Record<string, unknown>) =>
    createElement("img", props),
}))
vi.mock("next/dynamic", () => ({ default: () => () => null }))

let root: Root
let container: HTMLDivElement
const drafts = createWatchLearningDraftStore()
const lesson = LESSONS[0]!
const cards = lessonCards(lesson)
function render(props: Partial<WatchGrowStoryProps> = {}) {
  const base: WatchGrowStoryProps = {
    lesson,
    cards,
    progress: { completedStepIds: [], completed: false },
    onProgressChange: vi.fn(),
    drafts,
    session: {
      watched: 0,
      retold: false,
      countViewing: vi.fn(),
      markRetold: vi.fn(),
    },
    showSheet: vi.fn(),
    finish: vi.fn(),
    ...props,
  }
  act(() => root.render(<WatchGrowStory {...base} />))
  return base
}
const story = () =>
  document.querySelector<HTMLElement>('[data-testid="watch-grow-story"]')!
function next() {
  act(() =>
    story()
      .querySelector<HTMLButtonElement>(
        '[data-testid="watch-grow-story-next"]',
      )!
      .click(),
  )
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
  document.body.style.overflow = ""
})

it("covers the page as a full-screen story and walks the shared deck without completing anything", () => {
  const props = render({ onCardChange: vi.fn() })
  expect(story().parentElement).toBe(document.body)
  expect(story().className).toContain("fixed inset-0 z-[200]")
  expect(story().getAttribute("aria-modal")).toBe("true")
  expect(document.body.style.overflow).toBe("hidden")
  expect(story().dataset.cardId).toBe("cover")
  for (let i = 1; i < cards.length; i++) {
    next()
    expect(story().dataset.cardId).toBe(cards[i]!.id)
  }
  expect(props.onCardChange).toHaveBeenCalledTimes(cards.length - 1)
  expect(props.onProgressChange).not.toHaveBeenCalled()
})

it("opens on a resumed card and closes on Escape", () => {
  const props = render({ initialCardId: "up-question-2" })
  expect(story().dataset.cardId).toBe("up-question-2")
  act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  )
  expect(props.showSheet).toHaveBeenCalled()
})

it("writes answers to the memory-only drafts and shows no invented room", () => {
  render({ initialCardId: "up-question-1" })
  const field = story().querySelector<HTMLTextAreaElement>(
    '[data-testid="watch-grow-story-answer"]',
  )!
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(field, "My words")
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(
    drafts.get({
      courseId: "beginning-with-jesus",
      contentVersion: "2026-10-17-v1",
      lessonId: "lesson-1",
      stepId: "up-question-1",
    }),
  ).toBe("My words")
  expect(story().textContent).not.toMatch(/people from|countries sat/)
})

it("contains keyboard focus in the story and isolates the page behind it", () => {
  const page = document.createElement("button")
  page.textContent = "Page control"
  document.body.append(page)
  const props = render()
  expect(page.hasAttribute("inert")).toBe(true)
  expect(container.hasAttribute("inert")).toBe(true)
  expect(story().hasAttribute("inert")).toBe(false)
  expect(document.activeElement?.getAttribute("data-testid")).toBe(
    "watch-grow-story-close",
  )
  const stops = [
    ...story().querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
  ]
  const tab = (shiftKey = false) =>
    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true }),
      )
    })
  stops.at(-1)!.focus()
  tab()
  expect(document.activeElement).toBe(stops[0])
  tab(true)
  expect(document.activeElement).toBe(stops.at(-1))
  act(() => root.unmount())
  root = createRoot(container)
  expect(page.hasAttribute("inert")).toBe(false)
  expect(container.hasAttribute("inert")).toBe(false)
  expect(props.showSheet).not.toHaveBeenCalled()
  page.remove()
})

it.each([
  ["ar", "rtl"],
  ["es", "ltr"],
])(
  "keeps English portal content independent of a %s document",
  async (lang, dir) => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    try {
      render()
      const node = story()
      expect(node.parentElement).toBe(document.body)
      expect(node.getAttribute("lang")).toBe("en")
      expect(node.getAttribute("dir")).toBe("ltr")
      expect(node.getAttribute("aria-label")).toBe("Lesson 1 as a story")
      expect(
        node.querySelector("button")?.closest("[lang]")?.getAttribute("lang"),
      ).toBe("en")
    } finally {
      document.documentElement.removeAttribute("lang")
      document.documentElement.removeAttribute("dir")
    }
  },
)
