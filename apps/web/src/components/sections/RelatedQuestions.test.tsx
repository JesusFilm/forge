/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { setRequestLocale } from "next-intl/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { RelatedQuestions } from "@/components/sections/RelatedQuestions"
import type { RouteVideo } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  setRequestLocale("en")
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
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
        question: "Where can I watch the JESUS film online for free?",
        answer: "You can watch it on this site.",
      },
      {
        id: "question-2",
        question: "Why did Jesus come?",
        answer: "Jesus came to bring hope.",
      },
    ],
  } as unknown as Parameters<typeof RelatedQuestions>[0]["data"]
}

function makeRouteVideo(
  documentId: string,
  generatedQuestions: NonNullable<RouteVideo["generatedQuestions"]>,
): RouteVideo {
  return {
    documentId,
    slug: documentId,
    title: documentId,
    snippet: null,
    description: null,
    noIndex: false,
    imageUrl: null,
    imageAlt: null,
    streamingUrl: null,
    relatedItems: [],
    generatedQuestions,
  }
}

function renderQuestions() {
  act(() => {
    root.render(<RelatedQuestions data={makeData()} />)
  })
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

describe("RelatedQuestions", () => {
  it("uses the complete route-video Q&A list when the block opts in", () => {
    const data = {
      ...makeData(),
      questionsSource: "routeVideoGeneratedQuestions",
    } as unknown as Parameters<typeof RelatedQuestions>[0]["data"]
    const routeVideo = makeRouteVideo("video-one", [
      {
        documentId: "generated-1",
        sourceStudyQuestionId: "study-1",
        question: "What does this video show?",
        answer: "It shows a video-specific answer.",
        order: 1,
      },
    ])

    act(() => {
      root.render(<RelatedQuestions data={data} routeVideo={routeVideo} />)
    })

    expect(container.textContent).toContain("What does this video show?")
    expect(container.textContent).not.toContain(
      "Where can I watch the JESUS film online for free?",
    )
  })

  it("keeps the authored list as one atomic fallback", () => {
    const data = {
      ...makeData(),
      questionsSource: "routeVideoGeneratedQuestions",
    } as unknown as Parameters<typeof RelatedQuestions>[0]["data"]

    act(() => {
      root.render(
        <RelatedQuestions
          data={data}
          routeVideo={makeRouteVideo("video-without-generated", [])}
        />,
      )
    })

    expect(container.textContent).toContain(
      "Where can I watch the JESUS film online for free?",
    )
    expect(container.textContent).toContain("Why did Jesus come?")
  })

  it("manual blocks ignore route generated Q&A", () => {
    act(() => {
      root.render(
        <RelatedQuestions
          data={makeData()}
          routeVideo={makeRouteVideo("video-one", [
            {
              documentId: "generated-1",
              sourceStudyQuestionId: "study-1",
              question: "Generated question?",
              answer: "Generated answer.",
              order: 1,
            },
          ])}
        />,
      )
    })

    expect(container.textContent).toContain("Why did Jesus come?")
    expect(container.textContent).not.toContain("Generated question?")
  })

  it("resets an expanded answer when the route video changes", () => {
    const data = {
      ...makeData(),
      questionsSource: "routeVideoGeneratedQuestions",
    } as unknown as Parameters<typeof RelatedQuestions>[0]["data"]
    const firstRoute = makeRouteVideo("video-one", [
      {
        documentId: "generated-1",
        sourceStudyQuestionId: "study-1",
        question: "First video question?",
        answer: "First video answer.",
        order: 1,
      },
    ])

    act(() => {
      root.render(<RelatedQuestions data={data} routeVideo={firstRoute} />)
    })
    act(() => {
      getFaqTriggers()[0]?.click()
    })
    expect(container.textContent).toContain("First video answer.")

    act(() => {
      root.render(
        <RelatedQuestions
          data={data}
          routeVideo={makeRouteVideo("video-two", [
            {
              documentId: "generated-2",
              sourceStudyQuestionId: "study-2",
              question: "Second video question?",
              answer: "Second video answer.",
              order: 1,
            },
          ])}
        />,
      )
    })

    expect(getFaqTriggers()[0]?.getAttribute("aria-expanded")).toBe("false")
    expect(container.textContent).not.toContain("Second video answer.")

    act(() => {
      root.render(<RelatedQuestions data={data} routeVideo={firstRoute} />)
    })
    expect(getFaqTriggers()[0]?.getAttribute("aria-expanded")).toBe("false")
    expect(container.textContent).not.toContain("First video answer.")
  })

  it("uses icon-free, normal-weight rows with centered content and equal padding", () => {
    renderQuestions()

    const trigger = container.querySelector("button")
    const row = trigger?.firstElementChild?.firstElementChild
    const question = row?.querySelector("p")

    expect(trigger?.className).toContain("p-4")
    expect(trigger?.className).not.toContain("py-3")
    expect(row?.className).toContain("items-center")
    expect(row?.className).not.toContain("items-start")
    expect(question?.className).toContain("font-normal")
    expect(question?.className).not.toContain("font-semibold")
    expect(question?.querySelector("svg")).toBeNull()
    expect(trigger?.querySelectorAll("svg")).toHaveLength(1)
  })

  it("keeps the row expandable after the presentation change", () => {
    renderQuestions()

    const trigger = container.querySelector("button")
    expect(container.textContent).not.toContain(
      "You can watch it on this site.",
    )

    act(() => {
      trigger?.click()
    })

    expect(container.textContent).toContain("You can watch it on this site.")
  })

  it("connects every collapsed trigger to a unique hidden answer panel", () => {
    renderQuestions()

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
    renderQuestions()

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
    expect(firstPanel.textContent).toContain("You can watch it on this site.")
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
