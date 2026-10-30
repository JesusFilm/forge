// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NumberField } from "./number-field"
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe("numeric label scrubbing", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const change = vi.fn()
  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    change.mockClear()
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.releasePointerCapture = vi.fn()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })
  async function render(
    props: Partial<React.ComponentProps<typeof NumberField>> = {},
  ) {
    await act(async () =>
      root.render(
        React.createElement(NumberField, {
          label: "Scale",
          value: 1,
          step: 0.05,
          min: 0.1,
          max: 2,
          onChange: change,
          ...props,
        }),
      ),
    )
    return container.querySelector(".nle-number-label, .nle-number-unit")!
  }
  async function pointer(
    target: Element,
    type: string,
    x: number,
    shiftKey = false,
  ) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      button: 0,
      shiftKey,
    })
    Object.defineProperty(event, "pointerId", { value: 1 })
    await act(async () => {
      target.dispatchEvent(event)
    })
  }
  it("previews fractional steps and commits once on release", async () => {
    const label = await render()
    await pointer(label, "pointerdown", 100)
    await pointer(label, "pointermove", 120)
    expect(container.querySelector("input")!.value).toBe("1.25")
    expect(change).not.toHaveBeenCalled()
    await pointer(label, "pointermove", 124)
    await pointer(label, "pointerup", 124)
    expect(change).toHaveBeenCalledExactlyOnceWith(1.3)
    await pointer(label, "lostpointercapture", 124)
    expect(change).toHaveBeenCalledTimes(1)
  })
  it("clamps to bounds and restores the draft when cancelled", async () => {
    const label = await render()
    await pointer(label, "pointerdown", 100)
    await pointer(label, "pointermove", 400)
    expect(container.querySelector("input")!.value).toBe("2")
    await pointer(label, "pointermove", -400)
    expect(container.querySelector("input")!.value).toBe("0.1")
    await pointer(label, "pointercancel", -400)
    expect(container.querySelector("input")!.value).toBe("1")
    expect(change).not.toHaveBeenCalled()
  })
  it("uses ten-times steps with Shift and respects bounds", async () => {
    const label = await render()
    await pointer(label, "pointerdown", 100, true)
    await pointer(label, "pointermove", 104, true)
    expect(container.querySelector("input")!.value).toBe("1.5")
    await pointer(label, "pointermove", 140, true)
    expect(container.querySelector("input")!.value).toBe("2")
    await pointer(label, "pointermove", 60, true)
    expect(container.querySelector("input")!.value).toBe("0.1")
    await pointer(label, "pointerup", 60, true)
    expect(change).toHaveBeenCalledExactlyOnceWith(0.1)
  })
  it("switches Shift during a drag without rescaling earlier movement", async () => {
    const label = await render()
    await pointer(label, "pointerdown", 100)
    await pointer(label, "pointermove", 108)
    expect(container.querySelector("input")!.value).toBe("1.1")
    await pointer(label, "pointermove", 108, true)
    expect(container.querySelector("input")!.value).toBe("1.1")
    await pointer(label, "pointermove", 112, true)
    expect(container.querySelector("input")!.value).toBe("1.6")
    await pointer(label, "pointermove", 112)
    expect(container.querySelector("input")!.value).toBe("1.6")
    await pointer(label, "pointermove", 116)
    expect(container.querySelector("input")!.value).toBe("1.65")
    await pointer(label, "pointerup", 116)
    expect(change).toHaveBeenCalledExactlyOnceWith(1.65)
  })
  it("rounds only the display and preserves precision on blur or label click", async () => {
    const label = await render({ value: 1.23456789, decimalPlaces: 2 })
    const input = container.querySelector("input")!
    expect(input.value).toBe("1.23")
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    })
    await pointer(label, "pointerdown", 100)
    await pointer(label, "pointermove", 101)
    await pointer(label, "pointerup", 101)
    expect(change).not.toHaveBeenCalled()
    expect(input.value).toBe("1.23")
  })
  it("scrubs from the precise stored value while showing two decimals", async () => {
    const label = await render({ value: 1.23456789, decimalPlaces: 2 })
    await pointer(label, "pointerdown", 100)
    await pointer(label, "pointermove", 104)
    expect(container.querySelector("input")!.value).toBe("1.28")
    await pointer(label, "pointerup", 104)
    expect(change).toHaveBeenCalledExactlyOnceWith(1.28456789)
  })
  it("commits typed precision and formats the resulting value", async () => {
    await render({ value: 1.23456789, decimalPlaces: 2 })
    const input = container.querySelector("input")!
    input.value = "1.87654321"
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    })
    expect(change).toHaveBeenCalledExactlyOnceWith(1.87654321)
    await render({ value: 1.87654321, decimalPlaces: 2 })
    expect(container.querySelector("input")!.value).toBe("1.88")
    await render({ value: 1, decimalPlaces: 2 })
    expect(container.querySelector("input")!.value).toBe("1")
  })
  it("coalesces live previews to one frame and commits only on release", async () => {
    const preview = vi.fn()
    let frame: FrameRequestCallback | undefined
    const request = vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal("requestAnimationFrame", request)
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    const label = await render({ onPreview: preview })
    await pointer(label, "pointerdown", 100)
    await pointer(label, "pointermove", 104)
    await pointer(label, "pointermove", 108)
    expect(request).toHaveBeenCalledTimes(1)
    expect(preview).not.toHaveBeenCalled()
    await act(async () => frame!(0))
    expect(preview).toHaveBeenCalledExactlyOnceWith(1.1)
    expect(change).not.toHaveBeenCalled()
    await pointer(label, "pointerup", 108)
    expect(preview).toHaveBeenLastCalledWith(null)
    expect(change).toHaveBeenCalledExactlyOnceWith(1.1)
  })
  it.each(["pointercancel", "lostpointercapture", "blur", "unmount"])(
    "cancels pending previews on %s without committing",
    async (reason) => {
      const preview = vi.fn()
      vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn(() => 42),
      )
      const cancelFrame = vi.fn()
      vi.stubGlobal("cancelAnimationFrame", cancelFrame)
      const label = await render({ onPreview: preview })
      await pointer(label, "pointerdown", 100)
      await pointer(label, "pointermove", 108)
      if (reason === "blur")
        await act(async () => {
          window.dispatchEvent(new Event("blur"))
        })
      else if (reason === "unmount") await act(async () => root.render(null))
      else await pointer(label, reason, 108)
      expect(cancelFrame).toHaveBeenCalledWith(42)
      expect(preview).toHaveBeenCalledExactlyOnceWith(null)
      expect(change).not.toHaveBeenCalled()
      if (reason !== "unmount")
        expect(container.querySelector("input")!.value).toBe("1")
    },
  )
  it("allows crop unit dragging and respects disabled fieldsets", async () => {
    const unit = await render({
      label: "Crop top (%)",
      hideLabel: true,
      unit: "%",
      value: 0,
      step: 1,
      min: 0,
      max: 99,
    })
    expect(unit.textContent).toBe("%")
    await pointer(unit, "pointerdown", 100)
    await pointer(unit, "pointermove", 140)
    await pointer(unit, "pointerup", 140)
    expect(change).toHaveBeenCalledExactlyOnceWith(10)
    change.mockClear()
    const fieldset = document.createElement("fieldset")
    fieldset.disabled = true
    container.append(fieldset)
    fieldset.append(container.querySelector("label")!)
    await pointer(unit, "pointerdown", 100)
    await pointer(unit, "pointermove", 140)
    await pointer(unit, "pointerup", 140)
    expect(change).not.toHaveBeenCalled()
    // Restore React's ownership before cleanup.
    container.append(fieldset.firstChild!)
    fieldset.remove()
  })
})
