/**
 * @vitest-environment jsdom
 *
 * Related-question heading overflow (QA finding RQ2b).
 *
 * Some lessons (e.g. the New Believer Course) carry a bare URL as a
 * "question". An unbroken run of characters cannot wrap by default, so it
 * pushes past the row on narrow viewports. jsdom has no layout engine, so this
 * suite pins the CSS contract that fixes it (`overflow-wrap: anywhere` on the
 * heading); the real-browser proof is the 320/768 screenshots on the PR.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { WatchStudyQuestions } from "@/components/watch/WatchStudyQuestions"

const LONG_URL =
  "https://www.jesusfilm.org/new-believer-course/lesson-1/a-very-long-path-segment-with-no-break-opportunities-at-all?utm_source=watch&utm_medium=related-question"

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

describe("WatchStudyQuestions — long unbroken question text", () => {
  it("lets a URL-shaped question wrap instead of overflowing its row", () => {
    act(() => {
      root.render(<WatchStudyQuestions prompts={[LONG_URL, "Short one?"]} />)
    })

    const headings = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-testid="watch-study-questions-item"] h3',
      ),
    )
    expect(headings).toHaveLength(2)

    const urlHeading = headings.find((h) => h.textContent === LONG_URL)
    expect(urlHeading).toBeDefined()
    // `overflow-wrap: anywhere` (unlike `break-word`) also shrinks the
    // min-content size, so the grid's `minmax(0,1fr)` track can't be pushed
    // wider by the unbreakable run.
    expect(urlHeading?.className).toContain("[overflow-wrap:anywhere]")
  })
})
