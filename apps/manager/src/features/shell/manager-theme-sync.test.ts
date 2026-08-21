// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MANAGER_THEME_STORAGE_KEY } from "@/lib/manager-theme"
import { StudioThemeSwitch, StudioThemeSync } from "./manager-shell"
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

type ThemeListener = (event: MediaQueryListEvent) => void

describe("Manager theme synchronization", () => {
  let mediaListener: ThemeListener | null
  let mediaMatches: boolean
  let removeMediaListener: ReturnType<typeof vi.fn>
  let localStorageSetItem: ReturnType<typeof vi.fn>
  let storedThemes: Map<string, string>
  let root: ReturnType<typeof createRoot>
  let container: HTMLDivElement
  let isUnmounted: boolean

  beforeEach(async () => {
    mediaListener = null
    mediaMatches = false
    isUnmounted = false
    removeMediaListener = vi.fn()
    storedThemes = new Map()
    localStorageSetItem = vi.fn((key: string, value: string) => {
      storedThemes.set(key, value)
    })
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => storedThemes.clear(),
        getItem: (key: string) => storedThemes.get(key) ?? null,
        removeItem: (key: string) => storedThemes.delete(key),
        setItem: localStorageSetItem,
      },
    })
    document.documentElement.dataset.theme = "light"
    document.documentElement.dataset.themeSource = "system"

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        get matches() {
          return mediaMatches
        },
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addEventListener: (_type: string, listener: ThemeListener) => {
          mediaListener = listener
        },
        removeEventListener: removeMediaListener,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(StudioThemeSync),
          React.createElement(StudioThemeSwitch),
        ),
      )
    })
  })

  afterEach(async () => {
    if (root && !isUnmounted) {
      await act(async () => {
        root.unmount()
      })
    }
    container.remove()
    vi.restoreAllMocks()
  })

  function changeSystemTheme(matches: boolean) {
    mediaMatches = matches
    act(() => {
      mediaListener?.({ matches } as MediaQueryListEvent)
    })
  }

  it("follows system and cross-tab changes until the user chooses", () => {
    changeSystemTheme(true)
    expect(document.documentElement.dataset.theme).toBe("dark")

    const switchControl = container.querySelector<HTMLButtonElement>(
      '[role="menuitemcheckbox"]',
    )
    expect(switchControl).not.toBeNull()

    act(() => {
      switchControl?.click()
    })

    expect(document.documentElement.dataset.theme).toBe("light")
    expect(document.documentElement.dataset.themeSource).toBe("user")
    expect(window.localStorage.getItem(MANAGER_THEME_STORAGE_KEY)).toBe("light")
    expect(switchControl?.getAttribute("aria-checked")).toBe("false")

    changeSystemTheme(true)
    expect(document.documentElement.dataset.theme).toBe("light")

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: MANAGER_THEME_STORAGE_KEY,
          newValue: "dark",
        }),
      )
    })
    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(switchControl?.getAttribute("aria-checked")).toBe("true")

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: MANAGER_THEME_STORAGE_KEY,
          newValue: null,
        }),
      )
    })
    expect(document.documentElement.dataset.themeSource).toBe("system")

    changeSystemTheme(false)
    expect(document.documentElement.dataset.theme).toBe("light")
  })

  it("keeps an explicit in-memory choice when storage is unavailable", () => {
    localStorageSetItem.mockImplementation(() => {
      throw new Error("storage disabled")
    })

    const switchControl = container.querySelector<HTMLButtonElement>(
      '[role="menuitemcheckbox"]',
    )
    act(() => {
      switchControl?.click()
    })

    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(document.documentElement.dataset.themeSource).toBe("user")

    changeSystemTheme(false)
    expect(document.documentElement.dataset.theme).toBe("dark")
  })

  it("removes the system listener on unmount", async () => {
    await act(async () => {
      root.unmount()
    })
    isUnmounted = true

    expect(removeMediaListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    )
  })
})
