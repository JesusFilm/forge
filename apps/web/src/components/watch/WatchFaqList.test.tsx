/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  WatchFaqList,
  type WatchFaqItem,
} from "@/components/watch/WatchFaqList"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const ITEMS: WatchFaqItem[] = [
  { id: "a", question: "Where can I watch it?", answer: "On this site." },
  { id: "b", question: "Why did Jesus come?", answer: "To bring hope." },
]

function render(
  openIds: readonly string[],
  onToggle: (id: string, open: boolean) => void = () => {},
) {
  act(() => {
    root.render(
      <WatchFaqList
        items={ITEMS}
        openIds={openIds}
        onToggle={onToggle}
        heading="Questions"
        itemTestId="faq-row"
      />,
    )
  })
}

const rows = () => [
  ...container.querySelectorAll<HTMLDetailsElement>('[data-testid="faq-row"]'),
]

/**
 * jsdom dispatches `toggle` on a macrotask while `details.open` flips
 * synchronously during activation — measured in this app's own vitest
 * environment, which differs from the capability map in
 * `docs/solutions/design-patterns/native-details-summary-disclosure-implementation-traps.md`
 * (that one was probed against apps/chat). So an assertion on `onToggle`
 * taken straight after a click sees nothing; flush first.
 */
async function flushToggle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("WatchFaqList", () => {
  it("renders each item as a native disclosure with a heading question", () => {
    render([])

    expect(rows()).toHaveLength(2)
    for (const [index, row] of rows().entries()) {
      expect(row.tagName).toBe("DETAILS")
      expect(row.querySelector("summary")).not.toBeNull()
      expect(row.querySelector("h3")?.textContent).toBe(ITEMS[index].question)
    }
  })

  it("opens exactly the rows named in openIds", () => {
    render(["b"])

    expect(rows()[0].open).toBe(false)
    expect(rows()[1].open).toBe(true)
  })

  it("reports the toggled row's id and its new open state", async () => {
    const onToggle = vi.fn()
    render([], onToggle)

    act(() => {
      rows()[0].querySelector("summary")!.click()
    })
    await flushToggle()

    expect(onToggle).toHaveBeenCalledWith("a", true)
  })

  it("keeps the chevron on a solid colour so its opacity cannot composite per stroke", () => {
    render([])

    // Mirrors the page-wide rule enforced in
    // `whats-new/__tests__/WatchWhatsNewPage.test.tsx`: a lucide glyph is a
    // multi-path stroke drawing, so a fractional colour utility composites
    // every crossing twice. Alpha belongs on element opacity instead.
    const chevron = rows()[0].querySelector("summary svg")
    const className = chevron?.getAttribute("class") ?? ""

    expect(className, className).toMatch(/\bopacity-\d/)
    expect(className, className).toMatch(/\btext-\S+/)
    expect(className, className).not.toMatch(
      /\btext-[a-z]+(?:-\d+)?\/(?:\d+|\[)/,
    )
  })

  it("draws its hairline from the inherited ink rather than a literal colour", () => {
    render([])

    // The caller supplies the ink: `WhatsNewFaq` owns a fixed light band,
    // while the Experience block lands on any `SECTION_BG_CLASSES`
    // background. A literal colour here is invisible on one of them.
    const className = rows()[0].getAttribute("class") ?? ""

    expect(className, className).toContain("border-current/")
    expect(className, className).not.toMatch(/\bborder-(?:black|white|stone)-?/)
  })
})
