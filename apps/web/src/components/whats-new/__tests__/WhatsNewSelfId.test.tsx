/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { WhatsNewSelfId } from "@/components/whats-new/WhatsNewSelfId"
import {
  WHATS_NEW_AUDIENCES,
  WHATS_NEW_SELF_ID,
} from "@/components/whats-new/whats-new-content"

let container: HTMLDivElement
let root: Root

const options = () => [
  ...container.querySelectorAll<HTMLLabelElement>(
    '[data-testid="whats-new-self-id-option"]',
  ),
]

const radio = (id: string) =>
  container.querySelector<HTMLInputElement>(
    `[data-testid="whats-new-self-id-radio-${id}"]`,
  )!

const answer = () =>
  container.querySelector<HTMLElement>(
    '[data-testid="whats-new-self-id-answer"]',
  )

const live = () =>
  container.querySelector<HTMLElement>('[data-testid="whats-new-self-id-live"]')

function pick(id: string) {
  act(() => {
    radio(id).click()
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<WhatsNewSelfId />)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe("WhatsNewSelfId", () => {
  it("asks the question with every option and no answer yet", () => {
    expect(container.textContent).toContain(WHATS_NEW_SELF_ID.question)
    expect(container.textContent).toContain(WHATS_NEW_SELF_ID.helper)
    expect(options()).toHaveLength(WHATS_NEW_SELF_ID.options.length)
    for (const option of WHATS_NEW_SELF_ID.options) {
      expect(container.textContent).toContain(option.label)
    }

    // Unanswered: no response is on screen, and no option is preselected —
    // a default pick would answer for the reader.
    expect(answer()).toBeNull()
    for (const option of WHATS_NEW_SELF_ID.options) {
      expect(radio(option.id).checked).toBe(false)
      expect(container.textContent).not.toContain(option.response)
    }
  })

  it("answers with the copy for the option the reader picked", () => {
    pick("partner")

    const shown = answer()
    expect(shown).not.toBeNull()
    expect(shown?.getAttribute("data-option")).toBe("partner")
    expect(shown?.textContent).toContain(WHATS_NEW_SELF_ID.answerLabel)
    expect(shown?.textContent).toContain(
      WHATS_NEW_SELF_ID.options.find((option) => option.id === "partner")
        ?.response,
    )
  })

  it("shows one answer at a time as the reader changes their mind", () => {
    const seeker = WHATS_NEW_SELF_ID.options.find(
      (option) => option.id === "seeker",
    )!
    const all = WHATS_NEW_SELF_ID.options.find((option) => option.id === "all")!

    pick("seeker")
    expect(answer()?.textContent).toContain(seeker.response)

    pick("all")
    expect(answer()?.getAttribute("data-option")).toBe("all")
    expect(answer()?.textContent).toContain(all.response)
    // The previous answer is gone, not stacked underneath the new one.
    expect(container.textContent).not.toContain(seeker.response)
    expect(radio("seeker").checked).toBe(false)
    expect(radio("all").checked).toBe(true)
  })

  it("announces the answer through a live region that predates it", () => {
    // A `role="status"` element inserted at the same instant as its text is
    // announced inconsistently, so the region has to be on the page BEFORE
    // the first pick — empty — with only its contents swapping.
    const region = live()
    expect(region).not.toBeNull()
    expect(region?.getAttribute("role")).toBe("status")
    expect(region?.textContent).toBe("")

    pick("seeker")
    expect(live()).toBe(region)
    expect(region?.contains(answer())).toBe(true)
  })

  it("marks only the picked option as selected", () => {
    pick("sharing")

    const selected = options().filter((option) =>
      option.hasAttribute("data-selected"),
    )
    expect(selected).toHaveLength(1)
    expect(selected[0].getAttribute("data-option")).toBe("sharing")
  })

  it("is one radio group labelled by the visible question", () => {
    // Arrow-key navigation and the "1 of N" announcement both depend on
    // every input sharing a name inside a fieldset whose legend IS the
    // question — not on ARIA we would have to keep in sync.
    const names = new Set(
      WHATS_NEW_SELF_ID.options.map((option) => radio(option.id).name),
    )
    expect(names.size).toBe(1)
    expect([...names][0]).not.toBe("")

    const fieldset = container.querySelector("fieldset")
    expect(fieldset?.querySelector("legend")?.textContent).toBe(
      WHATS_NEW_SELF_ID.question,
    )
    for (const option of WHATS_NEW_SELF_ID.options) {
      expect(fieldset?.contains(radio(option.id))).toBe(true)
    }
  })

  it("promises nothing is sent, and sends nothing", () => {
    // The note is a claim about behaviour: no form to submit, no storage.
    expect(container.textContent).toContain(WHATS_NEW_SELF_ID.note)
    expect(container.querySelector("form")).toBeNull()

    pick("seeker")
    expect(container.querySelector("form")).toBeNull()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it("mirrors the three audience cards, in order, then adds the blend", () => {
    // The options are meant to read as picking one of the cards above. If a
    // card's icon or colour changes and its option does not, the section
    // quietly turns into an unrelated survey.
    const mirrored = WHATS_NEW_SELF_ID.options.slice(
      0,
      WHATS_NEW_AUDIENCES.cards.length,
    )
    expect(mirrored.map((option) => option.icon)).toEqual(
      WHATS_NEW_AUDIENCES.cards.map((card) => card.icon),
    )
    expect(mirrored.map((option) => option.tint)).toEqual(
      WHATS_NEW_AUDIENCES.cards.map((card) => card.tint),
    )

    // Exactly one extra option — the "all three" answer — and it does not
    // borrow a card's hue, which would imply a fourth audience.
    const extra = WHATS_NEW_SELF_ID.options.slice(
      WHATS_NEW_AUDIENCES.cards.length,
    )
    expect(extra).toHaveLength(1)
    expect(WHATS_NEW_AUDIENCES.cards.map((card) => card.tint)).not.toContain(
      extra[0].tint,
    )
  })
})
