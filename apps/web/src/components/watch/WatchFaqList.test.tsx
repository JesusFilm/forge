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

  describe("select-to-copy guard", () => {
    // Chrome fires a click when a drag-select ends inside a <summary>, and
    // summary activation is that click's default action — so copying a
    // question would collapse the row under the cursor. Trap 2 in
    // `docs/solutions/design-patterns/native-details-summary-disclosure-implementation-traps.md`.
    function stubSelection(value: { isCollapsed: boolean } | null) {
      const original = window.getSelection
      window.getSelection = (() => value) as typeof window.getSelection
      return () => {
        window.getSelection = original
      }
    }

    it("does not toggle when the click ends a text selection", () => {
      render([])
      const restore = stubSelection({ isCollapsed: false })

      const row = rows()[0]
      act(() => {
        row.querySelector("summary")!.click()
      })

      expect(row.open).toBe(false)
      restore()
    })

    it("still toggles on a plain click with nothing selected", () => {
      render([])
      const restore = stubSelection({ isCollapsed: true })

      const row = rows()[0]
      act(() => {
        row.querySelector("summary")!.click()
      })

      expect(row.open).toBe(true)
      restore()
    })

    it("still toggles when getSelection returns nothing at all", () => {
      // The guard must not be able to wedge the control shut on a platform
      // that reports no selection object.
      render([])
      const restore = stubSelection(null)

      const row = rows()[0]
      act(() => {
        row.querySelector("summary")!.click()
      })

      expect(row.open).toBe(true)
      restore()
    })
  })

  describe("aria-controls relationship", () => {
    // feat-317 gave the previous hand-rolled disclosure `aria-controls`
    // for external accessibility issue FGE-40. <details> supplies expanded
    // state natively but has no controls equivalent, so it is restored
    // explicitly rather than surrendered with the primitive.
    it("points every summary at the answer panel in its own row", () => {
      render([])

      for (const row of rows()) {
        const controls = row
          .querySelector("summary")!
          .getAttribute("aria-controls")
        expect(controls).toBeTruthy()
        // Resolved with getElementById rather than a `#id` selector: React's
        // useId emits guillemets, and `apps/web`'s jsdom has no `CSS.escape`
        // (that polyfill reaches apps/chat only via @testing-library, which
        // this app does not depend on).
        const panel = document.getElementById(controls!)
        expect(panel).not.toBeNull()
        expect(row.contains(panel)).toBe(true)
      }
    })

    it("keeps panel ids unique within and across rendered lists", () => {
      const second = document.createElement("div")
      document.body.appendChild(second)
      const secondRoot = createRoot(second)
      render([])
      act(() => {
        secondRoot.render(
          <WatchFaqList items={ITEMS} openIds={[]} onToggle={() => {}} />,
        )
      })

      const ids = [
        ...document.querySelectorAll<HTMLElement>("summary[aria-controls]"),
      ].map((el) => el.getAttribute("aria-controls"))

      expect(ids).toHaveLength(4)
      expect(new Set(ids).size).toBe(4)

      act(() => secondRoot.unmount())
      second.remove()
    })

    it("leaves expanded state to the native element", () => {
      // A hand-written aria-expanded fights the implicit mapping <details>
      // already provides on its summary.
      render(["a"])

      for (const row of rows()) {
        expect(
          row.querySelector("summary")!.hasAttribute("aria-expanded"),
        ).toBe(false)
      }
    })
  })

  it("defaults the hover affordance to an underline, never a colour", () => {
    // A fixed hover colour cannot clear WCAG AA on both a light and a dark
    // SECTION_BG_CLASSES band — measured 2.58:1 to 4.35:1 for the brand red
    // against 20px/600 text. An underline inherits the question's own colour,
    // so it passes wherever the question already does.
    render([])

    const className = rows()[0].querySelector("h3")?.getAttribute("class") ?? ""

    expect(className, className).toContain("group-hover/question:underline")
    expect(className, className).not.toMatch(/group-hover\/question:text-/)
  })
})
