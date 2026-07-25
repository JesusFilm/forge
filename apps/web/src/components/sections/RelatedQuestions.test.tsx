/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { RelatedQuestions } from "@/components/sections/RelatedQuestions"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function makeData(): Parameters<typeof RelatedQuestions>[0]["data"] {
  return {
    id: "faq-1",
    sectionKey: "faq",
    heading: "Frequently Asked Questions",
    ctaLabel: null,
    ctaLink: null,
    questions: [
      {
        id: "question-1",
        question: "Who is Jesus?",
        answer: "Jesus is the Son of God.",
      },
      {
        id: "question-2",
        question: "Why did Jesus come?",
        answer: "Jesus came to bring hope.",
      },
    ],
  } as unknown as Parameters<typeof RelatedQuestions>[0]["data"]
}

function getFaqTriggers() {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
}

function getControlledPanel(trigger: HTMLButtonElement) {
  const panelId = trigger.getAttribute("aria-controls")
  expect(panelId).toBeTruthy()

  const panel = document.getElementById(panelId ?? "")
  expect(panel).not.toBeNull()
  return panel as HTMLDivElement
}

describe("RelatedQuestions disclosure semantics", () => {
  it("connects every collapsed trigger to a unique hidden answer panel", () => {
    act(() => {
      root.render(<RelatedQuestions data={makeData()} />)
    })

    const triggers = getFaqTriggers()
    expect(triggers).toHaveLength(2)

    const panelIds = triggers.map((trigger) => {
      expect(trigger.type).toBe("button")
      expect(trigger.getAttribute("aria-expanded")).toBe("false")

      const panel = getControlledPanel(trigger)
      expect(panel.hidden).toBe(true)
      expect(panel.textContent).toBe("")
      return panel.id
    })

    expect(new Set(panelIds).size).toBe(panelIds.length)
  })

  it("keeps state and controlled-panel visibility accurate while toggling rows", () => {
    act(() => {
      root.render(<RelatedQuestions data={makeData()} />)
    })

    const [firstTrigger, secondTrigger] = getFaqTriggers()
    expect(firstTrigger).toBeDefined()
    expect(secondTrigger).toBeDefined()

    const firstPanel = getControlledPanel(firstTrigger!)
    const secondPanel = getControlledPanel(secondTrigger!)

    act(() => {
      firstTrigger!.click()
    })
    expect(firstTrigger!.getAttribute("aria-expanded")).toBe("true")
    expect(firstPanel.hidden).toBe(false)
    expect(firstPanel.textContent).toContain("Jesus is the Son of God.")
    expect(secondTrigger!.getAttribute("aria-expanded")).toBe("false")
    expect(secondPanel.hidden).toBe(true)

    act(() => {
      secondTrigger!.click()
    })
    expect(firstTrigger!.getAttribute("aria-expanded")).toBe("false")
    expect(firstPanel.hidden).toBe(true)
    expect(firstPanel.textContent).toBe("")
    expect(secondTrigger!.getAttribute("aria-expanded")).toBe("true")
    expect(secondPanel.hidden).toBe(false)
    expect(secondPanel.textContent).toContain("Jesus came to bring hope.")

    act(() => {
      secondTrigger!.click()
    })
    expect(secondTrigger!.getAttribute("aria-expanded")).toBe("false")
    expect(secondPanel.hidden).toBe(true)
    expect(secondPanel.textContent).toBe("")
  })
})
