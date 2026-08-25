/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}))

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode
    href: string
  } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock("@/components/watch/LanguageCombobox", () => ({
  LanguageCombobox: ({
    options,
    value,
    onChange,
    triggerWrapper,
  }: {
    options: Array<{ slug: string; nativeName?: string | null }>
    value: string
    onChange: (slug: string) => void
    triggerWrapper?: (trigger: ReactNode) => ReactNode
  }) => {
    const trigger = (
      <div>
        {options.map((option) => (
          <button
            key={option.slug}
            type="button"
            data-testid={`pick-${option.slug}`}
            data-native={option.nativeName ?? ""}
            data-selected={String(option.slug === value)}
            onClick={() => onChange(option.slug)}
          />
        ))}
      </div>
    )
    return triggerWrapper ? triggerWrapper(trigger) : trigger
  },
}))

import { WhatsNewLanguageSwitcher } from "@/components/whats-new/WhatsNewLanguageSwitcher"

const LANGUAGES = [
  {
    slug: "english",
    languageName: "English",
    nativeName: "English",
    bcp47: "en",
  },
  {
    slug: "russian",
    languageName: "Russian",
    nativeName: "Русский",
    bcp47: "ru",
  },
]

let container: HTMLDivElement
let root: Root

function render(currentSlug = "english") {
  act(() => {
    root.render(
      <WhatsNewLanguageSwitcher
        allLanguagesLabel="Browse all languages"
        currentSlug={currentSlug}
        label="Watch in your language"
        languages={LANGUAGES}
      />,
    )
  })
}

function pick(slug: string) {
  act(() => {
    container
      .querySelector<HTMLButtonElement>(`[data-testid="pick-${slug}"]`)
      ?.click()
  })
}

beforeEach(() => {
  routerPushMock.mockReset()
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

describe("WhatsNewLanguageSwitcher", () => {
  it("routes a language choice to that language's video collection", () => {
    render()
    pick("russian")

    expect(routerPushMock).toHaveBeenCalledExactlyOnceWith(
      "/russian.html/videos",
    )
  })

  it("still navigates when the reader picks the current language", () => {
    // Deliberate divergence from LanguageCollectionSwitcher, which treats
    // this as a no-op because it already renders that collection. This page
    // is not a collection, so `english` is a real destination — swallowing
    // it would leave the control looking broken.
    render("english")
    pick("english")

    expect(routerPushMock).toHaveBeenCalledExactlyOnceWith(
      "/english.html/videos",
    )
  })

  it("ignores a slug that is not a routable language", () => {
    act(() => {
      root.render(
        <WhatsNewLanguageSwitcher
          allLanguagesLabel="Browse all languages"
          currentSlug="english"
          label="Watch in your language"
          languages={[
            ...LANGUAGES,
            {
              slug: "not a slug",
              languageName: "Broken",
              nativeName: null,
              bcp47: null,
            },
          ]}
        />,
      )
    })
    pick("not a slug")

    expect(routerPushMock).not.toHaveBeenCalled()
  })

  it("keeps a working exit when the option list degrades to one entry", () => {
    // Admin unreachable at build time bakes a single-option combobox for
    // the route's whole revalidate window. The index link is the path that
    // still works, so it must not be conditional on a healthy list.
    act(() => {
      root.render(
        <WhatsNewLanguageSwitcher
          allLanguagesLabel="Browse all languages"
          currentSlug="english"
          label="Watch in your language"
          languages={[LANGUAGES[0]]}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>(
      '[data-testid="whats-new-all-languages-link"]',
    )
    expect(link?.getAttribute("href")).toBe("/languages")
  })

  it("carries native names through so a reader can self-identify", () => {
    render()

    expect(
      container
        .querySelector('[data-testid="pick-russian"]')
        ?.getAttribute("data-native"),
    ).toBe("Русский")
    expect(
      container
        .querySelector('[data-testid="pick-english"]')
        ?.getAttribute("data-selected"),
    ).toBe("true")
  })
})
