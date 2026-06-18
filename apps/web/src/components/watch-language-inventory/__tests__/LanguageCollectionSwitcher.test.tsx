/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}))

vi.mock("@/components/watch/LanguageCombobox", () => ({
  LanguageCombobox: vi.fn(
    ({
      options,
      value,
      onChange,
    }: {
      options: Array<{ slug: string }>
      value: string
      onChange: (slug: string) => void
    }) => (
      <button
        type="button"
        data-testid="language-combobox-mock"
        data-option-slugs={options.map((option) => option.slug).join(",")}
        data-value={value}
        onClick={() => onChange("russian")}
      />
    ),
  ),
}))

import { LanguageCollectionSwitcher } from "@/components/watch-language-inventory/LanguageCollectionSwitcher"

let container: HTMLDivElement
let root: Root

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

describe("LanguageCollectionSwitcher", () => {
  it("navigates language changes through the App Router", () => {
    act(() => {
      root.render(
        <LanguageCollectionSwitcher
          currentLanguageName="Spanish, Latin American"
          currentNativeName="Espanol"
          currentSlug="spanish-latin-american"
          languages={[
            {
              slug: "spanish-latin-american",
              languageName: "Spanish, Latin American",
              nativeName: "Espanol",
              bcp47: "es-419",
            },
            {
              slug: "russian",
              languageName: "Russian",
              nativeName: "Russian",
              bcp47: "ru",
            },
          ]}
          totalItems={674}
        />,
      )
    })

    act(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="language-combobox-mock"]',
        )
        ?.click()
    })

    expect(routerPushMock).toHaveBeenCalledTimes(1)
    expect(routerPushMock).toHaveBeenCalledWith("/russian.html/videos")
  })
})
