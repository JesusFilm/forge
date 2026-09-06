/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { WhatsNewFaq } from "@/components/whats-new/WhatsNewFaq"
import { WHATS_NEW_FAQ } from "@/components/whats-new/whats-new-content"

let container: HTMLDivElement
let root: Root

const rows = () => [
  ...container.querySelectorAll<HTMLDetailsElement>(
    '[data-testid="whats-new-faq-item"]',
  ),
]
const toggleAll = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="whats-new-faq-toggle-all"]',
  )!

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<WhatsNewFaq contentClass="rail" />)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe("WhatsNewFaq", () => {
  it("renders every question as a native disclosure, closed", () => {
    // `<details>` is load-bearing: it supplies the keyboard behaviour and
    // the expanded state announcement, and it still opens if this
    // component never hydrates.
    expect(rows()).toHaveLength(WHATS_NEW_FAQ.items.length)
    for (const [index, row] of rows().entries()) {
      expect(row.tagName).toBe("DETAILS")
      expect(row.querySelector("summary")).not.toBeNull()
      expect(row.open).toBe(false)
      expect(row.textContent).toContain(WHATS_NEW_FAQ.items[index].question)
      expect(row.textContent).toContain(WHATS_NEW_FAQ.items[index].answer)
    }
  })

  it("expands and collapses every row from one control", () => {
    act(() => {
      toggleAll().click()
    })
    expect(rows().every((row) => row.open)).toBe(true)
    expect(toggleAll().getAttribute("aria-expanded")).toBe("true")
    expect(toggleAll().textContent).toContain(WHATS_NEW_FAQ.collapseAll)

    act(() => {
      toggleAll().click()
    })
    expect(rows().some((row) => row.open)).toBe(false)
    expect(toggleAll().textContent).toContain(WHATS_NEW_FAQ.expandAll)
  })

  it("tracks a row opened on its own without desyncing the bulk control", () => {
    // The browser toggles `open` itself when a summary is clicked; if that
    // did not feed back into state, Expand-all would fight the user.
    const [first] = rows()
    act(() => {
      first.open = true
      first.dispatchEvent(new Event("toggle"))
    })

    expect(toggleAll().getAttribute("aria-expanded")).toBe("false")
    act(() => {
      toggleAll().click()
    })
    expect(rows().every((row) => row.open)).toBe(true)
  })

  it("hides the default marker so the chevron is the only affordance", () => {
    const summary = rows()[0].querySelector("summary")!
    expect(summary.className).toContain("list-none")
    expect(summary.className).toContain("details-marker")
  })
})
