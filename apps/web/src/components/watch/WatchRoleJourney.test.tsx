// @vitest-environment jsdom
import {
  act,
  createElement,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react"
import { createRoot, hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  WATCH_AUDIENCE_CODE_CONFIG,
  type WatchAudienceConfig,
} from "@/lib/watch-audience-config"
import { WatchHomeRoleBand } from "@/components/home/WatchHomeRoleBand"
import { WatchNextSteps, type WatchNextStepsProps } from "./WatchNextSteps"

vi.mock("next/link", () => ({
  default: ({
    prefetch,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    prefetch?: boolean
    children?: ReactNode
  }) =>
    createElement(
      "a",
      { ...props, "data-prefetch": String(prefetch) },
      children,
    ),
}))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, "", "/watch")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
})

function button(label: string) {
  const match = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((node) => node.textContent?.trim() === label)
  expect(match, `button ${label}`).toBeDefined()
  return match!
}

function click(label: string) {
  act(() => button(label).click())
}

function chooseFirstThree() {
  for (let i = 0; i < 3; i += 1) {
    const option =
      container.querySelector<HTMLButtonElement>("[data-option-id]")!
    act(() => option.click())
  }
}

function renderFrame(props: WatchNextStepsProps = {}) {
  act(() => root.render(createElement(WatchNextSteps, props)))
}

