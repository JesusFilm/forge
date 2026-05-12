/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LanguageCombobox } from "@/components/watch/LanguageCombobox"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null
}

function $$(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector)) as HTMLElement[]
}

const OPTIONS = [
  { slug: "english", name: "English" },
  { slug: "spanish", name: "Spanish" },
  { slug: "french", name: "French" },
  { slug: "german", name: "German" },
]

describe("LanguageCombobox", () => {
  it("renders the currently selected option label in the trigger", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="spanish"
          onChange={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="language-combobox-trigger"]')?.textContent).toMatch(
      /Spanish/,
    )
  })

  it("opens the popover on trigger click", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="spanish"
          onChange={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    expect($('[data-testid="language-combobox-popover"]')).not.toBeNull()
  })

  it("filters the list as the user types (case-insensitive)", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="spanish"
          onChange={vi.fn()}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.value = "spA"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const items = $$('[data-testid="language-combobox-option"]')
    expect(items.map((el) => el.textContent)).toEqual(["Spanish"])
  })

  it("calls onChange and closes the popover when an option is clicked", () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="spanish"
          onChange={onChange}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const french = $$('[data-testid="language-combobox-option"]').find((el) =>
      el.textContent?.includes("French"),
    )!
    act(() => {
      french.click()
    })

    expect(onChange).toHaveBeenCalledWith("french")
    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
  })

  it("Down arrow + Enter selects the highlighted option", () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="english"
          onChange={onChange}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    })

    expect(onChange).toHaveBeenCalledWith("spanish")
  })

  it("Escape closes the popover without calling onChange", () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="english"
          onChange={onChange}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
    })

    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("clicking outside the popover closes it", () => {
    act(() => {
      root.render(
        <div>
          <LanguageCombobox
            options={OPTIONS}
            value="english"
            onChange={vi.fn()}
          />
          <div data-testid="outside" style={{ height: 10 }} />
        </div>,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    expect($('[data-testid="language-combobox-popover"]')).not.toBeNull()

    act(() => {
      $('[data-testid="outside"]')?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      )
    })

    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
  })
})
