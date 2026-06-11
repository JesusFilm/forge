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
      function getBoundingClientRectMock() {
        const element = this as HTMLElement
        if (
          element.getAttribute("data-testid") === "language-combobox-trigger"
        ) {
          return makeRect({
            bottom: 714,
            height: 64,
            right: 400,
            top: 650,
            width: 400,
          })
        }
        if (
          element ===
          $('[data-testid="language-combobox-search"]')?.parentElement
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
      expect(popover?.className).toContain("bottom-full")
      expect(popover?.className).toContain("mb-2")
      expect(popover?.className).not.toContain("top-full")
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
      function getBoundingClientRectMock() {
        const element = this as HTMLElement
        if (
          element.getAttribute("data-testid") === "language-combobox-trigger"
        ) {
          return makeRect({
            bottom: 74,
            height: 64,
            right: 400,
            top: 10,
            width: 400,
          })
        }
        if (
          element ===
          $('[data-testid="language-combobox-search"]')?.parentElement
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
      expect(popover?.className).toContain("top-full")
      expect(popover?.className).toContain("mt-2")
      expect(listbox.style.maxHeight).toBe("49px")
      expect(listbox.className).toContain("overflow-y-auto")
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      })
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

  it("renders a circular flag icon for language options", () => {
    const OPTIONS_WITH_FLAG = [
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
          options={OPTIONS_WITH_FLAG}
          value="russian"
          onChange={vi.fn()}
        />,
      )
    })

    const triggerFlag = $(
      '[data-testid="language-combobox-trigger"] [data-testid="language-combobox-option-flag"]',
    )
    expect(triggerFlag?.className).toContain("size-8")
    expect(triggerFlag?.className).not.toContain("size-10")

    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const flag = $(
      '[data-testid="language-combobox-option"] [data-testid="language-combobox-option-flag"]',
    )
    expect(flag?.getAttribute("data-flag-src")).toBe(
      "/watch/images/flags/ru.svg",
    )
    expect(flag?.className).toContain("rounded-full")
    expect(flag?.className).toContain("size-10")
    expect(flag?.querySelector("span")?.getAttribute("style")).toContain(
      "/watch/images/flags/ru.svg",
    )
  })

  it("derives flags from production variant slugs and language names", () => {
    const OPTIONS_WITH_VARIANTS = [
      { slug: "bangla-2", name: "Bangla" },
      { slug: "armenian", name: "Armenian" },
      { slug: "gujarati", name: "Gujarati" },
      { slug: "hebrew", name: "Hebrew" },
      { slug: "indonesian", name: "Indonesian" },
      { slug: "indonesian-yesus", name: "Indonesian (Yesus)" },
      { slug: "lithuanian", name: "Lithuanian" },
      { slug: "malayalam", name: "Malayalam" },
      { slug: "polish", name: "Polish" },
      { slug: "portuguese-brazil", name: "Portuguese, Brazil" },
      { slug: "romanian", name: "Romanian" },
      { slug: "sinhala", name: "Sinhala" },
      { slug: "spanish-latin-american", name: "Spanish, Latin American" },
      { slug: "tamil", name: "Tamil" },
      { slug: "telugu", name: "Telugu" },
      { slug: "thai", name: "Thai" },
      { slug: "ukrainian", name: "Ukrainian" },
      { slug: "urdu", name: "Urdu" },
      { slug: "vietnamese", name: "Vietnamese" },
    ]
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_VARIANTS}
          value="bangla-2"
          onChange={vi.fn()}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const flags = $$(
      '[data-testid="language-combobox-option"] [data-testid="language-combobox-option-flag"]',
    ).map((flag) => flag.getAttribute("data-flag-src"))
    expect(flags).toEqual([
      "/watch/images/flags/bd.svg",
      "/watch/images/flags/am.svg",
      "/watch/images/flags/in.svg",
      "/watch/images/flags/il.svg",
      "/watch/images/flags/id.svg",
      "/watch/images/flags/id.svg",
      "/watch/images/flags/lt.svg",
      "/watch/images/flags/in.svg",
      "/watch/images/flags/pl.svg",
      "/watch/images/flags/br.svg",
      "/watch/images/flags/ro.svg",
      "/watch/images/flags/lk.svg",
      "/watch/images/flags/mx.svg",
      "/watch/images/flags/in.svg",
      "/watch/images/flags/in.svg",
      "/watch/images/flags/th.svg",
      "/watch/images/flags/ua.svg",
      "/watch/images/flags/pk.svg",
      "/watch/images/flags/vn.svg",
    ])
  })

  it("derives region flags from language-only bcp47 codes", () => {
    const OPTIONS_WITH_LANGUAGE_CODES = [
      { slug: "code-only-swahili", name: "Swahili", bcp47: "sw" },
      { slug: "code-only-turkish", name: "Turkish", bcp47: "tr" },
      { slug: "code-only-welsh", name: "Welsh", bcp47: "cy" },
      { slug: "code-only-maori", name: "Maori", bcp47: "mi" },
      { slug: "code-only-bosnian", name: "Bosnian", bcp47: "bs" },
    ]
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_LANGUAGE_CODES}
          value="code-only-swahili"
          onChange={vi.fn()}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const flags = $$(
      '[data-testid="language-combobox-option"] [data-testid="language-combobox-option-flag"]',
    ).map((flag) => flag.getAttribute("data-flag-src"))
    expect(flags).toEqual([
      "/watch/images/flags/tz.svg",
      "/watch/images/flags/tr.svg",
      "/watch/images/flags/gb.svg",
      "/watch/images/flags/nz.svg",
      "/watch/images/flags/ba.svg",
    ])
  })

  it("maps standard and branded language variant labels to their base country flags", () => {
    const OPTIONS_WITH_VARIANT_LABELS = [
      { slug: "german-standard", name: "German, Standard" },
      { slug: "indonesian-yesus", name: "Indonesian (Yesus)" },
    ]
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_VARIANT_LABELS}
          value="german-standard"
          onChange={vi.fn()}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const flags = $$(
      '[data-testid="language-combobox-option"] [data-testid="language-combobox-option-flag"]',
    ).map((flag) => flag.getAttribute("data-flag-src"))
    expect(flags).toEqual([
      "/watch/images/flags/de.svg",
      "/watch/images/flags/id.svg",
    ])
  })

  it("uses vendored language-specific circle flags when no region is available", () => {
    const OPTIONS_WITH_LANGUAGE_FLAG = [
      { slug: "arabic-modern-standard", name: "Arabic", bcp47: "ar" },
      { slug: "interslavic", name: "Interslavic" },
    ]
    act(() => {
      root.render(
        <LanguageCombobox
          options={OPTIONS_WITH_LANGUAGE_FLAG}
          value="arabic-modern-standard"
          onChange={vi.fn()}
        />,
      )
    })
    act(() => {
      $('[data-testid="language-combobox-trigger"]')?.click()
    })

    const flags = $$(
      '[data-testid="language-combobox-option"] [data-testid="language-combobox-option-flag"]',
    ).map((flag) => flag.getAttribute("data-flag-src"))
    expect(flags).toEqual([
      "/watch/images/flags/language/ar.svg",
      "/watch/images/flags/language/interslavic.svg",
    ])
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
