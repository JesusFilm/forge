/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"

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

function renderOpen(options: LanguageComboboxOption[], value: string) {
  act(() => {
    root.render(
      <LanguageCombobox options={options} value={value} onChange={vi.fn()} />,
    )
  })
  act(() => {
    document
      .querySelector<HTMLElement>('[data-testid="language-combobox-trigger"]')
      ?.click()
  })
}

function optionNative(slug: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-testid="language-combobox-option"][data-language-slug="${slug}"] [data-testid="language-combobox-option-native"]`,
  )
}

describe("LanguageCombobox native-name markup (FGE-50)", () => {
  it("suppresses English fallback from an unsupported Intl locale", () => {
    expect(Intl.DisplayNames.supportedLocalesOf(["swb"])).toEqual([])
    renderOpen(
      [{ slug: "shimaore", name: "Shimaore", bcp47: "swb" }],
      "shimaore",
    )
    expect(optionNative("shimaore")).toBeNull()
    expect(document.querySelector('bdi[lang="swb"]')).toBeNull()
    expect(container.textContent).not.toContain("Comorian")
  })

  it("declares a verified explicit native name with its tag and direction", () => {
    renderOpen(
      [
        {
          slug: "arabic",
          name: "Arabic",
          nativeName: "العربية",
          nativeNameLang: "ar",
          bcp47: "ar",
        },
        {
          slug: "hebrew",
          name: "Hebrew",
          nativeName: "עברית",
          nativeNameLang: "he",
          bcp47: "he",
        },
        {
          slug: "russian",
          name: "Russian",
          nativeName: "Русский",
          nativeNameLang: "ru",
          bcp47: "ru-RU",
        },
      ],
      "russian",
    )

    const arabic = optionNative("arabic")?.querySelector("bdi")
    expect(arabic?.getAttribute("lang")).toBe("ar")
    expect(arabic?.getAttribute("dir")).toBe("rtl")
    expect(
      optionNative("hebrew")?.querySelector("bdi")?.getAttribute("dir"),
    ).toBe("rtl")
    const russian = optionNative("russian")?.querySelector("bdi")
    expect(russian?.getAttribute("lang")).toBe("ru")
    expect(russian?.getAttribute("dir")).toBe("ltr")
  })

  it("leaves an explicit native name untagged when its provenance is unproven", () => {
    // No nativeNameLang: e.g. a search-provider name chosen by a guessed key.
    renderOpen(
      [
        {
          slug: "french",
          name: "French",
          nativeName: "Français",
          bcp47: "fr",
        },
      ],
      "french",
    )
    const bdi = optionNative("french")?.querySelector("bdi")
    expect(bdi?.textContent).toBe("Français")
    expect(bdi?.hasAttribute("lang")).toBe(false)
    expect(bdi?.hasAttribute("dir")).toBe(false)
  })

  it("never declares an unknown or invalid nativeNameLang, even if supplied", () => {
    renderOpen(
      [
        {
          slug: "zed",
          name: "Zed",
          nativeName: "Zeta",
          nativeNameLang: "zz",
          bcp47: "zz",
        },
        {
          slug: "huasteco",
          name: "Huasteco",
          nativeName: "Teenek",
          nativeNameLang: "hus-MX-SLP",
          bcp47: "hus-MX-SLP",
        },
      ],
      "zed",
    )
    expect(
      optionNative("zed")?.querySelector("bdi")?.hasAttribute("lang"),
    ).toBe(false)
    expect(
      optionNative("huasteco")?.querySelector("bdi")?.hasAttribute("lang"),
    ).toBe(false)
  })

  it("tags an Intl-derived native label with the primary subtag", () => {
    renderOpen(
      [{ slug: "russian", name: "Russian", bcp47: "ru-RU" }],
      "russian",
    )
    const bdi = optionNative("russian")?.querySelector("bdi")
    expect(bdi?.textContent).toBe("Русский")
    expect(bdi?.getAttribute("lang")).toBe("ru")
  })

  it("does not tag the Intl-derived label of a ku-Arab row (script mismatch)", () => {
    // Intl names `ku` in Latin script (kurdî); declaring ku-Arab would be wrong.
    renderOpen(
      [
        {
          slug: "kurdish-arab",
          name: "Kurdish (Arabic script)",
          bcp47: "ku-Arab",
        },
      ],
      "kurdish-arab",
    )
    const bdi = optionNative("kurdish-arab")?.querySelector("bdi")
    expect(bdi?.textContent).toMatch(/^Kurdî/)
    expect(bdi?.hasAttribute("lang")).toBe(false)
  })

  it("declares the selected trigger's native name too", () => {
    act(() => {
      root.render(
        <LanguageCombobox
          options={[
            {
              slug: "arabic",
              name: "Arabic",
              nativeName: "العربية",
              nativeNameLang: "ar",
              bcp47: "ar",
            },
          ]}
          value="arabic"
          onChange={vi.fn()}
        />,
      )
    })
    const bdi = document
      .querySelector('[data-testid="language-combobox-trigger-native"]')
      ?.querySelector("bdi")
    expect(bdi?.getAttribute("lang")).toBe("ar")
    expect(bdi?.getAttribute("dir")).toBe("rtl")
  })

  describe("primary English name in an RTL (ar) UI", () => {
    function renderInArabicUi(
      options: LanguageComboboxOption[],
      value: string,
    ) {
      container.setAttribute("lang", "ar")
      container.setAttribute("dir", "rtl")
      renderOpen(options, value)
    }

    it("isolates a proven English name as lang=en dir=ltr in trigger and option", () => {
      renderInArabicUi(
        [
          { slug: "english", name: "English", nameLang: "en", bcp47: "en" },
          { slug: "arabic", name: "Arabic", nameLang: "en", bcp47: "ar" },
        ],
        "english",
      )
      const trigger = document.querySelector(
        '[data-testid="language-combobox-trigger"] bdi',
      )
      expect(trigger?.textContent).toBe("English")
      expect(trigger?.getAttribute("lang")).toBe("en")
      expect(trigger?.getAttribute("dir")).toBe("ltr")
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="language-combobox-option"]',
        ),
      )
      for (const row of rows) {
        const name = row.querySelector("bdi[lang='en']")
        expect(name?.getAttribute("dir")).toBe("ltr")
      }
      expect(rows).toHaveLength(2)
      expect(container.closest("[dir]")?.getAttribute("dir")).toBe("rtl")
    })

    it("leaves an unproven primary name untagged", () => {
      renderInArabicUi(
        [{ slug: "english", name: "English", bcp47: "en" }],
        "english",
      )
      expect(
        document.querySelector('[data-testid="language-combobox-trigger"] bdi'),
      ).toBeNull()
      const row = document.querySelector(
        '[data-testid="language-combobox-option"]',
      )
      expect(row?.querySelector("bdi")).toBeNull()
      expect(row?.textContent).toContain("English")
    })

    it("does not tag a native label's primary name as English", () => {
      renderInArabicUi(
        [
          {
            slug: "arabic",
            name: "Arabic",
            nameLang: "en",
            nativeName: "العربية",
            nativeNameLang: "ar",
            bcp47: "ar",
          },
        ],
        "arabic",
      )
      const bdis = Array.from(
        document.querySelectorAll(
          '[data-testid="language-combobox-option"] bdi',
        ),
      )
      expect(bdis.map((b) => b.getAttribute("lang"))).toEqual(["en", "ar"])
      expect(bdis.map((b) => b.getAttribute("dir"))).toEqual(["ltr", "rtl"])
    })
  })
})
