// @vitest-environment jsdom
import { act, createElement, type AnchorHTMLAttributes } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { WatchHomeRoleBand } from "@/components/home/WatchHomeRoleBand"
import { arabicAudienceFixture } from "@/test/fixtures/watch-audience-arabic"
import { WatchAudienceBlock } from "./WatchAudienceBlock"
import { WatchRoleTabs } from "./WatchRoleTabs"

vi.mock("next/link", () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) =>
    createElement("a", props),
}))

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, "", "/watch")
  document.documentElement.lang = "ar"
  document.documentElement.dir = "rtl"
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  localStorage.clear()
  document.documentElement.removeAttribute("lang")
  document.documentElement.removeAttribute("dir")
})

function boundary(node: Element | null, lang: string, dir: string) {
  expect(node, "rendered semantic boundary").toBeInstanceOf(HTMLElement)
  expect(node?.closest("[lang]")?.getAttribute("lang")).toBe(lang)
  expect(node?.closest("[dir]")?.getAttribute("dir")).toBe(dir)
}

for (const surface of ["home", "video"] as const) {
  it(`${surface}: separates English metadata from fully Arabic authored content`, () => {
    const config = arabicAudienceFixture()
    const audience = {
      kind: "authored" as const,
      sourceLocale: "ar",
      identity: "ar:round-9",
      config,
    }
    act(() =>
      root.render(
        surface === "home"
          ? createElement(WatchHomeRoleBand, {
              audience,
              languageSlug: "arabic-modern-standard",
            })
          : createElement(WatchAudienceBlock, {
              audience,
              languageSlug: "arabic-modern-standard",
              locale: "ar",
            }),
      ),
    )
    const tabs = host.querySelector(
      '[role="tablist"][aria-label="Who is this for"]',
    )
    boundary(tabs, "en", "ltr")
    boundary(tabs?.firstElementChild ?? null, "ar", "rtl")
    for (const tab of host.querySelectorAll('[role="tab"]')) {
      boundary(tab, "ar", "rtl")
      expect(tab.textContent).toMatch(/الجمهور/)
    }
    if (surface === "home") {
      expect(
        host.querySelector('[data-testid="watch-role-journey"]'),
      ).toBeNull()
      boundary(
        host.querySelector('[data-testid="watch-home-role-band"]'),
        "en",
        "ltr",
      )
      return
    }
    const role = config.roles[0]
    const heading = () =>
      [...host.querySelectorAll("h3")].find(
        (node) =>
          node.textContent ===
          role.questions[
            Number(
              host
                .querySelector('[data-testid="watch-role-journey"]')
                ?.getAttribute("data-step"),
            )
          ]?.prompt,
      )
    const answer = () => {
      const option = host.querySelector<HTMLButtonElement>(
        "button[data-option-id]",
      )
      expect(option).toBeInstanceOf(HTMLButtonElement)
      boundary(option, "ar", "rtl")
      act(() => option!.click())
    }
    boundary(heading() ?? null, "ar", "rtl")
    answer()
    const trail = host.querySelector('ol[aria-label="Your answers"]')
    boundary(trail, "en", "ltr")
    const edit =
      trail?.querySelector<HTMLButtonElement>(
        'button[title="Change this answer"]',
      ) ?? null
    boundary(edit, "en", "ltr")
    const label = [...(edit?.querySelectorAll("span") ?? [])].find(
      (node) => node.textContent === role.questions[0].options[0].label,
    )
    boundary(label ?? null, "ar", "rtl")
    expect(document.activeElement).toBe(heading())
    act(() => edit!.click())
    expect(host.querySelector('ol[aria-label="Your answers"]')).toBeNull()
    expect(document.activeElement).toBe(heading())
    for (let i = 0; i < 3; i++) answer()
    const reset = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent?.trim() === "Start over",
    )
    boundary(reset ?? null, "en", "ltr")
    act(() => reset!.click())
    expect(host.querySelector('ol[aria-label="Your answers"]')).toBeNull()
    boundary(heading() ?? null, "ar", "rtl")
    expect(document.activeElement).toBe(heading())
  })
}

// A future translated group name must declare its own language rather than
// being forced into the renderer's English default. Configuration fallback
// remains English even on an Arabic document.
it("keeps a translated group name and English fallback roles independent", () => {
  act(() =>
    root.render(
      createElement(WatchRoleTabs, {
        idBase: "translated",
        label: "لمن هذا؟",
        labelLocale: "ar",
      }),
    ),
  )
  boundary(host.querySelector('[role="tablist"]'), "ar", "rtl")
  for (const tab of host.querySelectorAll('[role="tab"]'))
    boundary(tab, "en", "ltr")
})
