/**
 * @vitest-environment jsdom
 */

import { act, useRef, useState } from "react"
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

vi.mock("@/components/watch/LanguageCombobox", () => ({
  LanguageCombobox: ({
    disabled,
    onChange,
    options,
    value,
  }: {
    disabled?: boolean
    onChange: (slug: string) => void
    options: GlobalLanguageOption[]
    value: string
  }) => (
    <select
      aria-label="Language"
      data-testid="global-language-picker-select"
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.slug} value={option.slug}>
          {option.englishName}
        </option>
      ))}
      <option value="invalid locale">Invalid test value</option>
    </select>
  ),
}))

import { GlobalLanguagePickerModal } from "@/components/watch/GlobalLanguagePickerModal"

const options: GlobalLanguageOption[] = [
  {
    slug: "english",
    aliasOwnerSlug: "english",
    englishName: "English",
    nativeName: null,
  },
  {
    slug: "french",
    aliasOwnerSlug: "french",
    englishName: "French",
    nativeName: "Français",
  },
  {
    slug: "spanish-castilian",
    aliasOwnerSlug: "spanish-castilian",
    englishName: "Spanish",
    nativeName: "Español",
  },
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function query(testId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testId}"]`)
}

function click(element: Element | null) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function changeSelection(slug: string) {
  const select = query("global-language-picker-select") as HTMLSelectElement
  act(() => {
    select.value = slug
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

function Harness({
  currentLanguageSlug = "english",
  pathname = "/",
}: {
  currentLanguageSlug?: string
  pathname?: string
}) {
  const [open, setOpen] = useState(true)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={triggerRef} data-testid="language-trigger">
        Open languages
      </button>
      <GlobalLanguagePickerModal
        open={open}
        pathname={pathname}
        currentLanguageSlug={currentLanguageSlug}
        onClose={() => setOpen(false)}
        returnFocusRef={triggerRef}
      />
    </>
  )
}

async function renderHarness(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => {
    root.render(<Harness {...props} />)
  })
}

describe("GlobalLanguagePickerModal", () => {
  it("announces loading, then focuses the language field when options arrive", async () => {
    const request = deferred<GlobalLanguageOption[]>()
    loadGlobalWatchLanguageOptionsMock.mockReturnValue(request.promise)

    await renderHarness()

    expect(
      query("global-language-picker-status")?.getAttribute("aria-live"),
    ).toBe("polite")
    expect(query("global-language-picker-status")?.textContent).toContain(
      "Loading",
    )
    expect(
      query("global-language-picker-apply")?.hasAttribute("disabled"),
    ).toBe(true)

    await act(async () => request.resolve(options))

    expect(loadGlobalWatchLanguageOptionsMock).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(query("global-language-picker-select"))
    expect(query("global-language-picker-status")?.textContent).toContain(
      "3 languages",
    )
  })

  it("retains the current language and treats an unchanged selection as a no-op", async () => {
    loadGlobalWatchLanguageOptionsMock.mockResolvedValue(options)
    await renderHarness({ currentLanguageSlug: "french" })

    const select = query("global-language-picker-select") as HTMLSelectElement
    expect(select.value).toBe("french")
    expect(
      query("global-language-picker-apply")?.hasAttribute("disabled"),
    ).toBe(true)
    expect(prefetchMock).not.toHaveBeenCalled()
    expect(writePreferredLanguageSlugMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it("falls back to a catalog language for an authored route candidate", async () => {
    loadGlobalWatchLanguageOptionsMock.mockResolvedValue(options)
    await renderHarness({ currentLanguageSlug: "easter" })

    const select = query("global-language-picker-select") as HTMLSelectElement
    expect(select.value).toBe("english")
    expect(
      query("global-language-picker-apply")?.hasAttribute("disabled"),
    ).toBe(true)
  })

  it("validates the exact public slug before cookie write or navigation", async () => {
    loadGlobalWatchLanguageOptionsMock.mockResolvedValue(options)
    await renderHarness()

    changeSelection("invalid locale")
    click(query("global-language-picker-apply"))

    expect(writePreferredLanguageSlugMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
    expect(query("global-language-picker-status")?.textContent).toContain(
      "choose another search language",
    )
  })

  it("prefetches only a changed valid route-family target and ignores prefetch failure", async () => {
    prefetchMock.mockRejectedValue(new Error("prefetch failed"))
    loadGlobalWatchLanguageOptionsMock.mockResolvedValue(options)
    await renderHarness({ pathname: "/english.html/videos" })

    changeSelection("french")
    await act(async () => {})

    expect(prefetchMock).toHaveBeenCalledTimes(1)
    expect(prefetchMock).toHaveBeenCalledWith("/french.html/videos")

    changeSelection("english")
    await act(async () => {})
    expect(prefetchMock).toHaveBeenCalledTimes(1)
  })

  it("commits pending UI, writes preference, then pushes once", async () => {
    loadGlobalWatchLanguageOptionsMock.mockResolvedValue(options)
    await renderHarness({ pathname: "/languages" })
    changeSelection("spanish-castilian")

    click(query("global-language-picker-apply"))
    click(query("global-language-picker-apply"))

    expect(query("global-language-picker-status")?.textContent).toContain(
      "Apply: Spanish",
    )
    expect(
      query("global-language-picker-apply")?.hasAttribute("disabled"),
    ).toBe(true)
    expect(writePreferredLanguageSlugMock).toHaveBeenCalledTimes(1)
    expect(writePreferredLanguageSlugMock).toHaveBeenCalledWith(
      "spanish-castilian",
    )
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith("/spanish-castilian.html/languages")
    expect(
      writePreferredLanguageSlugMock.mock.invocationCallOrder[0],
    ).toBeLessThan(pushMock.mock.invocationCallOrder[0]!)
  })

  it("shows a truthful empty state without rendering a selector", async () => {
    loadGlobalWatchLanguageOptionsMock.mockResolvedValue([])
    await renderHarness()

    expect(query("global-language-picker-empty")?.textContent).toContain(
      "0 languages",
    )
    expect(query("global-language-picker-select")).toBeNull()
    expect(
      query("global-language-picker-status")?.getAttribute("aria-live"),
    ).toBe("polite")
  })

  it("shows an option-load error and recovers after retry", async () => {
    loadGlobalWatchLanguageOptionsMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(options)
    await renderHarness()

    expect(query("global-language-picker-error")?.textContent).toContain(
      "Please check your connection",
    )
    const retry = query("global-language-picker-retry")
    expect(retry?.getAttribute("aria-label")).toContain("Retry")

    click(retry)
    await act(async () => {})

    expect(loadGlobalWatchLanguageOptionsMock).toHaveBeenCalledTimes(2)
    expect(query("global-language-picker-select")).not.toBeNull()
    expect(document.activeElement).toBe(query("global-language-picker-select"))
  })

  it("closes without navigation and restores focus after viewport close, footer close, overlay, and Escape", async () => {
    loadGlobalWatchLanguageOptionsMock.mockResolvedValue(options)

    for (const closeWith of [
      "viewport",
      "footer",
      "overlay",
      "escape",
    ] as const) {
      await act(async () => {
        root.render(<Harness key={closeWith} />)
      })
      const trigger = query("language-trigger")
      expect(query("global-language-picker-modal")).not.toBeNull()

      if (closeWith === "viewport") {
        const close = query("global-language-picker-modal-close")
        expect(close?.style.top).toContain("safe-area-inset-top")
        expect(close?.style.right).toContain("safe-area-inset-right")
        click(close)
      } else if (closeWith === "footer") {
        click(query("global-language-picker-close"))
      } else if (closeWith === "overlay") {
        click(document.querySelector('[data-slot="dialog-overlay"]'))
      } else {
        act(() => {
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          )
        })
      }

      expect(query("global-language-picker-modal")).toBeNull()
      expect(document.activeElement).toBe(trigger)
      expect(writePreferredLanguageSlugMock).not.toHaveBeenCalled()
      expect(pushMock).not.toHaveBeenCalled()
    }
  })

  it("uses the shared inset visible-focus treatment and an accessible dialog name", async () => {
    loadGlobalWatchLanguageOptionsMock.mockResolvedValue(options)
    await renderHarness()

    expect(query("global-language-picker-modal")?.getAttribute("role")).toBe(
      "dialog",
    )
    expect(
      query("global-language-picker-modal")?.getAttribute("aria-modal"),
    ).toBe("true")
    expect(query("global-language-picker-close")?.className).toContain(
      "focus-visible:ring-inset",
    )
    expect(
      query("global-language-picker-modal-close")?.querySelectorAll("svg"),
    ).toHaveLength(1)
    expect(
      query("global-language-picker-close")?.querySelector("svg"),
    ).toBeNull()
    expect(query("global-language-picker-apply")?.className).toContain(
      "focus-visible:ring-inset",
    )
  })
})
