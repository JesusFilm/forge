// @vitest-environment jsdom
import {
  act,
  createElement,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WatchHomeRoleBand } from "@/components/home/WatchHomeRoleBand"
import {
  WATCH_AUDIENCE_CODE_CONFIG,
  rankWatchAudienceActions,
  type WatchAudienceConfig,
  type WatchAudienceResolution,
} from "@/lib/watch-audience-config"
import { setWatchRole } from "./watch-role"
import {
  WatchAudienceBlock,
  type WatchAudienceBlockProps,
} from "./WatchAudienceBlock"

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

const clone = (): WatchAudienceConfig =>
  structuredClone(WATCH_AUDIENCE_CODE_CONFIG)

function authored(
  config: WatchAudienceConfig,
  identity = "en:watch-audience:v1",
): Extract<WatchAudienceResolution, { kind: "authored" }> {
  return { kind: "authored", config, identity, sourceLocale: "en" }
}

function render(props: WatchAudienceBlockProps) {
  act(() => root.render(createElement(WatchAudienceBlock, props)))
}

function chooseOptions(count = 3, index = 0) {
  for (let i = 0; i < count; i += 1) {
    const option =
      container.querySelectorAll<HTMLButtonElement>("[data-option-id]")[index]
    expect(option, `option ${index} at question ${i + 1}`).toBeDefined()
    act(() => option.click())
  }
}

const frames = () =>
  container.querySelectorAll('[data-testid="watch-next-steps"]')
const resultId = () =>
  container
    .querySelector('[data-testid="watch-journey-result"] [data-action-id]')
    ?.getAttribute("data-action-id")

describe("WatchAudienceBlock", () => {
  it("renders the authored configuration through the one common frame", () => {
    const config = clone()
    config.roles[0].label = "Authored explorer"
    config.roles[0].questions[0].prompt = "Authored first question?"
    render({ audience: authored(config), languageSlug: "english" })

    expect(frames()).toHaveLength(1)
    const tabs = [...container.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.textContent,
    )
    expect(tabs[0]).toContain("Authored explorer")
    expect(container.textContent).toContain("Authored first question?")
    expect(container.textContent).not.toContain(
      WATCH_AUDIENCE_CODE_CONFIG.roles[0].questions[0].prompt,
    )
  })

  it("keeps the temporary code definitions only while nothing is authored", () => {
    for (const audience of [undefined, { kind: "absent" } as const]) {
      render({ audience, languageSlug: "english" })
      expect(container.textContent).toContain(
        WATCH_AUDIENCE_CODE_CONFIG.roles[0].questions[0].prompt,
      )
    }
  })

  it.each([
    ["rejected", { kind: "rejected" } as const],
    ["unavailable", { kind: "unavailable" } as const],
  ])(
    "omits the frame for a %s authored configuration instead of showing the baked-in questions",
    (_label, audience) => {
      render({ audience, languageSlug: "english" })
      expect(container.innerHTML).toBe("")
    },
  )

  it("omits the home band entirely, container included, for a rejected configuration", () => {
    act(() =>
      root.render(
        createElement(WatchHomeRoleBand, {
          audience: { kind: "rejected" },
          languageSlug: "english",
        }),
      ),
    )
    expect(container.innerHTML).toBe("")
  })

  it("the home band uses the authored role labels with its own static navigation", () => {
    const config = clone()
    config.roles[0].label = "Authored explore"
    config.roles[0].actions[0].title = "Shared on home and video?"
    act(() =>
      root.render(
        createElement(WatchHomeRoleBand, {
          audience: authored(config),
          languageSlug: "english",
        }),
      ),
    )
    expect(
      container.querySelector('[data-testid="watch-home-role-band"]'),
    ).not.toBeNull()
    // Authored roles label the tabs; the home pills are the prototype's
    // static role navigation, separate from the video questionnaire.
    expect(container.textContent).toContain("Authored explore")
    expect(container.textContent).not.toContain("Shared on home and video?")
    expect(container.textContent).toContain("Watch the story of Jesus")
  })

  it("applies authored weights and order, and resets answers when the configuration changes", () => {
    const first = clone()
    render({ audience: authored(first, "en:k:1"), languageSlug: "english" })
    chooseOptions(3, 2)
    const before = resultId()
    expect(before).toBeTruthy()

    // Same ids, different authored order and weights: a different top action.
    const second = clone()
    const explore = second.roles.find((role) => role.id === "explore")!
    for (const question of explore.questions) {
      for (const option of question.options) {
        for (const score of option.scores) {
          score.weight = score.actionId === before ? 1 : 10
        }
      }
    }
    render({ audience: authored(second, "en:k:2"), languageSlug: "english" })

    // Remounted: the earlier answers are gone, not replayed on the new ids.
    expect(container.textContent).toContain("Question 1 of 3")
    expect(resultId()).toBeUndefined()
    expect(container.querySelector('ol[aria-label="Your answers"]')).toBeNull()

    chooseOptions(3, 2)
    const expected = rankWatchAudienceActions(
      explore,
      explore.questions.map((question) => question.options[2].id),
    ).find(({ action }) => action.target.kind !== "current-video")!.action.id
    expect(resultId()).toBe(expected)
    expect(resultId()).not.toBe(before)
  })

  it("keeps the same frame, and its answers, while the configuration is unchanged", () => {
    const config = clone()
    render({ audience: authored(config, "en:k:1"), languageSlug: "english" })
    chooseOptions(1)
    render({
      audience: authored(structuredClone(config), "en:k:1"),
      languageSlug: "english",
    })
    expect(container.textContent).toContain("Question 2 of 3")
  })

  it("keeps the visitor's saved role across a configuration change", () => {
    setWatchRole("share")
    render({ audience: authored(clone(), "en:k:1"), languageSlug: "english" })
    const selected = () =>
      container
        .querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent?.trim()
    const role = selected()
    expect(role).toContain("Share")
    const changed = clone()
    changed.roles[0].lead = "A changed lead."
    render({ audience: authored(changed, "en:k:2"), languageSlug: "english" })
    expect(selected()).toBe(role)
  })

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["protocol-relative", "//evil.example/x"],
    ["control character", "https://example.com/\u0001"],
    ["malformed", "not a url"],
    ["http", "http://example.com/"],
  ])(
    "omits a stored %s destination at render even if it bypassed the validator",
    (_label, url) => {
      const config = clone()
      const explore = config.roles.find((role) => role.id === "explore")!
      explore.actions[0] = {
        ...explore.actions[0],
        target: { kind: "resource", url },
      }
      render({ audience: authored(config), languageSlug: "english" })
      chooseOptions()
      expect(container.querySelector('a[href^="javascript"]')).toBeNull()
      expect(container.querySelector('a[href^="//"]')).toBeNull()
      expect(container.querySelector('a[href^="http:"]')).toBeNull()
      expect(container.innerHTML).not.toContain("evil.example")
      expect(container.innerHTML).not.toContain("alert(1)")
      expect(resultId()).not.toBe(explore.actions[0].id)
    },
  )

  it("does not crash when removing the actions this surface can serve", () => {
    const config = clone()
    const explore = config.roles.find((role) => role.id === "explore")!
    // Only controls that exist on a video page: none are served on home.
    explore.actions = explore.actions.slice(0, 1).map((action) => ({
      ...action,
      target: { kind: "current-video" as const, target: "share" as const },
    }))
    for (const question of explore.questions) {
      for (const option of question.options) {
        option.scores = option.scores.filter(
          (score) => score.actionId === explore.actions[0].id,
        )
      }
    }
    render({ audience: authored(config), languageSlug: "english" })
    chooseOptions()
    expect(container.textContent).toContain("No next step is available")
    expect(frames()).toHaveLength(1)
  })
})

