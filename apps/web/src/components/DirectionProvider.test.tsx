/** @vitest-environment jsdom */

import { act, type ReactNode } from "react"
import { hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DirectionProvider,
  useDirection,
  type TextDirection,
} from "./DirectionProvider"

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  container?.remove()
  container = null
  root = null
})

function DirectionProbe() {
  const direction = useDirection()
  return <span data-direction={direction}>{direction}</span>
}

function tree(direction: TextDirection, children: ReactNode) {
  return <DirectionProvider direction={direction}>{children}</DirectionProvider>
}

describe("DirectionProvider", () => {
  it("server-renders the seeded direction for client consumers", () => {
    const html = renderToString(tree("rtl", <DirectionProbe />))

    expect(html).toContain('data-direction="rtl"')
    expect(html).toContain(">rtl</span>")
  })

  it("hydrates an RTL server seed without warnings or a direction mismatch", async () => {
    container = document.createElement("div")
    container.innerHTML = renderToString(tree("rtl", <DirectionProbe />))
    document.body.appendChild(container)
    const onRecoverableError = vi.fn()

    await act(async () => {
      root = hydrateRoot(container!, tree("rtl", <DirectionProbe />), {
        onRecoverableError,
      })
    })

    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(container.querySelector("span")?.dataset.direction).toBe("rtl")
  })

  it("preserves standalone LTR rendering outside the Watch layout", () => {
    const html = renderToString(<DirectionProbe />)

    expect(html).toContain('data-direction="ltr"')
    expect(html).toContain(">ltr</span>")
  })
})
