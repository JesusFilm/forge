/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { setRequestLocale } from "next-intl/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { RelatedQuestions } from "@/components/sections/RelatedQuestions"

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

function renderQuestions() {
  act(() => {
    root.render(
      <RelatedQuestions
        data={
          {
            id: "faq",
            sectionKey: "faq",
            heading: "Frequently Asked Questions",
            questions: [
              {
                id: "question-1",
                question: "Where can I watch the JESUS film online for free?",
                answer: "You can watch it on this site.",
              },
            ],
          } as unknown as Parameters<typeof RelatedQuestions>[0]["data"]
        }
      />,
    )
  })
}

describe("RelatedQuestions", () => {
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
})
