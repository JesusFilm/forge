/** @vitest-environment jsdom */

import { act, createRef, useRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BetaTesterModal } from "@/components/watch/BetaTesterModal"
import { BETA_TESTER_URL } from "@/lib/beta-tester"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
})

async function flushDialogEffects() {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 30))
  })
}

function ModalHarness() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="beta-tester-modal-trigger"
        onClick={() => setOpen(true)}
      >
        Open beta signup
      </button>
      <BetaTesterModal
        open={open}
        onClose={() => setOpen(false)}
        finalFocus={triggerRef}
      />
    </>
  )
}

describe("BetaTesterModal", () => {
  it("frames the exact Mailchimp form with an accessible dialog contract", () => {
    act(() =>
      root.render(
        <BetaTesterModal
          open
          onClose={vi.fn()}
          finalFocus={createRef<HTMLElement>()}
        />,
      ),
    )

    expect(document.querySelector("[role='dialog']")).not.toBeNull()
    expect(
      document.querySelector("[data-slot='dialog-title']")?.textContent,
    ).toBe("Become a beta tester")

    const iframe = document.querySelector("iframe") as HTMLIFrameElement
    expect(iframe.getAttribute("src")).toBe(BETA_TESTER_URL)
    expect(iframe.title).toBe("Become a beta tester")
    expect(iframe.getAttribute("sandbox")).toBe(
      "allow-forms allow-scripts allow-same-origin",
    )
    expect(iframe.getAttribute("referrerpolicy")).toBe(
      "strict-origin-when-cross-origin",
    )

    const fallback = document.querySelector(
      `a[href='${BETA_TESTER_URL}']`,
    ) as HTMLAnchorElement
    expect(fallback.target).toBe("_blank")
    expect(fallback.rel).toBe("noopener noreferrer nofollow")
  })

  it("shows loading feedback above the iframe until it loads", () => {
    act(() =>
      root.render(
        <BetaTesterModal
          open
          onClose={vi.fn()}
          finalFocus={createRef<HTMLElement>()}
        />,
      ),
    )

    const iframe = document.querySelector("iframe") as HTMLIFrameElement
    const loader = document.querySelector(".z-20")
    expect(loader?.textContent).toContain("Loading...")

    act(() => iframe.dispatchEvent(new Event("load")))
    expect(document.querySelector(".z-20")).toBeNull()
  })

  it("focuses close, restores the trigger, and creates a fresh iframe", async () => {
    act(() => root.render(<ModalHarness />))
    const trigger = document.querySelector(
      "[data-testid='beta-tester-modal-trigger']",
    ) as HTMLButtonElement

    act(() => trigger.click())
    await flushDialogEffects()

    const close = document.querySelector(
      "[data-testid='beta-tester-modal-close']",
    ) as HTMLButtonElement
    const firstIframe = document.querySelector("iframe")
    expect(document.activeElement).toBe(close)
    expect(close.style.top).toContain("safe-area-inset-top")
    expect(close.style.right).toContain("safe-area-inset-right")
    expect(close.className).toContain("z-[1100]")
    expect(firstIframe).not.toBeNull()

    act(() => firstIframe?.dispatchEvent(new Event("load")))
    expect(document.querySelector(".z-20")).toBeNull()

    act(() => close.click())
    await flushDialogEffects()
    expect(document.querySelector("iframe")).toBeNull()
    expect(document.activeElement).toBe(trigger)

    act(() => trigger.click())
    await flushDialogEffects()
    const reopenedIframe = document.querySelector("iframe")
    expect(reopenedIframe).not.toBeNull()
    expect(reopenedIframe).not.toBe(firstIframe)
    expect(document.querySelector(".z-20")?.textContent).toContain("Loading...")
  })

  it("dismisses on Escape", async () => {
    const onClose = vi.fn()
    act(() =>
      root.render(
        <BetaTesterModal
          open
          onClose={onClose}
          finalFocus={createRef<HTMLElement>()}
        />,
      ),
    )
    await flushDialogEffects()

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
    })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it("dismisses through the overlay", () => {
    const onClose = vi.fn()
    act(() =>
      root.render(
        <BetaTesterModal
          open
          onClose={onClose}
          finalFocus={createRef<HTMLElement>()}
        />,
      ),
    )

    const overlay = document.querySelector(
      "[data-slot='dialog-overlay']",
    ) as HTMLElement
    act(() => {
      overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onClose).toHaveBeenCalledOnce()
  })
})
