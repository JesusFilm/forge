/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FloatingSearchProvider } from "@/components/FloatingSearchProvider"
import {
  WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  WATCH_PLAYER_PLAYBACK_STATE_EVENT,
  type WatchHeaderLanguageSwitcherDetail,
  type WatchPlayerChromeVisibilityDetail,
  type WatchPlayerPlaybackStateDetail,
} from "@/lib/watch-player-chrome-events"

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: vi.fn(),
  }),
}))

vi.mock("@/lib/search-actions", () => ({
  runSearch: vi.fn(),
}))

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

function dispatchChromeVisibility(visible: boolean) {
  window.dispatchEvent(
    new CustomEvent<WatchPlayerChromeVisibilityDetail>(
      WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
      { detail: { visible } },
    ),
  )
}

function dispatchPlaybackState(detail: WatchPlayerPlaybackStateDetail) {
  window.dispatchEvent(
    new CustomEvent<WatchPlayerPlaybackStateDetail>(
      WATCH_PLAYER_PLAYBACK_STATE_EVENT,
      { detail },
    ),
  )
}

function dispatchLanguageSwitcher(detail: WatchHeaderLanguageSwitcherDetail) {
  window.dispatchEvent(
    new CustomEvent<WatchHeaderLanguageSwitcherDetail>(
      WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
      { detail },
    ),
  )
}

describe("FloatingSearchProvider — header backdrop", () => {
  it("renders a fixed blurred gradient behind the floating header", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchPlaybackState({ playing: true, muted: true, preview: true })
    })

    const backdrop = document.querySelector(
      '[data-testid="floating-header-backdrop"]',
    )
    expect(backdrop).not.toBeNull()
    expect(backdrop?.className).toContain("fixed")
    expect(backdrop?.className).toContain("z-40")
    expect(backdrop?.className).toContain("pointer-events-none")
    expect(backdrop?.className).toContain(
      "h-[calc(6rem+env(safe-area-inset-top,0px))]",
    )
    expect(backdrop?.className).toContain(
      "md:h-[calc(8rem+env(safe-area-inset-top,0px))]",
    )
    expect(backdrop?.className).toContain("backdrop-blur-[10px]")
    expect(backdrop?.className).toContain("bg-[linear-gradient")
    expect(backdrop?.className).toContain("opacity-100")
  })

  it("hides the header backdrop outside preview mode", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchPlaybackState({ playing: true, muted: true, preview: true })
    })

    const backdrop = document.querySelector(
      '[data-testid="floating-header-backdrop"]',
    )
    expect(backdrop?.className).toContain("opacity-100")

    act(() => {
      dispatchPlaybackState({ playing: false, muted: false, preview: false })
    })

    expect(backdrop?.className).toContain("opacity-0")
  })
})

