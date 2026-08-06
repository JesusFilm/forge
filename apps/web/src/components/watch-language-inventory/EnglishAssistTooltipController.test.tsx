// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EnglishAssistTooltipController } from "./EnglishAssistTooltipController"

function makeRect({
  height = 0,
  left = 0,
  top = 0,
  width = 0,
}: Partial<DOMRect> = {}): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function pointerEvent(
  type: "pointerdown" | "pointerover" | "pointerout",
  pointerType: "mouse" | "touch",
  relatedTarget: EventTarget | null = null,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    relatedTarget: relatedTarget as EventTarget | null,
  })
  Object.defineProperty(event, "pointerType", { value: pointerType })
  return event
}

describe("EnglishAssistTooltipController", () => {
  let container: HTMLDivElement
  let root: Root
  let animationFrames: Map<number, FrameRequestCallback>
  let nextAnimationFrameId: number

  beforeEach(() => {
    animationFrames = new Map()
    nextAnimationFrameId = 1
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextAnimationFrameId++
      animationFrames.set(id, callback)
      return id
    })
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      animationFrames.delete(id)
    })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<EnglishAssistTooltipController />))
  })

  afterEach(() => {
    act(() => root.unmount())
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  function flushAnimationFrames() {
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()
    act(() => callbacks.forEach((callback) => callback(0)))
  }

  function addTarget(
    token = "openVideo",
    text = token === "openCollection" ? "Open collection" : "Open video",
  ) {
    const button = document.createElement("button")
    button.textContent = "Lahatsary"
    button.setAttribute("aria-label", "Lahatsary")
    button.dataset.englishAssist = token
    button.title = text
    document.body.appendChild(button)
    return button
  }

  it("shows English on focus without replacing the localized name", () => {
    const button = addTarget()

    act(() => button.focus())

    const tooltip = document.querySelector('[role="tooltip"]')
    expect(button.getAttribute("aria-label")).toBe("Lahatsary")
    expect(button.title).toBe("Open video")
    expect(tooltip?.textContent).toBe("Open video")
    expect(tooltip?.getAttribute("lang")).toBe("en")
    expect(tooltip?.getAttribute("dir")).toBe("ltr")

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      )
    })

    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it("uses one hover tooltip and restores the native title", () => {
    const first = addTarget("openVideo")
    const second = addTarget("openCollection")

    act(() => first.dispatchEvent(pointerEvent("pointerover", "mouse")))
    expect(first.getAttribute("title")).toBe("")
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Open video",
    )

    act(() => second.dispatchEvent(pointerEvent("pointerover", "mouse")))
    expect(first.title).toBe("Open video")
    expect(second.getAttribute("title")).toBe("")
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Open collection",
    )

    act(() =>
      second.dispatchEvent(pointerEvent("pointerout", "mouse", document.body)),
    )
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(second.title).toBe("Open collection")
  })

  it("blocks inherited native titles and restores the target exactly", () => {
    const titledAncestor = document.createElement("div")
    titledAncestor.title = "Ancestor help"
    const button = addTarget()
    button.removeAttribute("title")
    const label = document.createElement("span")
    label.textContent = "Nested label"
    button.replaceChildren(label)
    titledAncestor.appendChild(button)
    document.body.appendChild(titledAncestor)

    act(() => label.dispatchEvent(pointerEvent("pointerover", "mouse")))

    expect(button.getAttribute("title")).toBe("")
    expect(titledAncestor.getAttribute("title")).toBe("Ancestor help")
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Open video",
    )

    act(() =>
      label.dispatchEvent(pointerEvent("pointerout", "mouse", document.body)),
    )

    expect(button.hasAttribute("title")).toBe(false)
    expect(titledAncestor.getAttribute("title")).toBe("Ancestor help")
  })

  it("keeps first-tap activation independent from tooltip help", () => {
    const button = addTarget()
    const onClick = vi.fn()
    button.addEventListener("click", onClick)

    act(() => {
      button.dispatchEvent(pointerEvent("pointerover", "touch"))
      button.click()
    })

    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(button.title).toBe("Open video")
  })

  it("dismisses hover help on pointer activation and restores keyboard help", () => {
    const button = addTarget()

    act(() => button.dispatchEvent(pointerEvent("pointerover", "mouse")))
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()

    act(() => {
      button.dispatchEvent(pointerEvent("pointerdown", "mouse"))
      button.focus()
    })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(button.title).toBe("Open video")

    act(() => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
      )
    })
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Open video",
    )
  })

  it("keeps the tooltip visible while the pointer moves through it", () => {
    const button = addTarget()

    act(() => button.dispatchEvent(pointerEvent("pointerover", "mouse")))
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')
    const bridge = document.querySelector<HTMLElement>(
      '[data-testid="english-assist-tooltip-pointer-bridge"]',
    )

    act(() => button.dispatchEvent(pointerEvent("pointerout", "mouse", bridge)))
    expect(document.querySelector('[role="tooltip"]')).toBe(tooltip)

    act(() =>
      bridge?.dispatchEvent(pointerEvent("pointerout", "mouse", document.body)),
    )
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(button.title).toBe("Open video")
  })

  it("returns to focused help after a hovered target is left", () => {
    const focused = addTarget("openVideo")
    const hovered = addTarget("openCollection")

    act(() => focused.focus())
    act(() => hovered.dispatchEvent(pointerEvent("pointerover", "mouse")))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Open collection",
    )

    act(() =>
      hovered.dispatchEvent(pointerEvent("pointerout", "mouse", document.body)),
    )
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Open video",
    )
    expect(hovered.title).toBe("Open collection")
    expect(document.activeElement).toBe(focused)
  })

  it("chooses the side with room and clamps the measured box to viewport padding", () => {
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 200,
    })
    const lowerSpace = addTarget("openVideo")
    const upperSpace = addTarget("openCollection")
    const constrained = addTarget("openVideo")
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRectMock(this: HTMLElement) {
        if (this === lowerSpace) {
          return makeRect({ height: 20, left: 100, top: 20, width: 20 })
        }
        if (this === upperSpace) {
          return makeRect({ height: 20, left: 100, top: 160, width: 20 })
        }
        if (this === constrained) {
          return makeRect({ height: 20, left: 100, top: 80, width: 20 })
        }
        if (this.getAttribute("role") === "tooltip") {
          return makeRect({ height: 80, width: 120 })
        }
        return makeRect()
      },
    )

    try {
      act(() => lowerSpace.dispatchEvent(pointerEvent("pointerover", "mouse")))
      flushAnimationFrames()
      let tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')
      expect(tooltip?.dataset.placement).toBe("below")
      expect(tooltip?.style.top).toBe("48px")

      act(() => upperSpace.dispatchEvent(pointerEvent("pointerover", "mouse")))
      flushAnimationFrames()
      tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')
      expect(tooltip?.dataset.placement).toBe("above")
      expect(tooltip?.style.top).toBe("72px")

      act(() => constrained.dispatchEvent(pointerEvent("pointerover", "mouse")))
      flushAnimationFrames()
      tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')
      expect(tooltip?.dataset.placement).toBe("below")
      expect(tooltip?.style.top).toBe("104px")
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      })
    }
  })

  it("repositions in animation frames after scroll and resize", () => {
    const button = addTarget()
    let targetLeft = 100
    let targetTop = 100
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRectMock(this: HTMLElement) {
        if (this === button) {
          return makeRect({
            height: 20,
            left: targetLeft,
            top: targetTop,
            width: 20,
          })
        }
        if (this.getAttribute("role") === "tooltip") {
          return makeRect({ height: 40, width: 100 })
        }
        return makeRect()
      },
    )

    act(() => button.dispatchEvent(pointerEvent("pointerover", "mouse")))
    flushAnimationFrames()
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')
    expect(tooltip?.style.left).toBe("110px")
    expect(tooltip?.style.top).toBe("52px")

    act(() => {
      targetLeft = 200
      targetTop = 180
      window.dispatchEvent(new Event("scroll"))
    })
    expect(tooltip?.style.top).toBe("52px")
    flushAnimationFrames()
    expect(tooltip?.style.left).toBe("210px")
    expect(tooltip?.style.top).toBe("132px")

    act(() => {
      targetTop = 20
      window.dispatchEvent(new Event("resize"))
    })
    expect(tooltip?.style.top).toBe("132px")
    flushAnimationFrames()
    expect(tooltip?.dataset.placement).toBe("below")
    expect(tooltip?.style.top).toBe("48px")
  })

  it("cleans up when the active target disconnects before repositioning", () => {
    const button = addTarget()

    act(() => button.dispatchEvent(pointerEvent("pointerover", "mouse")))
    flushAnimationFrames()
    expect(button.getAttribute("title")).toBe("")

    act(() => {
      button.remove()
      window.dispatchEvent(new Event("resize"))
    })
    flushAnimationFrames()

    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(button.title).toBe("Open video")
  })
})
