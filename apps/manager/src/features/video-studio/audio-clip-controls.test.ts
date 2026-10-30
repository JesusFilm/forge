// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { StudioAudioItem } from "@forge/studio-contracts/audio"
import { AudioClipControls } from "./audio-clip-controls"
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
const item: StudioAudioItem = {
  id: "audio",
  kind: "audio",
  trackId: "audio",
  startFrame: 30,
  durationInFrames: 101,
  sourceStartMs: 5000,
  volume: 1,
  asset: { assetId: "music", versionId: "v1", digest: "a".repeat(64) },
}
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const change = vi.fn(),
  start = vi.fn(),
  parent = vi.fn()
beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  change.mockClear()
  start.mockClear()
  parent.mockClear()
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render(
  overrides: Partial<React.ComponentProps<typeof AudioClipControls>> = {},
) {
  await act(async () =>
    root.render(
      React.createElement(
        "div",
        { onPointerDown: parent, onPointerMove: parent, onPointerUp: parent },
        React.createElement(AudioClipControls, {
          item,
          fps: 30,
          disabled: false,
          onChange: change,
          onGestureStart: start,
          ...overrides,
        }),
      ),
    ),
  )
  container.querySelector(".nle-audio-controls")!.getBoundingClientRect = () =>
    new DOMRect(0, 0, 500, 40)
}
const slider = (name: string) =>
  container.querySelector(`[aria-label="${name}"]`)!
async function pointer(target: Element, type: string, x: number, y = 0) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  })
  Object.defineProperty(event, "pointerId", { value: 1 })
  await act(async () => {
    target.dispatchEvent(event)
  })
}
it("previews the fade locally, commits once, and does not move or trim the parent clip", async () => {
  await render()
  const handle = slider("Fade in length")
  await pointer(handle, "pointerdown", 0)
  await pointer(handle, "pointermove", 150)
  expect(handle.getAttribute("aria-valuenow")).toBe("30")
  expect(change).not.toHaveBeenCalled()
  await pointer(handle, "pointerup", 150)
  expect(change).toHaveBeenCalledExactlyOnceWith({
    volume: 1,
    audioFade: {
      fadeInFrames: 30,
      fadeOutFrames: 0,
      fadeInCurve: 0,
      fadeOutCurve: 0,
      fadeInCurvePosition: 0.5,
      fadeOutCurvePosition: 0.5,
    },
  })
  expect(start).toHaveBeenCalledTimes(1)
  expect(parent).not.toHaveBeenCalled()
})
it("clamps fade lengths against the other fade and restores cancelled edits", async () => {
  await render({
    item: {
      ...item,
      audioFade: {
        fadeInFrames: 0,
        fadeOutFrames: 40,
        fadeInCurve: 0,
        fadeOutCurve: 0,
      },
    },
  })
  const handle = slider("Fade in length")
  await pointer(handle, "pointerdown", 0)
  await pointer(handle, "pointermove", 900)
  expect(handle.getAttribute("aria-valuenow")).toBe("60")
  await pointer(handle, "pointercancel", 900)
  expect(handle.getAttribute("aria-valuenow")).toBe("0")
  expect(change).not.toHaveBeenCalled()
})
it("supports both curve directions, +30 dB and exact silence", async () => {
  await render({
    item: {
      ...item,
      audioFade: {
        fadeInFrames: 30,
        fadeOutFrames: 0,
        fadeInCurve: 0,
        fadeOutCurve: 0,
      },
    },
  })
  const curve = slider("Fade in curve")
  await pointer(curve, "pointerdown", 0, 20)
  await pointer(curve, "pointermove", 0, -20)
  expect(curve.getAttribute("aria-valuenow")).toBe("1")
  await pointer(curve, "pointermove", 0, 60)
  await pointer(curve, "pointerup", 0, 60)
  expect(change.mock.lastCall?.[0].audioFade.fadeInCurve).toBe(-1)
  change.mockClear()
  const volume = slider("Clip volume")
  await pointer(volume, "pointerdown", 0, 20)
  await pointer(volume, "pointermove", 0, -100)
  expect(document.querySelector(".nle-audio-gain-popover")?.textContent).toBe(
    "+30.0 dB",
  )
  await pointer(volume, "pointerup", 0, -100)
  expect(document.querySelector(".nle-audio-gain-popover")).toBeNull()
  expect(change.mock.lastCall?.[0].volume).toBeCloseTo(10 ** 1.5)
  change.mockClear()
  await pointer(volume, "pointerdown", 0, 20)
  await pointer(volume, "pointermove", 0, 100)
  expect(document.querySelector(".nle-audio-gain-popover")?.textContent).toBe(
    "−∞ dB",
  )
  await pointer(volume, "pointerup", 0, 100)
  expect(change.mock.lastCall?.[0].volume).toBe(0)
})
it("discards lost pointer capture and prevents edits when disabled", async () => {
  await render()
  const handle = slider("Fade out length")
  await pointer(handle, "pointerdown", 500)
  await pointer(handle, "pointermove", 300)
  await pointer(handle, "lostpointercapture", 300)
  expect(handle.getAttribute("aria-valuenow")).toBe("0")
  expect(change).not.toHaveBeenCalled()
  const volume = slider("Clip volume")
  await pointer(volume, "pointerdown", 0, 20)
  await pointer(volume, "pointermove", 0, 24)
  expect(document.querySelector(".nle-audio-gain-popover")).not.toBeNull()
  await pointer(volume, "pointercancel", 0, 24)
  expect(document.querySelector(".nle-audio-gain-popover")).toBeNull()
  expect(change).not.toHaveBeenCalled()
  await render({ disabled: true })
  await pointer(slider("Clip volume"), "pointerdown", 0)
  await pointer(slider("Clip volume"), "pointermove", 0, -100)
  await pointer(slider("Clip volume"), "pointerup", 0, -100)
  expect(change).not.toHaveBeenCalled()
})