describe("FloatingSearchProvider — watch playback chrome", () => {
  it("hides the floating search bar while the player is playing with sound", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    const searchButton = document.querySelector(
      '[data-testid="floating-search-desktop-button"]',
    )
    const mobileSearchButton = document.querySelector(
      '[data-testid="floating-search-mobile-button"]',
    )
    expect(searchButton?.className).toContain("opacity-100")
    expect(searchButton?.className).toContain("cursor-text")
    expect(searchButton?.className).not.toContain("cursor-pointer")
    expect(searchButton?.className).toContain("hidden")
    expect(searchButton?.className).toContain("sm:flex")
    expect(searchButton?.className).toContain(
      "top-[calc(env(safe-area-inset-top,0px)+2rem)]",
    )
    expect(searchButton?.className).toContain(
      "md:top-[calc(env(safe-area-inset-top,0px)+3rem)]",
    )
    expect(searchButton?.className).toContain("items-center")
    expect(searchButton?.className).toContain("left-4")
    expect(searchButton?.className).toContain("right-44")
    expect(searchButton?.className).toContain("sm:left-36")
    expect(searchButton?.className).toContain("md:right-52")
    expect(searchButton?.className).toContain("xl:right-60")
    expect(searchButton?.className).not.toContain("-translate-x-1/2")
    expect(searchButton?.className).not.toContain("max-w-[810px]")
    expect(searchButton?.className).toContain("hover:bg-white")
    expect(searchButton?.className).toContain("hover:text-stone-950")
    expect(mobileSearchButton).not.toBeNull()
    expect(mobileSearchButton?.className).toContain("sm:hidden")
    expect(mobileSearchButton?.className).toContain("cursor-pointer")
    expect(mobileSearchButton?.className).toContain("right-24")
    expect(mobileSearchButton?.textContent).toBe("")
    expect(
      searchButton?.querySelector('[data-testid="floating-search-icon"]'),
    ).not.toBeNull()
    expect(
      searchButton
        ?.querySelector('[data-testid="floating-search-icon"]')
        ?.getAttribute("class"),
    ).toContain("group-hover:drop-shadow-none")

    act(() => {
      dispatchPlaybackState({ playing: true, muted: false })
    })

    expect(searchButton?.className).toContain("opacity-0")
    expect(mobileSearchButton?.className).toContain("opacity-0")

    act(() => {
      dispatchPlaybackState({ playing: false, muted: false })
    })

    expect(searchButton?.className).toContain("opacity-100")
    expect(mobileSearchButton?.className).toContain("opacity-100")
  })

  it("keeps the floating search bar visible for muted playback", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchPlaybackState({ playing: true, muted: true })
    })

    const searchButton = document.querySelector(
      '[data-testid="floating-search-desktop-button"]',
    )
    expect(searchButton?.className).toContain("opacity-100")
  })

  it("reveals the floating search bar while hovering the header during playback", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    const searchButton = document.querySelector(
      '[data-testid="floating-search-desktop-button"]',
    )
    const mobileSearchButton = document.querySelector(
      '[data-testid="floating-search-mobile-button"]',
    )
    const hoverZone = document.querySelector(
      '[data-testid="floating-header-hover-zone"]',
    )

    act(() => {
      dispatchPlaybackState({ playing: true, muted: false })
    })

    expect(searchButton?.className).toContain("opacity-0")
    expect(mobileSearchButton?.className).toContain("opacity-0")
    expect(hoverZone?.className).toContain("pointer-events-auto")

    act(() => {
      hoverZone?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    })

    expect(searchButton?.className).toContain("opacity-100")
    expect(mobileSearchButton?.className).toContain("opacity-100")

    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientY: 200 }))
    })

    expect(searchButton?.className).toContain("opacity-0")
    expect(mobileSearchButton?.className).toContain("opacity-0")
  })
})

describe("FloatingSearchProvider — language switcher chrome", () => {
  it("renders the language globe as part of the floating header", () => {
    const onLanguageClick = vi.fn()
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchLanguageSwitcher({ visible: true, onClick: onLanguageClick })
    })

    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    ) as HTMLButtonElement | null
    expect(languageButton).not.toBeNull()
    expect(languageButton?.className).toContain("fixed")
    expect(languageButton?.className).toContain("right-10")
    expect(languageButton?.className).toContain(
      "top-[calc(env(safe-area-inset-top,0px)+2rem)]",
    )
    expect(languageButton?.className).toContain(
      "md:top-[calc(env(safe-area-inset-top,0px)+3rem)]",
    )
    expect(languageButton?.className).toContain("h-[52px]")
    expect(languageButton?.className).toContain("z-50")
    expect(languageButton?.className).toContain("cursor-pointer")
    expect(languageButton?.querySelector("svg")?.className.baseVal).toContain(
      "drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)]",
    )
    expect(
      document.querySelector('[data-testid="floating-header-animated-icon"]'),
    ).toBeNull()

    const logo = document.querySelector('[data-testid="floating-header-logo"]')
    expect(logo?.className).toContain(
      "top-[calc(env(safe-area-inset-top,0px)+2rem)]",
    )
    expect(logo?.className).toContain(
      "md:top-[calc(env(safe-area-inset-top,0px)+3rem)]",
    )
    expect(logo?.className).toContain("h-[52px]")
    expect(logo?.className).toContain("flex")
    expect(logo?.className).not.toContain("hidden")
    expect(logo?.querySelector("img")?.getAttribute("class")).toContain(
      "max-w-[42px]",
    )

    act(() => {
      languageButton?.click()
    })

    expect(onLanguageClick).toHaveBeenCalledTimes(1)
  })

  it("hides the floating language globe with the rest of the header chrome", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchLanguageSwitcher({ visible: true, onClick: vi.fn() })
      dispatchChromeVisibility(false)
    })

    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    )
    expect(languageButton?.className).toContain("opacity-0")
    expect(
      document.querySelector('[data-testid="floating-header-animated-icon"]'),
    ).toBeNull()
  })
})

