/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { WhatsNewAudienceQuiz } from "@/components/whats-new/WhatsNewAudienceQuiz"
import { WHATS_NEW_QUIZ } from "@/components/whats-new/whats-new-content"

let container: HTMLDivElement
let root: Root

const q = <T extends Element>(id: string) =>
  container.querySelector<T>(`[data-testid="whats-new-quiz-${id}"]`)

function setGuess(value: number) {
  const slider = q<HTMLInputElement>("slider")!
  act(() => {
    // jsdom: dispatching `input` alone does not drive React's onChange.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!
    setter.call(slider, String(value))
    slider.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function submit() {
  act(() => {
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<WhatsNewAudienceQuiz />)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe("WhatsNewAudienceQuiz", () => {
  it("withholds the answer until a guess is committed", () => {
    // The reveal is the whole point. If any of the answer is on screen
    // before the reader commits, the surprise is gone and the section
    // loses its argument.
    expect(container.textContent).not.toContain(WHATS_NEW_QUIZ.revealHeading)
    expect(container.textContent).not.toContain(WHATS_NEW_QUIZ.revealBody)
    expect(q("reveal")).toBeNull()
    expect(q("submit")).not.toBeNull()
  })

  it("reveals the real figure once a guess is submitted", () => {
    setGuess(40)
    submit()

    const reveal = q("reveal")
    expect(reveal).not.toBeNull()
    expect(reveal?.getAttribute("role")).toBe("status")
    expect(reveal?.textContent).toContain(WHATS_NEW_QUIZ.revealHeading)
    // Both halves of the point: serve the many, do not drop the few.
    expect(reveal?.textContent).toContain(WHATS_NEW_QUIZ.revealBody)
    expect(reveal?.textContent).toContain(WHATS_NEW_QUIZ.revealPartners)
  })

  it("charts the guess against reality, not against itself", () => {
    setGuess(40)
    submit()

    expect(q<HTMLElement>("bar-guess")?.style.width).toBe("40%")
    expect(q<HTMLElement>("bar-actual")?.style.width).toBe(
      `${WHATS_NEW_QUIZ.actualPercent}%`,
    )
  })

  it("keeps a 0% guess visible instead of collapsing the bar", () => {
    setGuess(0)
    submit()

    // A zero-width bar reads as a broken chart rather than a low guess.
    expect(q<HTMLElement>("bar-guess")?.style.width).toBe("1%")
  })

  it("scales the verdict to how far off the guess was", () => {
    setGuess(40)
    submit()
    expect(q("verdict")?.textContent).toBe("That is 20× the real number.")

    act(() => {
      q<HTMLButtonElement>("reset")?.click()
    })
    setGuess(0)
    submit()
    expect(q("verdict")?.textContent).toBe(WHATS_NEW_QUIZ.underGuess)
  })

  it("lets the reader close the reveal and try again", () => {
    setGuess(40)
    submit()
    const reset = q<HTMLButtonElement>("reset")
    expect(reset?.textContent).toBe(WHATS_NEW_QUIZ.dismiss)

    act(() => {
      reset?.click()
    })

    expect(q("reveal")).toBeNull()
    expect(q("submit")).not.toBeNull()
  })

  it("labels the slider and announces its value", () => {
    const slider = q<HTMLInputElement>("slider")!

    expect(slider.getAttribute("aria-label")).toBe(WHATS_NEW_QUIZ.sliderLabel)
    expect(slider.getAttribute("aria-valuetext")).toBe("30%")
    expect(slider.min).toBe("0")
    expect(slider.max).toBe("100")
    setGuess(7)
    expect(q("value")?.textContent).toBe("7%")
  })

  it("wears no box of its own", () => {
    // Removed on request: beside the audience card it read as a second
    // card of equal weight competing with the one the question is about.
    // Listed explicitly rather than snapshotted so a re-added frame fails
    // here by name.
    const quiz = container.querySelector('[data-testid="whats-new-quiz"]')

    for (const token of [
      "rounded-3xl",
      "border",
      "backdrop-blur",
      "bg-[linear-gradient",
      "p-6",
    ]) {
      expect(quiz?.className, token).not.toContain(token)
    }
  })
})