it("moves fade dots in both axes without changing their lengths or volume", async () => {
  await render({
    item: {
      ...item,
      audioFade: {
        fadeInFrames: 40,
        fadeOutFrames: 40,
        fadeInCurve: 0,
        fadeOutCurve: 0,
      },
    },
  })
  const incoming = slider("Fade in curve")
  await pointer(incoming, "pointerdown", 100, 20)
  await pointer(incoming, "pointermove", 150, 15)
  expect((incoming as HTMLElement).style.left).toBe("30%")
  expect(Number.parseFloat((incoming as HTMLElement).style.top)).toBeLessThan(
    50,
  )
  await pointer(incoming, "pointerup", 150, 15)
  expect(change.mock.lastCall?.[0]).toMatchObject({
    volume: 1,
    audioFade: {
      fadeInFrames: 40,
      fadeOutFrames: 40,
      fadeInCurve: 0.5,
      fadeInCurvePosition: 0.75,
    },
  })
  const outgoing = slider("Fade out curve")
  await pointer(outgoing, "pointerdown", 400, 20)
  await pointer(outgoing, "pointermove", 450, 25)
  expect((outgoing as HTMLElement).style.left).toBe("90%")
  await pointer(outgoing, "pointerup", 450, 25)
  expect(change.mock.lastCall?.[0].audioFade).toMatchObject({
    fadeOutCurve: -0.5,
    fadeOutCurvePosition: 0.25,
  })
})
it("keeps shading and curve handles independent of gain without hover popups", async () => {
  const audio = {
    ...item,
    audioFade: {
      fadeInFrames: 40,
      fadeOutFrames: 20,
      fadeInCurve: 0,
      fadeOutCurve: 0,
    },
  }
  await render({ item: audio })
  const shade = container
    .querySelector(".nle-audio-fade-shade")!
    .getAttribute("d")
  const curveTop = (slider("Fade in curve") as HTMLElement).style.top
  const unityLine = (slider("Clip volume") as HTMLElement).style.top
  await render({ item: { ...audio, volume: 10 ** 1.5 } })
  expect(
    container.querySelector(".nle-audio-fade-shade")!.getAttribute("d"),
  ).toBe(shade)
  expect((slider("Fade in curve") as HTMLElement).style.top).toBe(curveTop)
  expect((slider("Clip volume") as HTMLElement).style.top).not.toBe(unityLine)
  expect(container.querySelector("output, [title]")).toBeNull()
})
