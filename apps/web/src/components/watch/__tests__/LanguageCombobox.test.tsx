/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react"
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

const MANY_OPTIONS = Array.from({ length: 200 }, (_, index) => ({
  slug: `language-${index}`,
  name: `Language ${String(index).padStart(3, "0")}`,
}))
const OPTION_SCROLL_TOP_FOR_TEST = 7200

function makeRect({
  bottom = 0,
  height = 0,
  left = 0,
  right = 0,
  top = 0,
  width = 0,
}: Partial<DOMRect> = {}): DOMRect {
  return {
    bottom,
    height,
    left,
    right,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

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

  it("uses the production dark rounded trigger styling", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="spanish"
          onChange={vi.fn()}
        />,
      )
    })

    const trigger = $('[data-testid="language-combobox-trigger"]')
    expect(trigger?.className).toContain("rounded-2xl")
    expect(trigger?.className).toContain("bg-white/5")
    expect(trigger?.className).toContain("px-5")
    expect(trigger?.className).toContain("py-3")
    expect(trigger?.className).toContain("text-base")
    expect(trigger?.className).toContain("min-h-16")
  })

  it("can render a compact trigger for modal surfaces", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="spanish"
          onChange={vi.fn()}
          compact
        />,
      )
    })

    const trigger = $('[data-testid="language-combobox-trigger"]')
    expect(trigger?.className).toContain("rounded-xl")
    expect(trigger?.className).toContain("px-4")
    expect(trigger?.className).toContain("py-2.5")
    expect(trigger?.className).toContain("text-sm")
    expect(trigger?.className).toContain("min-h-12")
    expect(trigger?.className).not.toContain("rounded-2xl")
    expect(trigger?.className).not.toContain("min-h-16")

    const triggerCode = $(
      '[data-testid="language-combobox-trigger"] [data-testid="language-combobox-option-code"]',
    )
    expect(triggerCode?.className).toContain("size-7")
    expect(triggerCode?.className).not.toContain("size-8")
  })

  it("uses a dark translucent selected option state", () => {
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

    const selectedOption = $$('[data-testid="language-combobox-option"]').find(
      (option) => option.getAttribute("data-language-slug") === "spanish",
    )
    expect(selectedOption?.className).toContain("bg-white/[0.08]")
    expect(selectedOption?.className).toContain("hover:bg-white/[0.12]")
    expect(selectedOption?.className).not.toContain("bg-brand-red")
  })

  it("keeps the search input regular weight", () => {
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

    const search = $('[data-testid="language-combobox-search"]')
    expect(search?.className).toContain("font-normal")
    expect(search?.className).not.toContain("font-semibold")
  })

  it("can render as a disabled subtitles selector with fallback copy", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={[]}
          value=""
          onChange={vi.fn()}
          icon="subtitles"
          disabled
          placeholder="No subtitles"
        />,
      )
    })

    const trigger = $(
      '[data-testid="language-combobox-trigger"]',
    ) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    expect(trigger.textContent).toContain("No subtitles")
    act(() => {
      trigger.click()
    })
    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
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

  it("opens upward when the trigger is too close to the viewport bottom", () => {
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRectMock(this: HTMLElement) {
        if (this.getAttribute("data-testid") === "language-combobox-trigger") {
          return makeRect({
            bottom: 714,
            height: 64,
            right: 400,
            top: 650,
            width: 400,
          })
        }
        if (
          this === $('[data-testid="language-combobox-search"]')?.parentElement
        ) {
          return makeRect({ bottom: 65, height: 65, right: 400, width: 400 })
        }
        return makeRect()
      },
    )

    try {
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

      const popover = $('[data-testid="language-combobox-popover"]')
      const listbox = $('[role="listbox"]') as HTMLUListElement
      expect(popover?.getAttribute("data-placement")).toBe("above")
      expect(popover?.className).toContain("fixed")
      expect(popover?.className).toContain("z-[1000]")
      expect(listbox.style.maxHeight).toBe("288px")
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      })
    }
  })

  it("caps the scrollable listbox when the popover must open in limited space", () => {
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 220,
    })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRectMock(this: HTMLElement) {
        if (this.getAttribute("data-testid") === "language-combobox-trigger") {
          return makeRect({
            bottom: 74,
            height: 64,
            right: 400,
            top: 10,
            width: 400,
          })
        }
        if (
          this === $('[data-testid="language-combobox-search"]')?.parentElement
        ) {
          return makeRect({ bottom: 65, height: 65, right: 400, width: 400 })
        }
        return makeRect()
      },
    )

    try {
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

      const popover = $('[data-testid="language-combobox-popover"]')
      const listbox = $('[role="listbox"]') as HTMLUListElement
      expect(popover?.getAttribute("data-placement")).toBe("below")
      expect(popover?.className).toContain("fixed")
      expect(listbox.style.maxHeight).toBe("49px")
      expect(listbox.className).toContain("overflow-y-auto")
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      })
    }
  })

  it("uses the keyboard-adjusted visual viewport to place and size the popover", () => {
    const originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    )
    const visualViewport = Object.assign(new EventTarget(), {
      height: 360,
      offsetTop: 120,
    }) as VisualViewport
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRectMock(this: HTMLElement) {
        if (this.getAttribute("data-testid") === "language-combobox-trigger") {
          return makeRect({
            bottom: 416,
            height: 56,
            left: 20,
            right: 380,
            top: 360,
            width: 360,
          })
        }
        if (
          this === $('[data-testid="language-combobox-search"]')?.parentElement
        ) {
          return makeRect({ bottom: 65, height: 65, right: 360, width: 360 })
        }
        return makeRect()
      },
    )

    try {
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

      const popover = $('[data-testid="language-combobox-popover"]')
      const listbox = $('[role="listbox"]') as HTMLUListElement
      expect(popover?.getAttribute("data-placement")).toBe("above")
      expect(popover?.style.top).toBe("144px")
      expect(listbox.style.maxHeight).toBe("143px")
    } finally {
      if (originalVisualViewport) {
        Object.defineProperty(window, "visualViewport", originalVisualViewport)
      } else {
        Reflect.deleteProperty(window, "visualViewport")
      }
    }
  })

  it("recalculates open popover geometry when the visual viewport changes", () => {
    const originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    )
    const visualViewport = Object.assign(new EventTarget(), {
      height: 800,
      offsetTop: 0,
    }) as VisualViewport
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRectMock(this: HTMLElement) {
        if (this.getAttribute("data-testid") === "language-combobox-trigger") {
          return makeRect({
            bottom: 356,
            height: 56,
            left: 20,
            right: 380,
            top: 300,
            width: 360,
          })
        }
        if (
          this === $('[data-testid="language-combobox-search"]')?.parentElement
        ) {
          return makeRect({ bottom: 65, height: 65, right: 360, width: 360 })
        }
        return makeRect()
      },
    )

    try {
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

      const popover = $('[data-testid="language-combobox-popover"]')
      const listbox = $('[role="listbox"]') as HTMLUListElement
      expect(popover?.getAttribute("data-placement")).toBe("below")
      expect(popover?.style.top).toBe("364px")
      expect(listbox.style.maxHeight).toBe("288px")

      act(() => {
        Object.assign(visualViewport, { height: 400 })
        visualViewport.dispatchEvent(new Event("resize"))
      })
      expect(popover?.getAttribute("data-placement")).toBe("above")
      expect(popover?.style.top).toBe("24px")
      expect(listbox.style.maxHeight).toBe("203px")

      act(() => {
        Object.assign(visualViewport, { offsetTop: 100 })
        visualViewport.dispatchEvent(new Event("scroll"))
      })
      expect(popover?.style.top).toBe("124px")
      expect(listbox.style.maxHeight).toBe("103px")
    } finally {
      if (originalVisualViewport) {
        Object.defineProperty(window, "visualViewport", originalVisualViewport)
      } else {
        Reflect.deleteProperty(window, "visualViewport")
      }
    }
  })

  it("recalculates from window.innerHeight when visualViewport is unavailable", () => {
    const originalInnerHeight = window.innerHeight
    const originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    )
    Reflect.deleteProperty(window, "visualViewport")
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRectMock(this: HTMLElement) {
        if (this.getAttribute("data-testid") === "language-combobox-trigger") {
          return makeRect({
            bottom: 356,
            height: 56,
            left: 20,
            right: 380,
            top: 300,
            width: 360,
          })
        }
        if (
          this === $('[data-testid="language-combobox-search"]')?.parentElement
        ) {
          return makeRect({ bottom: 65, height: 65, right: 360, width: 360 })
        }
        return makeRect()
      },
    )

    try {
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

      const popover = $('[data-testid="language-combobox-popover"]')
      const listbox = $('[role="listbox"]') as HTMLUListElement
      expect(popover?.getAttribute("data-placement")).toBe("below")
      expect(listbox.style.maxHeight).toBe("288px")

      act(() => {
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          value: 400,
        })
        window.dispatchEvent(new Event("resize"))
      })
      expect(popover?.getAttribute("data-placement")).toBe("above")
      expect(popover?.style.top).toBe("24px")
      expect(listbox.style.maxHeight).toBe("203px")
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      })
      if (originalVisualViewport) {
        Object.defineProperty(window, "visualViewport", originalVisualViewport)
      }
    }
  })

  it("allows callers to wrap the trigger without wrapping the open popover", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="spanish"
          onChange={vi.fn()}
          triggerWrapper={(trigger) => (
            <div data-testid="language-combobox-trigger-wrapper">{trigger}</div>
          )}
        />,
      )
    })

    const wrapper = $('[data-testid="language-combobox-trigger-wrapper"]')
    const trigger = $('[data-testid="language-combobox-trigger"]')
    expect(wrapper?.contains(trigger)).toBe(true)

    act(() => {
      trigger?.click()
    })

    const popover = $('[data-testid="language-combobox-popover"]')
    expect(popover).not.toBeNull()
    expect(wrapper?.contains(popover)).toBe(false)
  })

  it("supports controlled open state", () => {
    function ControlledCombobox() {
      const [open, setOpen] = useState(false)
      return (
        <div>
          <button
            type="button"
            data-testid="external-close"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
          <LanguageCombobox
            options={OPTIONS}
            value="spanish"
            onChange={vi.fn()}
            open={open}
            onOpenChange={setOpen}
          />
        </div>
      )
    }

    act(() => {
      root.render(<ControlledCombobox />)
    })

    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })
    expect($('[data-testid="language-combobox-popover"]')).not.toBeNull()
    act(() => {
      $('[data-testid="external-close"]')?.click()
    })
    expect($('[data-testid="language-combobox-popover"]')).toBeNull()
  })

  it("windows large option sets on open so the popover appears immediately", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={MANY_OPTIONS}
          value="language-0"
          onChange={vi.fn()}
        />,
      )
    })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const listbox = $('[role="listbox"]')
    const items = $$('[data-testid="language-combobox-option"]')
    expect(listbox?.getAttribute("data-virtualized")).toBe("true")
    expect(items.length).toBeLessThan(20)
    expect(items[0]?.getAttribute("aria-setsize")).toBe("200")
    expect(items[0]?.getAttribute("aria-posinset")).toBe("1")
    expect(
      items.some((item) => item.textContent?.includes("Language 199")),
    ).toBe(false)
  })

  it("renders the first window after scrolling back to the top even if a lower option was active", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={MANY_OPTIONS}
          value="language-0"
          onChange={vi.fn()}
        />,
      )
    })

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const listbox = $('[role="listbox"]') as HTMLUListElement
    act(() => {
      listbox.scrollTop = OPTION_SCROLL_TOP_FOR_TEST
      listbox.dispatchEvent(new Event("scroll", { bubbles: true }))
    })

    const lowerItems = $$('[data-testid="language-combobox-option"]')
    expect(lowerItems[0]?.getAttribute("aria-posinset")).not.toBe("1")

    act(() => {
      lowerItems[0]?.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true }),
      )
    })
    act(() => {
      listbox.scrollTop = 0
      listbox.dispatchEvent(new Event("scroll", { bubbles: true }))
    })

    const topItems = $$('[data-testid="language-combobox-option"]')
    expect(topItems[0]?.getAttribute("aria-posinset")).toBe("1")
    expect(topItems[0]?.getAttribute("data-language-slug")).toBe("language-0")
  })

  it("searches the full large option set even when only the first window is mounted", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={MANY_OPTIONS}
          value="language-0"
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
      input.value = "Language 199"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const items = $$('[data-testid="language-combobox-option"]')
    expect($('[role="listbox"]')?.getAttribute("data-virtualized")).toBe(
      "false",
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.getAttribute("data-language-slug")).toBe("language-199")
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
    expect(items).toHaveLength(1)
    expect(items[0]?.textContent).toContain("Spanish")
  })

  it("ranks label-prefix matches before word-prefix and substring matches", () => {
    const OPTIONS_WITH_RUSSIAN = [
      { slug: "belorussian", name: "Belorussian" },
      { slug: "buriat-russia", name: "Buriat, Russia" },
      { slug: "central-asian-russian", name: "Central Asian Russian" },
      { slug: "russian", name: "Russian" },
    ]

    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_RUSSIAN}
          value="central-asian-russian"
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
      input.value = "russi"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const items = $$('[data-testid="language-combobox-option"]')
    expect(
      items.map((item) => item.getAttribute("data-language-slug")),
    ).toEqual([
      "russian",
      "buriat-russia",
      "central-asian-russian",
      "belorussian",
    ])
    expect(items[0]?.getAttribute("aria-selected")).toBe("false")
    expect(items[2]?.getAttribute("aria-selected")).toBe("true")
  })

  it("keeps the original option order for empty searches", () => {
    const UNSORTED_OPTIONS = [
      { slug: "zulu", name: "Zulu" },
      { slug: "english", name: "English" },
      { slug: "arabic", name: "Arabic" },
    ]

    act(() => {
      root.render(
        <LanguageCombobox
          options={UNSORTED_OPTIONS}
          value="english"
          onChange={vi.fn()}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const items = $$('[data-testid="language-combobox-option"]')
    expect(
      items.map((item) => item.getAttribute("data-language-slug")),
    ).toEqual(["zulu", "english", "arabic"])
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

  it("renders disabled options with a chip without allowing selection", () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <LanguageCombobox
          options={[
            {
              slug: "english",
              name: "English",
              disabled: true,
              chipLabel: "Not available",
            },
            { slug: "spanish", name: "Spanish" },
          ]}
          value=""
          onChange={onChange}
          icon="subtitles"
          placeholder="No subtitles"
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const english = $$('[data-testid="language-combobox-option"]').find(
      (option) => option.getAttribute("data-language-slug") === "english",
    ) as HTMLButtonElement
    expect(english).not.toBeNull()
    expect(english.disabled).toBe(true)
    expect(english.getAttribute("aria-disabled")).toBe("true")
    expect(english.getAttribute("data-disabled")).toBe("true")
    expect(english.textContent).toContain("English")
    expect(english.textContent).toContain("Not available")
    expect(
      english.querySelector('[data-testid="language-combobox-option-chip"]')
        ?.textContent,
    ).toBe("Not available")

    act(() => {
      english.click()
    })
    expect(onChange).not.toHaveBeenCalled()
    expect($('[data-testid="language-combobox-popover"]')).not.toBeNull()

    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    })
    expect(onChange).not.toHaveBeenCalled()

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    })
    expect(onChange).toHaveBeenCalledWith("spanish")
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

  it("connects the search combobox to its active listbox option", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="english"
          onChange={vi.fn()}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const trigger = $("[data-testid=language-combobox-trigger]")
    const combobox = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    const listbox = $("[role=listbox]")
    const options = $$("[role=option]")
    const spanishOptionId = options[1]?.id

    expect(combobox.getAttribute("role")).toBe("combobox")
    expect(combobox.getAttribute("aria-autocomplete")).toBe("list")
    expect(combobox.getAttribute("aria-expanded")).toBe("true")
    expect(combobox.getAttribute("aria-controls")).toBe(listbox?.id)
    expect(trigger?.getAttribute("aria-controls")).toBe(listbox?.id)
    expect(combobox.getAttribute("aria-activedescendant")).toBe(options[0]?.id)

    act(() => {
      combobox.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
    })

    expect(combobox.getAttribute("aria-activedescendant")).toBe(spanishOptionId)

    act(() => {
      combobox.value = "span"
      combobox.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect($$("[role=option]")[0]?.id).toBe(spanishOptionId)
    expect(combobox.getAttribute("aria-activedescendant")).toBe(spanishOptionId)
  })

  it("keeps the active option mounted during virtualized keyboard navigation", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={MANY_OPTIONS}
          value="language-0"
          onChange={vi.fn()}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const combobox = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      for (let index = 0; index < 30; index += 1) {
        combobox.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        )
      }
    })

    const activeOptionId = combobox.getAttribute("aria-activedescendant")
    expect(activeOptionId).not.toBeNull()
    expect(document.getElementById(activeOptionId ?? "")).not.toBeNull()
  })

  it("Enter selects the first ranked option after search filtering", () => {
    const onChange = vi.fn()
    const OPTIONS_WITH_RUSSIAN = [
      { slug: "belorussian", name: "Belorussian" },
      { slug: "central-asian-russian", name: "Central Asian Russian" },
      { slug: "russian", name: "Russian" },
    ]

    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_RUSSIAN}
          value="central-asian-russian"
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
      input.value = "russi"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    })

    expect(onChange).toHaveBeenCalledWith("russian")
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

  it("shows the empty state when the search has no matches", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS}
          value="english"
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
      input.value = "zzzzz"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect($('[data-testid="language-combobox-empty"]')?.textContent).toBe(
      "No matches",
    )
    expect($$('[data-testid="language-combobox-option"]').length).toBe(0)
  })

  it("renders the nativeName as a subtitle when provided", () => {
    const OPTIONS_WITH_NATIVE = [
      { slug: "french", name: "French", nativeName: "Français" },
      { slug: "english", name: "English", nativeName: null },
    ]
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_NATIVE}
          value="english"
          onChange={vi.fn()}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const natives = $$('[data-testid="language-combobox-option-native"]')
    expect(natives.length).toBe(1)
    expect(natives[0]?.textContent).toBe("Français")
  })

  it("renders nativeName below the selected language in the trigger", () => {
    const OPTIONS_WITH_NATIVE = [
      { slug: "russian", name: "Russian", nativeName: "Русский" },
      { slug: "english", name: "English", nativeName: null },
    ]
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_NATIVE}
          value="russian"
          onChange={vi.fn()}
        />,
      )
    })

    const native = $('[data-testid="language-combobox-trigger-native"]')
    expect(native?.textContent).toBe("Русский")
  })

  it("derives a native language subtitle from bcp47 when nativeName is missing", () => {
    const OPTIONS_WITH_LOCALE = [
      { slug: "russian", name: "Russian", bcp47: "ru-RU" },
      { slug: "english", name: "English", bcp47: "en-US" },
    ]
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_LOCALE}
          value="russian"
          onChange={vi.fn()}
        />,
      )
    })

    const native = $('[data-testid="language-combobox-trigger-native"]')
    expect(native?.textContent).toBe("Русский")
  })

  it("renders an outlined language-code marker for selected and listed options", () => {
    const options = [
      {
        slug: "russian",
        name: "Russian",
        nativeName: "Русский",
        bcp47: "ru-RU",
      },
      { slug: "english", name: "English", bcp47: "en-US" },
    ]
    act(() => {
      root.render(
        <LanguageCombobox
          options={options}
          value="russian"
          onChange={vi.fn()}
        />,
      )
    })

    const triggerCode = $(
      '[data-testid="language-combobox-trigger"] [data-testid="language-combobox-option-code"]',
    )
    expect(triggerCode?.textContent).toBe("RU")
    expect(triggerCode?.className).toContain("rounded-full")
    expect(triggerCode?.className).toContain("border-stone-200/45")

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const optionCodes = $$(
      '[data-testid="language-combobox-option"] [data-testid="language-combobox-option-code"]',
    ).map((code) => code.textContent)
    expect(optionCodes).toEqual(["RU", "EN"])
  })

  it("matches the search query against nativeName too", () => {
    const OPTIONS_WITH_NATIVE = [
      { slug: "french", name: "French", nativeName: "Français" },
      { slug: "spanish", name: "Spanish", nativeName: "Español" },
    ]
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_NATIVE}
          value="french"
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
      input.value = "Español"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const items = $$('[data-testid="language-combobox-option"]')
    expect(items.length).toBe(1)
    expect(items[0]?.getAttribute("data-language-slug")).toBe("spanish")
  })

  it("ranks nativeName prefix matches before nativeName substring matches", () => {
    const OPTIONS_WITH_NATIVE = [
      { slug: "late-spanish", name: "Late Spanish", nativeName: "Neo Español" },
      { slug: "spanish", name: "Spanish", nativeName: "Español" },
    ]

    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_NATIVE}
          value="late-spanish"
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
      input.value = "Esp"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const items = $$('[data-testid="language-combobox-option"]')
    expect(
      items.map((item) => item.getAttribute("data-language-slug")),
    ).toEqual(["spanish", "late-spanish"])
    expect(items[1]?.getAttribute("aria-selected")).toBe("true")
  })

  it("matches the search query against bcp47-derived native names", () => {
    const OPTIONS_WITH_LOCALE = [
      { slug: "russian", name: "Russian", bcp47: "ru-RU" },
      { slug: "english", name: "English", bcp47: "en-US" },
    ]
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_LOCALE}
          value="english"
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
      input.value = "Русский"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const items = $$('[data-testid="language-combobox-option"]')
    expect(items.length).toBe(1)
    expect(items[0]?.getAttribute("data-language-slug")).toBe("russian")
  })
})
