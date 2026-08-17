/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LanguageCombobox } from "@/components/watch/LanguageCombobox"
import { WATCH_LANGUAGE_SEARCH_ALIAS_AUTHORITY } from "@/lib/watch-language-search-aliases"

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
})

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null
}

function $$(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector)) as HTMLElement[]
}

const MANY_OPTIONS = Array.from({ length: 200 }, (_, index) => ({
  slug: `language-${index}`,
  name: `Language ${String(index).padStart(3, "0")}`,
}))
const OPTION_SCROLL_TOP_FOR_TEST = 7200

describe("LanguageCombobox Chinese aliases", () => {
  it("selects an exact-slug alias result with the keyboard", () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <LanguageCombobox
          options={[
            { slug: "english", name: "English" },
            { slug: "mandarin-china", name: "Mandarin China" },
          ]}
          value="english"
          onChange={onChange}
          searchAliasAuthority={WATCH_LANGUAGE_SEARCH_ALIAS_AUTHORITY}
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
      input.value = "普通話"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const items = $$('[data-testid="language-combobox-option"]')
    expect(items).toHaveLength(1)
    expect(items[0]?.getAttribute("data-language-slug")).toBe("mandarin-china")
    expect(input.getAttribute("aria-activedescendant")).toBe(items[0]?.id)

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    })

    expect(onChange).toHaveBeenCalledWith("mandarin-china")
  })

  it("ranks every direct tier before partial alias matches and preserves alias order", () => {
    const searchAliasAuthority = {
      aliasesBySlug: {
        "alias-first": ["special"],
        "alias-second": ["spectacular"],
      },
      exactAliases: new Set(["special", "spectacular"]),
    }
    act(() => {
      root.render(
        <LanguageCombobox
          options={[
            { slug: "alias-first", name: "Alpha" },
            { slug: "direct", name: "Retrospective" },
            { slug: "alias-second", name: "Beta" },
          ]}
          value="alias-first"
          onChange={vi.fn()}
          searchAliasAuthority={searchAliasAuthority}
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
      input.value = "spec"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(
      $$('[data-testid="language-combobox-option"]').map((item) =>
        item.getAttribute("data-language-slug"),
      ),
    ).toEqual(["direct", "alias-first", "alias-second"])
  })

  it("does not let a BCP-derived native label bypass exact-slug alias authority", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={[
            {
              slug: "unconfigured-zh",
              name: "Mystery language",
              bcp47: "zh-Hant-XX",
            },
            { slug: "mandarin-china", name: "Mandarin China" },
          ]}
          value="mandarin-china"
          onChange={vi.fn()}
          searchAliasAuthority={WATCH_LANGUAGE_SEARCH_ALIAS_AUTHORITY}
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
      input.value = "中文"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(
      $$('[data-testid="language-combobox-option"]').map((item) =>
        item.getAttribute("data-language-slug"),
      ),
    ).toEqual(["mandarin-china"])
  })

  it("ranks direct native-name matches before exact alias owners", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={[
            { slug: "foochow", name: "Foochow" },
            {
              slug: "chinese-simplified",
              name: "Simplified Chinese",
              nativeName: "中文",
            },
            { slug: "cantonese", name: "Cantonese" },
            { slug: "mandarin-china", name: "Mandarin China" },
            { slug: "hui", name: "Hui" },
          ]}
          value="mandarin-china"
          onChange={vi.fn()}
          searchAliasAuthority={WATCH_LANGUAGE_SEARCH_ALIAS_AUTHORITY}
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
      input.value = "中文"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(
      $$('[data-testid="language-combobox-option"]').map((item) =>
        item.getAttribute("data-language-slug"),
      ),
    ).toEqual([
      "chinese-simplified",
      "foochow",
      "cantonese",
      "mandarin-china",
      "hui",
    ])
  })

  it("preserves caller order when an exact alias has no direct name match", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={[
            { slug: "cantonese", name: "Cantonese" },
            { slug: "chinese-guiliu", name: "Chinese, Guiliu" },
            { slug: "mandarin-china", name: "Mandarin China" },
          ]}
          value="mandarin-china"
          onChange={vi.fn()}
          searchAliasAuthority={WATCH_LANGUAGE_SEARCH_ALIAS_AUTHORITY}
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
      input.value = "中文"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(
      $$('[data-testid="language-combobox-option"]').map((item) =>
        item.getAttribute("data-language-slug"),
      ),
    ).toEqual(["cantonese", "chinese-guiliu", "mandarin-china"])
  })

  it("keeps disabled context rows available to direct search but not alias search", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={[
            {
              slug: "mandarin-china",
              name: "Mandarin China",
              disabled: true,
              chipLabel: "Not available",
            },
          ]}
          value=""
          onChange={vi.fn()}
          searchAliasAuthority={WATCH_LANGUAGE_SEARCH_ALIAS_AUTHORITY}
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
      input.value = "普通话"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect($$('[data-testid="language-combobox-option"]')).toHaveLength(0)

    act(() => {
      input.value = "Mandarin"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect($$('[data-testid="language-combobox-option"]')).toHaveLength(1)
    expect(
      $$('[data-testid="language-combobox-option"]')[0]?.getAttribute(
        "data-disabled",
      ),
    ).toBe("true")
  })

  it("resets a virtualized list before selecting an alias-filtered result", () => {
    const onChange = vi.fn()
    const options = [
      ...MANY_OPTIONS,
      { slug: "mandarin-china", name: "Mandarin China" },
    ]
    act(() => {
      root.render(
        <LanguageCombobox
          options={options}
          value="language-0"
          onChange={onChange}
          searchAliasAuthority={WATCH_LANGUAGE_SEARCH_ALIAS_AUTHORITY}
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

    const input = $(
      '[data-testid="language-combobox-search"]',
    ) as HTMLInputElement
    act(() => {
      input.value = "普通话"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const items = $$('[data-testid="language-combobox-option"]')
    expect(listbox.scrollTop).toBe(0)
    expect(items).toHaveLength(1)
    expect(items[0]?.getAttribute("data-language-slug")).toBe("mandarin-china")
    expect(input.getAttribute("aria-activedescendant")).toBe(items[0]?.id)

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      )
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    })
    expect(onChange).toHaveBeenCalledWith("mandarin-china")
  })
})