describe("FloatingSearchProvider — search overlay chrome", () => {
  it("aligns the search overlay close button with the watch modal close control", async () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const searchButton = document.querySelector(
      '[aria-label="Search videos"]',
    ) as HTMLButtonElement
    act(() => {
      searchButton.click()
    })

    const close = document.querySelector(
      '[data-testid="search-overlay-close"]',
    ) as HTMLButtonElement | null
    const pageWrapper = document.querySelector("[inert]")
    const topBar = document.querySelector(
      '[data-testid="search-overlay-top-bar"]',
    )
    const overlay = document.querySelector(
      '[aria-label="Search and browse videos"]',
    )
    const overlayField = document.querySelector('[role="search"]')
    const mobileLogo = document.querySelector(
      '[data-testid="search-overlay-top-bar"] a[aria-label="JesusFilm home"]',
    )
    const bottomBackdrop = document.querySelector(
      '[data-testid="search-overlay-bottom-backdrop"]',
    )
    const scrollBody = document.querySelector(".search-overlay-scroll")
    expect(close).not.toBeNull()
    expect(pageWrapper?.className).toContain("blur-[12px]")
    expect(pageWrapper?.className).not.toContain("brightness-50")
    expect(overlay?.contains(close)).toBe(true)
    expect(overlay?.className).toContain("h-dvh")
    expect(overlay?.className).toContain("min-h-dvh")
    expect(topBar?.className).toContain("pt-6")
    expect(topBar?.className).toContain("sm:pt-12")
    expect(mobileLogo?.className).toContain("mb-6")
    expect(mobileLogo?.className).not.toContain("absolute")
    expect(bottomBackdrop).not.toBeNull()
    expect(bottomBackdrop?.className).toContain("absolute")
    expect(bottomBackdrop?.className).toContain("bottom-[-14rem]")
    expect(bottomBackdrop?.className).toContain("bg-black/85")
    expect(bottomBackdrop?.className).toContain("backdrop-blur-[14px]")
    expect(scrollBody?.className).toContain("z-1")
    expect(scrollBody?.className).toContain("pt-44")
    expect(scrollBody?.className).toContain("sm:pt-32")
    expect(overlayField).not.toBeNull()
    expect(overlayField?.className).toContain("rounded-[35px]")
    expect(overlayField?.className).toContain("bg-white")
    expect(
      document.querySelector('[data-testid="search-overlay-input-icon"]'),
    ).not.toBeNull()
    expect(close?.className).toContain("fixed")
    expect(close?.className).toContain("top-6")
    expect(close?.className).toContain("right-4")
    expect(close?.className).toContain("sm:top-12")
    expect(close?.className).toContain("sm:right-10")
    expect(close?.className).toContain("h-[52px]")
    expect(close?.className).toContain("w-12")
    expect(close?.className).toContain("z-[60]")
    expect(close?.querySelector("svg")?.getAttribute("class")).toContain("h-6")
    expect(close?.querySelector("svg")?.getAttribute("class")).toContain("w-6")
  })
})
