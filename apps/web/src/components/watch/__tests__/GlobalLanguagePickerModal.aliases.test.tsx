/**
 * @vitest-environment jsdom
 */

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { GlobalLanguageOption } from "@/lib/watch-language-switcher"

const {
  loadGlobalWatchLanguageOptionsMock,
  prefetchMock,
  pushMock,
  writePreferredLanguageSlugMock,
} = vi.hoisted(() => ({
  loadGlobalWatchLanguageOptionsMock: vi.fn(),
  prefetchMock: vi.fn(),
  pushMock: vi.fn(),
  writePreferredLanguageSlugMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: prefetchMock, push: pushMock }),
}))

vi.mock("@/lib/language-preference-client", () => ({
  writePreferredLanguageSlug: writePreferredLanguageSlugMock,
}))

vi.mock("@/lib/watch-interaction-loader", () => ({
  loadGlobalWatchLanguageOptions: loadGlobalWatchLanguageOptionsMock,
}))

import { GlobalLanguagePickerModal } from "@/components/watch/GlobalLanguagePickerModal"

const options: GlobalLanguageOption[] = [
  { slug: "english", englishName: "English", nativeName: null },
  {
    slug: "mandarin-china",
    englishName: "Mandarin China",
    nativeName: null,
  },
  { slug: "cantonese", englishName: "Cantonese", nativeName: null },
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  loadGlobalWatchLanguageOptionsMock.mockReset()
  prefetchMock.mockReset()
  pushMock.mockReset()
  writePreferredLanguageSlugMock.mockReset()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
})

function Harness() {
  const [open, setOpen] = useState(true)
  return (
    <GlobalLanguagePickerModal
      open={open}
      pathname="/languages"
      currentLanguageSlug="english"
      onClose={() => setOpen(false)}
    />
  )
}

describe("GlobalLanguagePickerModal Chinese aliases", () => {
  it("selects and submits the exact public slug through the real combobox", async () => {
    loadGlobalWatchLanguageOptionsMock.mockResolvedValue(options)
    await act(async () => {
      root.render(<Harness />)
    })

    act(() => {
      document
        .querySelector<HTMLElement>('[data-testid="language-combobox-trigger"]')
        ?.click()
    })
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="language-combobox-search"]',
    )!
    act(() => {
      input.value = "普通话"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const result = document.querySelector<HTMLElement>(
      '[data-testid="language-combobox-option"]',
    )
    expect(result?.getAttribute("data-language-slug")).toBe("mandarin-china")

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    })
    await act(async () => {})

    const apply = document.querySelector<HTMLButtonElement>(
      '[data-testid="global-language-picker-apply"]',
    )!
    expect(apply.disabled).toBe(false)
    act(() => apply.click())

    expect(writePreferredLanguageSlugMock).toHaveBeenCalledWith(
      "mandarin-china",
    )
    expect(pushMock).toHaveBeenCalledWith("/mandarin-china.html/languages")
  })
})