describe("shared role journey", () => {
  for (const surface of ["home", "video"] as const) {
    it.each(WATCH_AUDIENCE_CODE_CONFIG.roles)(
      `${surface}: completes three questions for $id with a real result and alternatives`,
      (role) => {
        act(() =>
          root.render(
            createElement(
              surface === "home" ? WatchHomeRoleBand : WatchNextSteps,
              { languageSlug: "english" },
            ),
          ),
        )
        click(role.label)
        for (let i = 0; i < 3; i += 1) {
          expect(container.textContent).toContain(`Question ${i + 1} of 3`)
          expect(container.textContent).toContain(role.questions[i].prompt)
          act(() =>
            container
              .querySelector<HTMLButtonElement>("[data-option-id]")!
              .click(),
          )
        }
        expect(container.textContent).toContain(role.finish)
        expect(container.textContent).toContain("Because ")
        const result = container.querySelector<HTMLAnchorElement>(
          '[data-testid="watch-journey-result"] a',
        )!
        expect(result.getAttribute("href")).toMatch(/^(\/|https:\/\/)/)
        expect(result.getAttribute("href")).not.toBe("#")
        expect(
          container.querySelectorAll(
            '[data-testid="watch-journey-alternatives"] [data-action-id]',
          ).length,
        ).toBeGreaterThan(0)
        expect(localStorage.length).toBe(1)
        expect(localStorage.getItem("forge.watch.role")).toBe(role.id)
      },
    )
  }

  it("supports back, changing answers and resetting, and resets when the role changes", () => {
    renderFrame({ languageSlug: "english" })
    click("Just curiousSaw this and kept watching")
    expect(container.textContent).toContain("Question 2 of 3")
    click("Back")
    expect(
      container
        .querySelector('[data-option-id="curious"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true")
    chooseFirstThree()
    click("Change answers")
    expect(container.textContent).toContain("Question 1 of 3")
    chooseFirstThree()
    click("Start over")
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0)
    act(() =>
      container.querySelector<HTMLButtonElement>("[data-option-id]")!.click(),
    )
    click("Grow in faith")
    expect(container.textContent).toContain("Question 1 of 3")
    click("Explore faith")
    expect(container.textContent).toContain("Question 1 of 3")
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0)
  })

  it("moves focus to the next question and result after answering, without stealing role-tab focus", () => {
    renderFrame({ languageSlug: "english" })
    chooseFirstThree()
    expect(document.activeElement?.textContent).toBe(
      WATCH_AUDIENCE_CODE_CONFIG.roles[0].finish,
    )
    const grow = button("Grow in faith")
    act(() => {
      grow.focus()
      grow.click()
    })
    expect(document.activeElement).toBe(grow)
  })

  it("recomputes the result when answers change and returns focus after clearing retained answers", () => {
    renderFrame({ languageSlug: "english" })
    chooseFirstThree()
    expect(
      container
        .querySelector('[data-testid="watch-journey-result"] [data-action-id]')
        ?.getAttribute("data-action-id"),
    ).toBe("explore-short-films")
    click("Change answers")
    click("I have real questionsAbout Jesus, God, the Bible")
    click("Show me the storyI’ll decide after I’ve seen it")
    click("An evening")
    expect(
      container
        .querySelector('[data-testid="watch-journey-result"] [data-action-id]')
        ?.getAttribute("data-action-id"),
    ).toBe("explore-full-film")
    click("Change answers")
    const reset = button("Start over")
    act(() => {
      reset.focus()
      reset.click()
    })
    expect(document.activeElement?.textContent).toBe(
      "Where are you starting from?",
    )
    expect(
      container.querySelectorAll('[data-option-id][aria-pressed="true"]'),
    ).toHaveLength(0)
  })

  it("hydrates the reserved Explore frame without a mismatch, then shows the saved role", async () => {
    act(() => root.unmount())
    localStorage.setItem("forge.watch.role", "partner")
    const frame = createElement(WatchNextSteps, { languageSlug: "english" })
    container.innerHTML = renderToString(frame)
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe(
      "Explore faith",
    )
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await act(async () => {
        root = hydrateRoot(container, frame)
      })
      expect(errors).not.toHaveBeenCalled()
      expect(
        container.querySelector('[aria-selected="true"]')?.textContent,
      ).toBe("Partner with us")
      expect(container.textContent).toContain("Question 1 of 3")
    } finally {
      errors.mockRestore()
    }
  })

  it("omits unavailable controls before selecting the top action, and wires an available handler", () => {
    renderFrame({ languageSlug: "spanish", locale: "es" })
    click("Share your faith")
    click("One friend")
    click("Curious")
    click("In a message")
    expect(
      container
        .querySelector('[data-testid="watch-journey-result"] [data-action-id]')
        ?.getAttribute("data-action-id"),
    ).toBe("share-conversation-starters")
    expect(
      container
        .querySelector('a[href="/conversation-starters.html/spanish.html"]')
        ?.getAttribute("data-prefetch"),
    ).toBe("false")
    expect(
      container.querySelector('[data-action-id="share-send-film"]'),
    ).toBeNull()

    const share = vi.fn()
    renderFrame({ languageSlug: "spanish", currentVideoActions: { share } })
    const result = container.querySelector<HTMLButtonElement>(
      '[data-testid="watch-journey-result"] button',
    )!
    expect(result.getAttribute("data-action-id")).toBe("share-send-film")
    act(() => result.click())
    expect(share).toHaveBeenCalledOnce()
  })

  it.each([undefined, "bad/slug", ""])(
    "does not invent English film or history links without valid language context (%s)",
    (languageSlug) => {
      renderFrame({ languageSlug })
      chooseFirstThree()
      expect(container.querySelector('a[href*=".html"]')).toBeNull()
      expect(container.querySelector('a[href="/languages"]')).not.toBeNull()
    },
  )

  it("keeps selected audio for history/languages, labels English resources, and uses safe external anchors", () => {
    renderFrame({ languageSlug: "spanish", locale: "es" })
    expect(container.textContent).toContain("English resources")
    click("Grow in faith")
    chooseFirstThree()
    expect(
      container
        .querySelector('a[href="/spanish.html/history"]')
        ?.getAttribute("data-prefetch"),
    ).toBe("false")
    const external = container.querySelector('a[href^="https://"]')!
    expect(external.getAttribute("target")).toBe("_blank")
    expect(external.getAttribute("rel")).toBe("noopener noreferrer")
    click("Partner with us")
    chooseFirstThree()
    expect(
      container.querySelector('a[href="/spanish.html/languages"]'),
    ).not.toBeNull()
  })

  it("ranks stable authored IDs after action reordering and omits unsafe authored destinations", () => {
    const config: WatchAudienceConfig = structuredClone(
      WATCH_AUDIENCE_CODE_CONFIG,
    )
    const explore = config.roles[0]
    explore.actions.reverse()
    explore.actions.unshift({
      id: "unsafe",
      title: "Unsafe",
      body: "Unsafe",
      target: { kind: "resource", url: "javascript:alert(1)" },
    })
    renderFrame({ languageSlug: "english", config })
    chooseFirstThree()
    expect(
      container
        .querySelector('[data-testid="watch-journey-result"] [data-action-id]')
        ?.getAttribute("data-action-id"),
    ).toBe("explore-short-films")
    expect(
      container.querySelector('a[href="/conversation-starters.html"]'),
    ).not.toBeNull()
    expect(container.querySelector('[data-action-id="unsafe"]')).toBeNull()
  })
})
