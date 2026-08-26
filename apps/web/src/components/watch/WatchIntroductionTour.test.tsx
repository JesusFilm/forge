/** @vitest-environment jsdom */

import { act, createRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WatchIntroductionTour } from "@/components/watch/WatchIntroductionTour"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1280,
  })
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  Object.defineProperty(document.documentElement, "dir", {
    configurable: true,
    value: "",
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function flushDialogEffects() {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 30))
  })
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  ) as HTMLButtonElement
}

function Harness({
  onSkip = vi.fn(),
  onComplete = vi.fn(),
  onSignup = vi.fn(),
}: {
  onSkip?: () => void
  onComplete?: () => void
  onSignup?: () => boolean | void
}) {
  const [open, setOpen] = useState(true)
  return (
    <WatchIntroductionTour
      open={open}
      onSkip={() => {
        onSkip()
        setOpen(false)
      }}
      onComplete={() => {
        onComplete()
        setOpen(false)
      }}
      onSignup={() => {
        const accepted = onSignup()
        if (accepted !== false) setOpen(false)
        return accepted !== false
      }}
      finalFocus={createRef<HTMLElement>()}
    />
  )
}

describe("WatchIntroductionTour", () => {
  it("exposes title, description, and visible localized progress while navigating within four steps", async () => {
    act(() => root.render(<Harness />))
    await flushDialogEffects()

    const dialog = document.querySelector("[role='dialog']") as HTMLElement
    const title = document.querySelector(
      "[data-slot='dialog-title']",
    ) as HTMLElement
    const description = document.querySelector(
      "[data-slot='dialog-description']",
    ) as HTMLElement
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id)
    expect(dialog.getAttribute("aria-describedby")).toBe(description.id)
    expect(document.body.textContent).toContain("Step 1 of 4")
    expect(title.textContent).toBe("Discover free films and stories")
    expect(button("Back")).toBeUndefined()
    expect(document.activeElement).toBe(
      document.querySelector("[data-testid='watch-introduction-tour-close']"),
    )
    expect(
      dialog.contains(
        document.querySelector("[data-testid='watch-introduction-tour-close']"),
      ),
    ).toBe(true)

    act(() => button("Next").click())
    expect(document.body.textContent).toContain("Step 2 of 4")
    expect(title.textContent).toBe("Search for what matters to you")
    act(() => button("Back").click())
    expect(document.body.textContent).toContain("Step 1 of 4")
  })

  it.each(["Skip", "Close"])("calls Skip once through %s", async (action) => {
    const onSkip = vi.fn()
    act(() => root.render(<Harness onSkip={onSkip} />))
    await flushDialogEffects()

    const control =
      action === "Close"
        ? (document.querySelector(
            "[data-testid='watch-introduction-tour-close']",
          ) as HTMLButtonElement)
        : button(action)
    act(() => control.click())
    await flushDialogEffects()
    expect(onSkip).toHaveBeenCalledOnce()
  })

  it("calls Skip once on Escape", async () => {
    const onSkip = vi.fn()
    act(() => root.render(<Harness onSkip={onSkip} />))
    await flushDialogEffects()
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    )
    await flushDialogEffects()
    expect(onSkip).toHaveBeenCalledOnce()
  })

  it("uses signup as the primary final action and Done as the secondary completion", async () => {
    const onComplete = vi.fn()
    const onSignup = vi.fn()
    act(() =>
      root.render(<Harness onComplete={onComplete} onSignup={onSignup} />),
    )
    await flushDialogEffects()
    act(() => button("Next").click())
    act(() => button("Next").click())
    act(() => button("Next").click())

    expect(button("Skip")).toBeUndefined()
    expect(button("Join the beta group").dataset.variant).toBe("primary")
    expect(button("Done").dataset.variant).toBe("secondary")
    expect(
      [
        ...document.querySelectorAll(
          "[data-testid='watch-introduction-actions'] button",
        ),
      ].map((item) => item.textContent?.trim()),
    ).toEqual(["Back", "Done", "Join the beta group"])

    act(() => button("Done").click())
    await flushDialogEffects()
    expect(onComplete).toHaveBeenCalledOnce()
    expect(onSignup).not.toHaveBeenCalled()
  })

  it("calls the signup action once from the final primary button", async () => {
    const onSignup = vi.fn()
    act(() => root.render(<Harness onSignup={onSignup} />))
    await flushDialogEffects()
    act(() => button("Next").click())
    act(() => button("Next").click())
    act(() => button("Next").click())
    act(() => button("Join the beta group").click())
    await flushDialogEffects()

    expect(onSignup).toHaveBeenCalledOnce()
  })

  it("keeps the final step open and announces when signup is temporarily unavailable", async () => {
    const onSignup = vi.fn(() => false)
    act(() => root.render(<Harness onSignup={onSignup} />))
    await flushDialogEffects()
    act(() => button("Next").click())
    act(() => button("Next").click())
    act(() => button("Next").click())
    act(() => button("Join the beta group").click())

    expect(onSignup).toHaveBeenCalledOnce()
    expect(document.querySelector("[role='dialog']")).not.toBeNull()
    expect(document.querySelector("[role='status']")?.textContent).toBe(
      "Sign-up is unavailable right now. Please try again.",
    )
  })

  it("outlines the live search target without making it interactive and cleans listeners", async () => {
    const search = document.createElement("button")
    search.dataset.testid = "floating-search-desktop-button"
    search.getBoundingClientRect = () =>
      ({
        left: 320,
        right: 880,
        top: 24,
        bottom: 76,
        width: 560,
        height: 52,
        x: 320,
        y: 24,
        toJSON() {},
      }) as DOMRect
    document.body.appendChild(search)
    const addSpy = vi.spyOn(window, "addEventListener")
    const removeSpy = vi.spyOn(window, "removeEventListener")

    act(() => root.render(<Harness />))
    await flushDialogEffects()
    act(() => button("Next").click())
    await flushDialogEffects()

    const outline = document.querySelector(
      "[data-testid='watch-introduction-target-outline']",
    ) as HTMLElement
    expect(outline.getAttribute("aria-hidden")).toBe("true")
    expect(outline.style.left).toBe("312px")
    expect(search.inert).toBe(true)
    expect(
      document.querySelector("[data-watch-tour-layout='targeted']"),
    ).not.toBeNull()
    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function), {
      passive: true,
    })
    expect(addSpy).toHaveBeenCalledWith("scroll", expect.any(Function), {
      passive: true,
      capture: true,
    })

    act(() => button("Next").click())
    expect(search.inert).toBe(false)
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true)
  })

  it("falls back to a centered card when a target is missing or forced colors are active", async () => {
    const forcedColors = vi.fn((query: string) => ({
      matches: query === "(forced-colors: active)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    vi.stubGlobal("matchMedia", forcedColors)
    act(() => root.render(<Harness />))
    await flushDialogEffects()
    act(() => button("Next").click())
    await flushDialogEffects()

    expect(
      document.querySelector("[data-watch-tour-layout='centered']"),
    ).not.toBeNull()
    expect(
      document.querySelector(
        "[data-testid='watch-introduction-target-outline']",
      ),
    ).toBeNull()
    expect(document.querySelector("[data-forced-colors='true']")).not.toBeNull()
  })

  it("keeps narrow actions stacked in logical DOM order for RTL and disables motion when requested", async () => {
    Object.defineProperty(document.documentElement, "dir", {
      configurable: true,
      value: "rtl",
    })
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    })
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    act(() => root.render(<Harness />))
    await flushDialogEffects()

    const actions = document.querySelector(
      "[data-testid='watch-introduction-actions']",
    ) as HTMLElement
    expect(actions.className).toContain("flex-col")
    expect(
      [...actions.querySelectorAll("button")].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["Skip", "Next"])
    expect(
      document.querySelector("[data-testid='watch-introduction-tour']")
        ?.className,
    ).toContain("motion-reduce:transition-none")
  })
})