describe("published questionnaire language boundaries", () => {
  it.each([
    ["ar", "rtl", "من أين تبدأ؟", "استكشف الإيمان"],
    ["fr", "ltr", "Par où commencer ?", "Explorer la foi"],
  ])(
    "declares authored %s copy in its resolved language and direction",
    (sourceLocale, direction, prompt, label) => {
      const config = clone()
      config.roles[0].questions[0].prompt = prompt
      config.roles[0].label = label
      const audience = { ...authored(config), sourceLocale }
      render({ audience, languageSlug: "arabic", locale: "ar" })
      const question = [...container.querySelectorAll("h3")].find(
        (node) => node.textContent === prompt,
      )!
      const tab = [...container.querySelectorAll('[role="tab"]')].find(
        (node) => node.textContent === label,
      )!
      for (const element of [question, tab]) {
        expect(element.closest("[lang]")?.getAttribute("lang")).toBe(
          sourceLocale,
        )
        expect(element.closest("[dir]")?.getAttribute("dir")).toBe(direction)
      }
      expect(question.textContent).toBe(prompt)
    },
  )

  it("keeps code and published-English fallback explicitly English on an Arabic page", () => {
    for (const audience of [
      { kind: "absent" } as const,
      { ...authored(clone()), sourceLocale: "en" },
    ]) {
      render({ audience, languageSlug: "arabic", locale: "ar" })
      const question = container.querySelector("h3")!
      expect(question.closest("[lang]")?.getAttribute("lang")).toBe("en")
      expect(question.closest("[dir]")?.getAttribute("dir")).toBe("ltr")
    }
  })
})

it("keeps English resource notices and renderer controls outside authored Arabic semantics", () => {
  const config = clone()
  config.roles[0].questions[0].prompt = "من أين تبدأ؟"
  render({
    audience: { ...authored(config), sourceLocale: "ar" },
    languageSlug: "arabic",
    locale: "ar",
  })
  const notice = [...container.querySelectorAll("p")].find(
    (p) => p.textContent === "English resources",
  )!
  expect(notice.lang).toBe("en")
  expect(notice.dir).toBe("ltr")
  const progress = [...container.querySelectorAll("p")].find(
    (p) => p.textContent === "Question 1 of 3",
  )!
  expect(progress.lang).toBe("en")
  chooseOptions(1)
  const back = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Back",
  )!
  expect(back.lang).toBe("en")
  expect(back.dir).toBe("ltr")
})

it("renders English sharing resources beside an Arabic authored journey", async () => {
  setWatchRole("share")
  const config = clone()
  config.roles[2].questions[0].prompt = "مع من تشارك؟"
  await act(async () => {
    root.render(
      createElement(WatchAudienceBlock, {
        audience: {
          kind: "authored",
          config,
          identity: "ar:mixed",
          sourceLocale: "ar",
        },
        languageSlug: "arabic",
        locale: "ar",
      }),
    )
  })
  await act(async () => {
    await import("./WatchShareIdeas")
  })
  const resources = container.querySelector(
    '[data-testid="watch-share-ideas"]',
  )!
  expect(resources.closest("[lang]")?.getAttribute("lang")).toBe("en")
  expect(resources.closest("[dir]")?.getAttribute("dir")).toBe("ltr")
  const question = container.querySelector("h3")!
  expect(question.textContent).toBe("مع من تشارك؟")
  expect(question.closest("[lang]")?.getAttribute("lang")).toBe("ar")
  expect(question.closest("[dir]")?.getAttribute("dir")).toBe("rtl")
})
