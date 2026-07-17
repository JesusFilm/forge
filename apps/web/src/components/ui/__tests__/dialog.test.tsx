/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

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

function renderDialog(viewportClassName?: string) {
  act(() => {
    root.render(
      <Dialog open>
        <DialogContent
          viewportClassName={viewportClassName}
          showCloseButton={false}
        >
          <DialogTitle>Dialog title</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
  })
}

describe("DialogContent", () => {
  it("keeps the direct popup path when no viewport is requested", () => {
    renderDialog()

    const popup = document.querySelector('[data-slot="dialog-content"]')
    expect(popup).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-viewport"]')).toBeNull()
    expect(popup?.parentElement?.getAttribute("data-slot")).toBe(
      "dialog-portal",
    )
    expect(popup?.className).toContain("fixed")
    expect(popup?.className).toContain("top-1/2")
    expect(popup?.className).toContain("sm:max-w-sm")
  })

  it("wraps the popup in an opt-in viewport", () => {
    renderDialog("fixed inset-0 overflow-y-auto")

    const viewport = document.querySelector('[data-slot="dialog-viewport"]')
    const popup = document.querySelector('[data-slot="dialog-content"]')

    expect(viewport).not.toBeNull()
    expect(viewport?.className).toContain("fixed")
    expect(viewport?.className).toContain("inset-0")
    expect(viewport?.className).toContain("overflow-y-auto")
    expect(popup?.parentElement).toBe(viewport)
    expect(popup?.className).toContain("relative")
    expect(popup?.className).not.toContain("fixed")
    expect(popup?.className).not.toContain("top-1/2")
    expect(popup?.className).not.toContain("sm:max-w-sm")
  })
})
