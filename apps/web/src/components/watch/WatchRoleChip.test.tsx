// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it } from "vitest"

import { WATCH_AUDIENCE_CODE_CONFIG } from "@/lib/watch-audience-config"
import { WatchHomeRoleBand } from "@/components/home/WatchHomeRoleBand"
import { WatchAudienceBlock } from "./WatchAudienceBlock"
import { WatchRoleChip } from "./WatchRoleChip"
import { useRegisterWatchAudiencePresence } from "./watch-audience-presence"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  document.documentElement.lang = "ar"
  document.documentElement.dir = "rtl"
  window.history.replaceState(null, "", "/watch")
  localStorage.clear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.documentElement.removeAttribute("lang")
  document.documentElement.removeAttribute("dir")
  localStorage.clear()
})

function Frame({
  sourceLocale = null,
  localized = false,
}: {
  sourceLocale?: string | null
  localized?: boolean
}) {
  const config = structuredClone(WATCH_AUDIENCE_CODE_CONFIG)
  if (sourceLocale === "ar" || localized) {
    config.roles[0].chip = "أنا أستكشف"
    config.roles[0].label = "استكشف الإيمان"
    config.roles[0].hint = "ابدأ هنا"
    config.roles[0].actions[0].title = "شاهد الأفلام"
  }
  useRegisterWatchAudiencePresence(
    config,
    "arabic-modern-standard",
    sourceLocale,
  )
  return createElement(
    "div",
    null,
    createElement("button", { id: "before" }, "Before"),
    createElement(WatchRoleChip),
    createElement("button", { id: "after" }, "After"),
  )
}

function render(sourceLocale: string | null = "en") {
  act(() => root.render(createElement(Frame, { sourceLocale })))
}

function trigger() {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"]',
  )!
}

