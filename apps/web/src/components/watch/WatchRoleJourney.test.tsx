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
import { WATCH_JOURNEY_OPTION_ICONS } from "./WatchRoleJourney"

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

function resultActionId() {
  return container
    .querySelector('[data-testid="watch-journey-result"] [data-action-id]')
    ?.getAttribute("data-action-id")
}

function renderFrame(props: WatchNextStepsProps = {}) {
  act(() => root.render(createElement(WatchNextSteps, props)))
}

describe("shared role journey", () => {
  it("adds no finder entry to the Explore journey (the original opens it from Grow)", () => {
    renderFrame({ languageSlug: "english", locale: "en" })
    expect(
      container.querySelector('[data-testid="watch-find-open"]'),
    ).toBeNull()
    chooseFirstThree()
    expect(
      container.querySelector('[data-testid="watch-find-open"]'),
    ).toBeNull()
  })

  it.each(
    WATCH_AUDIENCE_CODE_CONFIG.roles.filter((role) => role.id !== "partner"),
  )(
    "video: completes three questions for $id with a real result and alternatives",
    (role) => {
      renderFrame({ languageSlug: "english" })
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
      expect(
        container.querySelectorAll('ol[aria-label="Your answers"] li'),
      ).toHaveLength(3)
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

  it("leaves the Partner journey to the account-gated panel instead of rendering it itself", () => {
    renderFrame({ languageSlug: "english" })
    click("Partner with us")
    expect(
      container.querySelector('[data-testid="watch-role-journey"]'),
    ).toBeNull()
  })

  it.each(WATCH_AUDIENCE_CODE_CONFIG.roles)(
    "home: shows the compact $id line with canonical pills and no questionnaire",
    (role) => {
      act(() =>
        root.render(
          createElement(WatchHomeRoleBand, { languageSlug: "english" }),
        ),
      )
      click(role.label)
      expect(
        container.querySelector('[data-testid="watch-role-journey"]'),
      ).toBeNull()
      const pills = [
        ...container.querySelectorAll<HTMLAnchorElement>('[role="tabpanel"] a'),
      ]
      expect(pills.length).toBeGreaterThan(0)
      for (const pill of pills) {
        expect(pill.getAttribute("href")).toMatch(/^(\/|https:\/\/)/)
        expect(pill.getAttribute("title")).toBeTruthy()
      }
      const panel = container.querySelector('[role="tabpanel"]')!
      expect(panel.getAttribute("aria-labelledby")).toBe(
        container.querySelector('[role="tab"][aria-selected="true"]')!.id,
      )
    },
  )

  it("home Explore keeps the original line and three pills in order", () => {
    act(() =>
      root.render(
        createElement(WatchHomeRoleBand, { languageSlug: "english" }),
      ),
    )
    const panel = container.querySelector('[role="tabpanel"]')!
    expect(panel.querySelector("p")?.textContent).toBe(
      "New here? Start with the story of Jesus, or ask a question.",
    )
    expect(
      [...panel.querySelectorAll("a")].map((link) => [
        link.textContent,
        link.getAttribute("href"),
        link.getAttribute("target"),
      ]),
    ).toEqual([
      ["Watch the story of Jesus", "/jesus.html", null],
      [
        "Talk with a real person",
        "https://chataboutjesus.com/chat/?utm_source=jesusfilm-watch-home",
        "_blank",
      ],
      [
        "Not sure where to start?",
        "/7-days-with-jesus-walk-with-jesus.html",
        null,
      ],
    ])
    expect(panel.querySelectorAll("a svg")).toHaveLength(3)
  })

  it("goes back, edits an answer from the trail, starts over, and resets on role change", () => {
    renderFrame({ languageSlug: "english" })
    click("Just curiousSaw this and kept watching")
    expect(container.textContent).toContain("Question 2 of 3")
    click("Back")
    expect(container.textContent).toContain("Question 1 of 3")
    chooseFirstThree()
    const trail = container.querySelectorAll<HTMLButtonElement>(
      'ol[aria-label="Your answers"] button',
    )
    act(() => trail[1].click())
    expect(container.textContent).toContain("Question 2 of 3")
    expect(
      container.querySelectorAll('ol[aria-label="Your answers"] li'),
    ).toHaveLength(1)
    act(() =>
      container.querySelector<HTMLButtonElement>("[data-option-id]")!.click(),
    )
    act(() =>
      container.querySelector<HTMLButtonElement>("[data-option-id]")!.click(),
    )
    click("Start over")
    expect(container.textContent).toContain("Question 1 of 3")
    expect(container.querySelector('ol[aria-label="Your answers"]')).toBeNull()
    act(() =>
      container.querySelector<HTMLButtonElement>("[data-option-id]")!.click(),
    )
    click("Grow in faith")
    expect(container.textContent).toContain("Question 1 of 3")
    click("Explore faith")
    expect(container.textContent).toContain("Question 1 of 3")
    expect(container.querySelector('ol[aria-label="Your answers"]')).toBeNull()
  })

  it("moves focus to the next question and result after answering, without stealing role-tab focus", () => {
    renderFrame({ languageSlug: "english" })
    act(() =>
      container.querySelector<HTMLButtonElement>("[data-option-id]")!.click(),
    )
    expect(document.activeElement?.textContent).toBe(
      WATCH_AUDIENCE_CODE_CONFIG.roles[0].questions[1].prompt,
    )
    for (let i = 0; i < 2; i += 1) {
      act(() =>
        container.querySelector<HTMLButtonElement>("[data-option-id]")!.click(),
      )
    }
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

  it("recomputes the result when an answer changes and returns focus after starting over", () => {
    renderFrame({ languageSlug: "english" })
    chooseFirstThree()
    expect(resultActionId()).toBe("explore-short-films")
    const first = container.querySelector<HTMLButtonElement>(
      'ol[aria-label="Your answers"] button',
    )!
    act(() => first.click())
    click("I have real questionsAbout Jesus, God, the Bible")
    click("Show me the storyI’ll decide after I’ve seen it")
    click("An evening")
    expect(resultActionId()).toBe("explore-full-film")
    const reset = button("Start over")
    act(() => {
      reset.focus()
      reset.click()
    })
    expect(document.activeElement?.textContent).toBe(
      "Where are you starting from?",
    )
  })

  it("hydrates the reserved Explore frame without a mismatch, then shows the saved role", async () => {
    act(() => root.unmount())
    localStorage.setItem("forge.watch.role", "share")
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
      ).toBe("Share your faith")
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
    expect(resultActionId()).toBe("share-conversation-starters")
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

  it("links the next-episode action to the series' next film in the visitor's audio language", () => {
    renderFrame({
      languageSlug: "spanish",
      growFilm: {
        citations: [],
        filmTitle: "Film",
        seriesTitle: "Series",
        episodeCount: 2,
        episodeIndex: 1,
        nextEpisode: {
          title: "Day 2",
          minutes: 3,
          href: "/series.html/day-2/spanish.html" as never,
        },
      },
    })
    click("Grow in faith")
    chooseFirstThree()
    expect(resultActionId()).toBe("grow-next-episode")
    expect(
      container
        .querySelector('[data-action-id="grow-next-episode"]')
        ?.getAttribute("href"),
    ).toBe("/series.html/day-2/spanish.html")
  })

  it.each([undefined, "bad/slug", ""])(
    "does not invent English film or history links without valid language context (%s)",
    (languageSlug) => {
      renderFrame({ languageSlug })
      chooseFirstThree()
      expect(container.querySelector('a[href*=".html"]')).toBeNull()
      expect(container.textContent).toContain(
        "No next step is available on this page.",
      )
    },
  )

  it("keeps selected audio for history, labels English resources, and uses safe external anchors", () => {
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
    expect(resultActionId()).toBe("explore-short-films")
    expect(
      container.querySelector('a[href="/conversation-starters.html"]'),
    ).not.toBeNull()
    expect(container.querySelector('[data-action-id="unsafe"]')).toBeNull()
  })

  it("shows the prototype answer icon, trail and short answer for a matching choice", () => {
    renderFrame({ languageSlug: "english" })
    expect(
      container.querySelectorAll("[data-option-id] svg").length,
    ).toBeGreaterThan(0)
    click("Honestly, skepticalConvince me it’s worth my time")
    expect(container.textContent).toContain(
      "Do I need to believe anything to watch?",
    )
  })

  it("maps every default answer to its prototype icon, never the authored-id fallback", () => {
    for (const role of WATCH_AUDIENCE_CODE_CONFIG.roles) {
      const keys = role.questions.flatMap((question) =>
        question.options.map((option) => `${question.id}:${option.id}`),
      )
      expect(Object.keys(WATCH_JOURNEY_OPTION_ICONS[role.id]).sort()).toEqual(
        [...keys].sort(),
      )
    }
  })
})
