/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  TIER_LISTBOX_ANIMATION_MS,
  TierListbox,
  type TierListboxProps,
} from "@/components/watch/TierListbox"
import type { DownloadTier } from "@/components/watch/download-options"

let container: HTMLDivElement
let root: Root

const LABELS: Record<DownloadTier, string> = {
  highest: "Highest",
  high: "High",
  low: "Low",
}

function renderListbox(overrides: Partial<TierListboxProps> = {}) {
  const props: TierListboxProps = {
    tiers: ["highest", "high", "low"],
    value: "highest",
    onChange: vi.fn(),
    getLabel: (tier) => LABELS[tier],
    placeholder: "Video quality",
    labelledBy: "quality-label",
    testIdPrefix: "tier-listbox",
    ...overrides,
  }
  act(() => {
    root.render(
      <div>
        <span id="quality-label">Video quality</span>
        <TierListbox {...props} />
      </div>,
    )
  })
  return props
}

function trigger(): HTMLButtonElement {
  return document.querySelector(
    '[data-testid="tier-listbox"]',
  ) as HTMLButtonElement
}

function list(): HTMLElement | null {
  return document.querySelector('[data-testid="tier-listbox-list"]')
}

function options(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll('[data-testid="tier-listbox-option"]'),
  ) as HTMLButtonElement[]
}

function press(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    )
  })
}

function pointerDown(target: Element) {
  // jsdom has no PointerEvent constructor; the handler only reads `target`.
  act(() => {
    target.dispatchEvent(new Event("pointerdown", { bubbles: true }))
  })
}

function click(target: HTMLElement) {
  act(() => {
    target.click()
  })
}

async function settleAnimation() {
  await act(async () => {
    await new Promise((resolve) =>
      setTimeout(resolve, TIER_LISTBOX_ANIMATION_MS + 40),
    )
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("TierListbox", () => {
  it("renders the selected tier label on a closed trigger", () => {
    renderListbox()

    const button = trigger()
    expect(button.textContent).toContain("Highest")
    expect(button.getAttribute("aria-expanded")).toBe("false")
    expect(button.getAttribute("aria-haspopup")).toBe("listbox")
    expect(list()).toBeNull()
  })

  it("renders the placeholder and selects nothing when value is null", () => {
    const getLabel = vi.fn((tier: DownloadTier) => LABELS[tier])
    renderListbox({ value: null, getLabel })

    expect(trigger().textContent).toContain("Video quality")
    expect(getLabel).not.toHaveBeenCalledWith(null)

    click(trigger())

    expect(
      options().filter(
        (option) => option.getAttribute("aria-selected") === "true",
      ),
    ).toHaveLength(0)
  })

  it("lists every tier in order and marks the current value selected", () => {
    renderListbox({ value: "high" })

    click(trigger())

    expect(trigger().getAttribute("aria-expanded")).toBe("true")
    expect(options().map((option) => option.getAttribute("data-tier"))).toEqual(
      ["highest", "high", "low"],
    )
    expect(
      options().map((option) => option.getAttribute("aria-selected")),
    ).toEqual(["false", "true", "false"])
    expect(list()?.getAttribute("aria-labelledby")).toBe("quality-label")
    expect(trigger().getAttribute("aria-labelledby")).toBe("quality-label")
  })

  it("selects a clicked option, closes, and keeps focus on the trigger", async () => {
    const { onChange } = renderListbox()

    click(trigger())
    const low = options().find(
      (option) => option.getAttribute("data-tier") === "low",
    ) as HTMLButtonElement
    click(low)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("low")
    expect(list()?.getAttribute("data-open")).toBe("false")
    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(trigger())

    await settleAnimation()
    expect(list()).toBeNull()
  })

  it("supports arrow, Home/End, Enter, and Space keyboard operation", () => {
    const { onChange } = renderListbox({ value: "highest" })
    const button = trigger()
    button.focus()

    press(button, "ArrowDown")
    expect(button.getAttribute("aria-expanded")).toBe("true")
    const optionIdFor = (tier: DownloadTier) =>
      options()
        .find((option) => option.getAttribute("data-tier") === tier)
        ?.getAttribute("id")
    expect(button.getAttribute("aria-activedescendant")).toBe(
      optionIdFor("highest"),
    )

    press(button, "ArrowDown")
    press(button, "ArrowDown")
    expect(button.getAttribute("aria-activedescendant")).toBe(
      optionIdFor("low"),
    )

    press(button, "Home")
    expect(button.getAttribute("aria-activedescendant")).toBe(
      optionIdFor("highest"),
    )
    press(button, "End")
    expect(button.getAttribute("aria-activedescendant")).toBe(
      optionIdFor("low"),
    )
    press(button, "ArrowUp")
    expect(button.getAttribute("aria-activedescendant")).toBe(
      optionIdFor("high"),
    )
    expect(document.activeElement).toBe(button)

    press(button, "Enter")
    expect(onChange).toHaveBeenLastCalledWith("high")
    expect(button.getAttribute("aria-expanded")).toBe("false")
    expect(button.hasAttribute("aria-activedescendant")).toBe(false)

    press(button, "ArrowUp")
    press(button, "ArrowDown")
    press(button, "ArrowDown")
    press(button, " ")
    expect(onChange).toHaveBeenLastCalledWith("low")
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it("closes on Escape without letting it reach bubble-phase document listeners", () => {
    renderListbox()
    const dialogEscape = vi.fn()
    document.addEventListener("keydown", dialogEscape)

    click(trigger())
    press(trigger(), "Escape")

    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(dialogEscape).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger())

    document.removeEventListener("keydown", dialogEscape)
  })

  it("closes on an outside pointerdown but not one inside the list", () => {
    renderListbox()

    click(trigger())
    pointerDown(list() as HTMLElement)
    expect(trigger().getAttribute("aria-expanded")).toBe("true")

    pointerDown(document.body)
    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(trigger())
  })

  it("does not open while disabled", () => {
    renderListbox({ disabled: true })

    expect(trigger().disabled).toBe(true)
    click(trigger())
    press(trigger(), "ArrowDown")
    expect(list()).toBeNull()
  })

  it("renders without a selection when value is not among the tiers", () => {
    renderListbox({ tiers: ["highest", "low"], value: "high" })

    click(trigger())
    expect(options()).toHaveLength(2)
    expect(
      options().filter(
        (option) => option.getAttribute("aria-selected") === "true",
      ),
    ).toHaveLength(0)
  })

  it("merges trigger class overrides instead of concatenating them", () => {
    renderListbox({ triggerClassName: "px-4 rounded-xl" })

    const className = trigger().className
    expect(className).toContain("px-4")
    expect(className).not.toContain("px-5")
    expect(className).toContain("rounded-xl")
    expect(className).not.toContain("rounded-2xl")
  })
})