function items() {
  return [...container.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
}

function key(key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  act(() => document.activeElement?.dispatchEvent(event))
  return event
}

function boundary(node: Element, lang: string, dir: string) {
  expect(node.closest("[lang]")?.getAttribute("lang")).toBe(lang)
  expect(node.closest("[dir]")?.getAttribute("dir")).toBe(dir)
}

it.each([
  ["en", "ltr", "I’m exploring"],
  ["ar", "rtl", "أنا أستكشف"],
  [null, "auto", "I’m exploring"],
])(
  "isolates %s authored copy from English menu chrome",
  (locale, dir, chip) => {
    render(locale)
    boundary(trigger(), "en", "ltr")
    boundary(trigger().querySelector("span[lang]")!, locale ?? "", dir)
    expect(trigger().querySelector("span[lang]")?.textContent).toBe(chip)
    act(() => trigger().click())
    const menu = container.querySelector('[role="menu"]')!
    boundary(menu, "en", "ltr")
    boundary(menu.querySelector("p")!, "en", "ltr")
    for (const item of items()) boundary(item, locale ?? "", dir)
    expect(items()[0].textContent).toContain(
      locale === "ar" ? "استكشف الإيمان · ابدأ هنا" : "Explore faith",
    )
    expect(items().at(-1)?.textContent).toBe(
      locale === "ar"
        ? "شاهد الأفلام"
        : WATCH_AUDIENCE_CODE_CONFIG.roles[0].actions[0].title,
    )
  },
)

it("opens at either edge and navigates every role and shortcut without selecting", () => {
  render()
  trigger().focus()
  key("ArrowDown")
  const menu = container.querySelector('[role="menu"]')!
  expect(trigger().getAttribute("aria-controls")).toBe(menu.id)
  expect(menu.getAttribute("aria-labelledby")).toBe(trigger().id)
  expect(trigger().getAttribute("aria-expanded")).toBe("true")
  const all = items()
  expect(document.activeElement).toBe(all[0])
  expect(all.every((item) => item.tabIndex === -1)).toBe(true)
  for (const [pressed, index] of [
    ["ArrowUp", all.length - 1],
    ["Home", 0],
    ["ArrowDown", 1],
    ["End", all.length - 1],
    ["ArrowDown", 0],
  ] as const) {
    expect(key(pressed).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(all[index])
  }
  expect(localStorage.getItem("forge.watch.role")).toBeNull()
  key("Escape")
  expect(document.activeElement).toBe(trigger())
  expect(items()).toHaveLength(0)
  key("ArrowUp")
  expect(document.activeElement).toBe(items().at(-1))
})

it("keeps Arabic copy neutral when provenance is missing, rather than guessing from audio", () => {
  act(() => root.render(createElement(Frame, { localized: true })))
  const selected = trigger().querySelector("span[lang]")!
  expect(selected.textContent).toBe("أنا أستكشف")
  boundary(selected, "", "auto")
  act(() => trigger().click())
  expect(items()[0].textContent).toContain("استكشف الإيمان")
  boundary(items()[0], "", "auto")
  boundary(items().at(-1)!, "", "auto")
})

it("supports character navigation without changing the selected role", () => {
  render()
  act(() => trigger().click())
  key("i")
  expect(document.activeElement).toBe(items()[1])
  key("i")
  expect(document.activeElement).toBe(items()[2])
  expect(items()[0].getAttribute("aria-checked")).toBe("true")
  expect(localStorage.getItem("forge.watch.role")).toBeNull()
})

it("restores focus after selection and Escape and exposes the checked role on reopen", () => {
  render()
  act(() => trigger().click())
  act(() => items()[2].click())
  expect(document.activeElement).toBe(trigger())
  expect(trigger().getAttribute("aria-expanded")).toBe("false")
  expect(localStorage.getItem("forge.watch.role")).toBe("share")
  act(() => trigger().click())
  expect(items().map((item) => item.getAttribute("aria-checked"))).toEqual([
    "false",
    "false",
    "true",
    "false",
    null,
  ])
  key("End")
  expect(key("Escape").defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(trigger())
  expect(items()).toHaveLength(0)
})

it.each([false, true])(
  "lets native Tab leave the closed menu (shift=%s)",
  (shift) => {
    render()
    act(() => trigger().click())
    key("End")
    expect(key("Tab", shift).defaultPrevented).toBe(false)
    expect(items()).toHaveLength(0)
    // Native Tab now proceeds from the trigger to its next/previous sibling.
    expect(document.activeElement).toBe(trigger())
  },
)

it("dismisses on outside pointer/touch or focus without stealing focus", () => {
  render()
  act(() => trigger().click())
  const after = container.querySelector<HTMLButtonElement>("#after")!
  act(() => {
    after.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    after.focus()
  })
  expect(items()).toHaveLength(0)
  expect(document.activeElement).toBe(after)
  act(() => trigger().click())
  act(() => after.focus())
  expect(items()).toHaveLength(0)
  expect(document.activeElement).toBe(after)
})

it("unregisters the chip with its frame and updates selected content provenance", () => {
  render("ar")
  render("en")
  boundary(trigger().querySelector("span[lang]")!, "en", "ltr")
  act(() => root.render(null))
  expect(container.querySelector('[data-testid="watch-role-chip"]')).toBeNull()
})

it.each(["video", "home"])(
  "carries resolved publication provenance from %s, independent of Arabic audio",
  (host) => {
    for (const sourceLocale of ["ar", "fr", "en"]) {
      const props = {
        audience: {
          kind: "authored" as const,
          config: WATCH_AUDIENCE_CODE_CONFIG,
          identity: `${sourceLocale}:header-provenance`,
          sourceLocale,
        },
        languageSlug: "arabic-modern-standard",
      }
      const frame =
        host === "video"
          ? createElement(WatchAudienceBlock, props)
          : createElement(WatchHomeRoleBand, props)
      act(() =>
        root.render(
          createElement("div", null, frame, createElement(WatchRoleChip)),
        ),
      )
      boundary(
        trigger().querySelector("span[lang]")!,
        sourceLocale,
        sourceLocale === "ar" ? "rtl" : "ltr",
      )
    }
  },
)
