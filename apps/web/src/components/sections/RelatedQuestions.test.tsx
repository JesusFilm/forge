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

function renderQuestions() {
  act(() => {
    root.render(<RelatedQuestions data={makeData()} />)
  })
}

const rows = () => [
  ...container.querySelectorAll<HTMLDetailsElement>(
    '[data-testid="RelatedQuestionsItem"]',
  ),
]

/** What the browser does when a user clicks a summary. */
function nativeToggle(row: HTMLDetailsElement, open: boolean) {
  act(() => {
    row.open = open
    row.dispatchEvent(new Event("toggle"))
  })
}

describe("RelatedQuestions", () => {
  it("renders every question through the shared Watch FAQ list", () => {
    renderQuestions()

    // Sharing `WatchFaqList` with the what's-new FAQ is what keeps the two
    // surfaces from drifting; the disclosure primitive coming back as
    // `<details>` is the visible edge of that.
    expect(rows()).toHaveLength(2)
    for (const row of rows()) {
      expect(row.tagName).toBe("DETAILS")
      expect(row.querySelector("summary")).not.toBeNull()
      expect(row.open).toBe(false)
    }

    expect(container.querySelector("h2")?.textContent).toBe(
      "Frequently Asked Questions",
    )
    expect(rows()[0].querySelector("h3")?.textContent).toBe(
      "Where can I watch the JESUS film online for free?",
    )
  })

  it("puts every answer in the markup before anything is opened", () => {
    renderQuestions()

    // A behaviour change from the old button/`hidden` panel, which mounted
    // an answer only once its row was clicked and so shipped none of this
    // text in the server-rendered HTML. Native `<details>` keeps closed
    // content in the DOM, which is what gives the rows find-in-page
    // expansion — and puts FAQ answers where a crawler can read them.
    expect(rows().every((row) => !row.open)).toBe(true)
    expect(container.textContent).toContain("You can watch it on this site.")
    expect(container.textContent).toContain("Jesus came to bring hope.")
  })

  it("opens one row at a time", () => {
    renderQuestions()
    const [first, second] = rows()

    nativeToggle(first, true)
    expect(first.open).toBe(true)
    expect(second.open).toBe(false)

    nativeToggle(second, true)
    expect(second.open).toBe(true)
    // React closes the first row in response, which is the whole point of the
    // accordion — the what's-new FAQ keeps every row open instead.
    expect(first.open).toBe(false)
  })

  it("ignores the close echo from a row React itself just closed", () => {
    renderQuestions()
    const [first, second] = rows()

    nativeToggle(first, true)
    nativeToggle(second, true)

    // React setting `open={false}` on the first row makes the browser fire a
    // `toggle` for it. Handled naively — "a close clears the open row" — that
    // echo would immediately collapse the row the user just opened.
    nativeToggle(first, false)
    expect(second.open).toBe(true)
  })

  it("collapses the open row when it is toggled again", () => {
    renderQuestions()
    const [first] = rows()

    nativeToggle(first, true)
    expect(first.open).toBe(true)

    nativeToggle(first, false)
    expect(first.open).toBe(false)
  })

  it("sets no ink of its own, so the section's background can pick it", () => {
    renderQuestions()

    // `WhatsNewFaq` owns its band and hard-codes `#131111`. This block is
    // dropped into a `Section` spanning `stone-100` to `stone-900`, so a
    // literal light-on-dark colour anywhere here breaks the `light` theme —
    // which is exactly what the pre-share `text-stone-100` did.
    for (const el of container.querySelectorAll<HTMLElement>("*")) {
      const className = el.getAttribute("class") ?? ""
      expect(className, className).not.toMatch(/\btext-stone-[12]/)
      expect(className, className).not.toMatch(/\bborder-stone-/)
    }
  })
})
