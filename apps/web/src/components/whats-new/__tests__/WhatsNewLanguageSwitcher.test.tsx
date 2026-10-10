/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { routerPushMock, comboboxSpy } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  // Records the props the switcher hands the shared combobox, so the sizing
  // override and the custom trigger content can be asserted without
  // reproducing the real component's markup.
  comboboxSpy: vi.fn(),
}))

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
  LanguageCombobox: (props: Record<string, unknown>) => {
    comboboxSpy(props)
    return renderCombobox(props as never)
  },
}))

const renderCombobox = ({
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
}

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
  comboboxSpy.mockClear()
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

  it("sizes the control to the button beside it, and drops the code disc", () => {
    // Measured in a browser at 48px against the feedback button's 48px, with
    // both edges within 1px. Two separate things have to hold for that:
    //
    // …the height override remains explicit at this call site so the switcher
    // stays pinned to the feedback button's 48px height if the combobox base
    // sizing changes later.
    render()

    const props = comboboxSpy.mock.calls.at(-1)?.[0] as {
      triggerClassName?: string
      triggerContent?: unknown
    }
    expect(props.triggerClassName ?? "").toMatch(/\bh-12!/)
    expect(props.triggerClassName ?? "").toMatch(/\bmin-h-12!/)

    // …and the trigger draws its own content, so the two-letter code disc
    // never renders. It restated the language already named beside it.
    expect(props.triggerContent).toBeTruthy()
  })

  it("is a label and a combobox, with no frame around them", () => {
    // Asked for directly: the bordered, blurred card and the browse-all
    // index link are both gone, leaving the prompt and the control.
    //
    // KNOWN CONSEQUENCE, recorded here because the test that used to guard
    // it is what this replaced: Admin unreachable at build time bakes a
    // single-option combobox for the route's whole revalidate window, and
    // the index link was the path that still worked. There is now no exit
    // from that state — see the switcher's own comment.
    render()

    const switcher = container.querySelector<HTMLElement>(
      '[data-testid="whats-new-language-switcher"]',
    )

    expect(switcher).not.toBeNull()
    expect(switcher?.className ?? "").not.toMatch(
      /\bborder\b|\bshadow-|backdrop-blur/,
    )
    expect(
      container.querySelector('[data-testid="whats-new-all-languages-link"]'),
    ).toBeNull()
    // …and the two things asked for are still there.
    expect(switcher?.textContent).toContain("Watch in your language")
    // This suite's combobox mock renders one `pick-<slug>` per option.
    expect(
      container.querySelector('[data-testid="pick-english"]'),
    ).not.toBeNull()
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
