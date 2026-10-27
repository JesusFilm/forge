// @vitest-environment jsdom
import React, { act, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Short } from "@forge/studio-contracts"
import { EditorSession } from "./editor-session"
import { CanvasSelection } from "./canvas-selection"
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
const asset = { assetId: "fixture", versionId: "v1", digest: "a".repeat(64) }
const project: Short = {
  projectId: "selection",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "operator" },
  document: {
    version: 1,
    title: "Selection",
    language: "english",
    runtimeVersion: "studio-proof-1",
    width: 300,
    height: 300,
    fps: 30,
    durationInFrames: 90,
    tracks: [
      { id: "back", kind: "visual" },
      { id: "front", kind: "visual" },
    ],
    components: [],
    items: [
      {
        id: "background",
        kind: "image",
        trackId: "back",
        startFrame: 0,
        durationInFrames: 90,
        asset,
      },
      {
        id: "foreground",
        kind: "image",
        trackId: "front",
        startFrame: 0,
        durationInFrames: 90,
        asset,
      },
    ],
  },
}
let container: HTMLDivElement,
  root: ReturnType<typeof createRoot>,
  session: EditorSession
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.closest('[data-studio-item="foreground"]')
        ? new DOMRect(20, 20, 60, 60)
        : new DOMRect(0, 0, 300, 300)
    },
  )
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  session = new EditorSession(structuredClone(project), {
    read: async () => project,
    apply: vi.fn(),
  })
  session.select("background")
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function App() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  return React.createElement(
    "div",
    { className: "nle-canvas" },
    React.createElement(
      "div",
      { className: "nle-preview" },
      ...state.document.items.map((item) =>
        React.createElement(
          "div",
          { "data-studio-item": item.id, key: item.id },
          React.createElement("img", { alt: item.id }),
        ),
      ),
    ),
    React.createElement(CanvasSelection, { session, state, onError: vi.fn() }),
    ...state.document.items.map((item) =>
      React.createElement(
        "button",
        { key: item.id, "aria-pressed": state.selection === item.id },
        item.id,
      ),
    ),
  )
}
async function click(x: number, y: number) {
  await act(async () =>
    container.querySelector(".nle-canvas-overlay")!.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
      }),
    ),
  )
}
it("selects clicked foreground content even when the full-frame background is selected", async () => {
  await act(async () => root.render(React.createElement(App)))
  await click(40, 40)
  expect(session.getSnapshot().selection).toBe("foreground")
  expect(
    [...container.querySelectorAll('button[aria-pressed="true"]')].map(
      (b) => b.textContent,
    ),
  ).toEqual(["foreground"])
})
it("selects background content outside the foreground bounds", async () => {
  session.select("foreground")
  await act(async () => root.render(React.createElement(App)))
  await click(150, 150)
  expect(session.getSnapshot().selection).toBe("background")
})
it("ignores foreground items outside their active time range", async () => {
  session.edit((document) => ({
    ...document,
    items: document.items.map((item) =>
      item.id === "foreground"
        ? { ...item, startFrame: 30, durationInFrames: 30 }
        : item,
    ),
  }))
  await act(async () => root.render(React.createElement(App)))
  await click(40, 40)
  expect(session.getSnapshot().selection).toBe("background")
})
it("dragging clicked foreground content moves only that item", async () => {
  await act(async () => root.render(React.createElement(App)))
  await click(40, 40)
  const overlay = container.querySelector(".nle-canvas-overlay")!
  await act(async () =>
    overlay.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 50,
        clientY: 55,
      }),
    ),
  )
  await act(async () =>
    overlay.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, clientX: 50, clientY: 55 }),
    ),
  )
  const items = session.getSnapshot().document.items
  expect(
    items.find((item) => item.id === "foreground")!.transform,
  ).toMatchObject({ x: 10, y: 15 })
  expect(
    items.find((item) => item.id === "background")!.transform,
  ).toBeUndefined()
})
async function handleDrag(
  handle: string,
  from: [number, number],
  to: [number, number],
  cancel = false,
) {
  const before = structuredClone(session.getSnapshot().document)
  const target = container.querySelector(`[data-canvas-handle="${handle}"]`)!
  await act(async () =>
    target.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: from[0],
        clientY: from[1],
      }),
    ),
  )
  const overlay = container.querySelector(".nle-canvas-overlay")!
  await act(async () =>
    overlay.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: to[0],
        clientY: to[1],
      }),
    ),
  )
  expect(session.getSnapshot().document).toEqual(before)
  await act(async () =>
    overlay.dispatchEvent(
      new MouseEvent(cancel ? "pointercancel" : "pointerup", {
        bubbles: true,
        clientX: to[0],
        clientY: to[1],
      }),
    ),
  )
}
it("corner scaling preserves proportions and fixes the opposite corner in one undoable edit", async () => {
  session.select("foreground")
  await act(async () => root.render(React.createElement(App)))
  expect(container.querySelectorAll(".nle-canvas-scale")).toHaveLength(4)
  await handleDrag("se", [80, 80], [140, 140])
  const items = session.getSnapshot().document.items
  expect(
    items.find((item) => item.id === "foreground")!.transform,
  ).toMatchObject({ scaleX: 2, scaleY: 2, x: 130, y: 130 })
  expect(
    items.find((item) => item.id === "background")!.transform,
  ).toBeUndefined()
  await act(async () => session.undo())
  expect(
    session
      .getSnapshot()
      .document.items.find((item) => item.id === "foreground")!.transform,
  ).toBeUndefined()
  expect(session.getSnapshot().hasUnsavedChanges).toBe(false)
})
it("rotation pivots around the content centre instead of moving it around the canvas", async () => {
  session.select("foreground")
  await act(async () => root.render(React.createElement(App)))
  await handleDrag("rotate", [50, 22], [78, 50])
  expect(
    session
      .getSnapshot()
      .document.items.find((item) => item.id === "foreground")!.transform,
  ).toMatchObject({ rotation: 90, x: -200, y: 0 })
  expect(
    container.querySelector<HTMLElement>(".nle-canvas-selection")!.style
      .transform,
  ).toBe("rotate(90deg)")
})
it("cancelled handle gestures restore the layer and leave the document unchanged", async () => {
  session.select("foreground")
  await act(async () => root.render(React.createElement(App)))
  await handleDrag("se", [80, 80], [140, 140], true)
  expect(session.getSnapshot().hasUnsavedChanges).toBe(false)
  expect(
    container.querySelector<HTMLElement>('[data-studio-item="foreground"]')!
      .style.transform,
  ).toBe("")
})
it("read-only selections show no transform handles", async () => {
  session.select("foreground")
  await act(async () =>
    root.render(
      React.createElement(
        "div",
        { className: "nle-canvas" },
        React.createElement(
          "div",
          { "data-studio-item": "foreground" },
          React.createElement("img", { alt: "foreground" }),
        ),
        React.createElement(CanvasSelection, {
          session,
          state: { ...session.getSnapshot(), editable: false },
          onError: vi.fn(),
        }),
      ),
    ),
  )
  expect(container.querySelectorAll("[data-canvas-handle]")).toHaveLength(0)
})
it("does not read layout again while a scale gesture moves", async () => {
  session.select("foreground")
  await act(async () => root.render(React.createElement(App)))
  const handle = container.querySelector('[data-canvas-handle="se"]')!
  await act(async () =>
    handle.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 80,
        clientY: 80,
      }),
    ),
  )
  const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock
    .calls.length
  const overlay = container.querySelector(".nle-canvas-overlay")!
  await act(async () =>
    overlay.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    ),
  )
  await act(async () =>
    overlay.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 140,
        clientY: 140,
      }),
    ),
  )
  expect(
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls,
  ).toHaveLength(reads)
  await act(async () =>
    overlay.dispatchEvent(new Event("lostpointercapture", { bubbles: true })),
  )
  expect(session.getSnapshot().hasUnsavedChanges).toBe(false)
})

it("keeps the rotation frame and handle orientation across successive releases", async () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(
    function (this: HTMLElement) {
      const layer = this.closest<HTMLElement>('[data-studio-item="foreground"]')
      if (!layer) return new DOMRect(0, 0, 300, 300)
      const translation = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(
        layer.style.transform,
      )
      return new DOMRect(
        20 + Number(translation?.[1] ?? 0),
        20 + Number(translation?.[2] ?? 0),
        60,
        60,
      )
    },
  )
  session.select("foreground")
  await act(async () => root.render(React.createElement(App)))
  await handleDrag("rotate", [50, 22], [78, 50])
  const frame = () =>
    container.querySelector<HTMLElement>(".nle-canvas-selection")!
  expect(frame().style.transform).toBe("rotate(90deg)")
  expect(parseFloat(frame().style.left)).toBeCloseTo(20)
  expect(parseFloat(frame().style.top)).toBeCloseTo(20)
  await handleDrag("rotate", [78, 50], [50, 78])
  expect(frame().style.transform).toBe("rotate(-180deg)")
  expect(parseFloat(frame().style.left)).toBeCloseTo(20)
  expect(parseFloat(frame().style.top)).toBeCloseTo(20)
})
it.each([
  [-2, 0],
  [43, 45],
  [88, 90],
  [133, 135],
  [178, -180],
  [-43, -45],
  [-88, -90],
  [30, 30],
  [39, 39],
])(
  "rotation at %s degrees resolves to %s degrees",
  async (proposed, expected) => {
    session.select("foreground")
    await act(async () => root.render(React.createElement(App)))
    const radians = (proposed * Math.PI) / 180
    await handleDrag(
      "rotate",
      [50, 22],
      [50 + 28 * Math.sin(radians), 50 - 28 * Math.cos(radians)],
    )
    const transform = session
      .getSnapshot()
      .document.items.find((item) => item.id === "foreground")!.transform
    if (expected === 0) {
      expect(transform?.rotation ?? 0).toBe(0)
    } else {
      expect(transform!.rotation).toBeCloseTo(expected)
      const angle = (expected * Math.PI) / 180
      expect(transform!.x).toBeCloseTo(
        100 * Math.cos(angle) - 100 * Math.sin(angle) - 100,
      )
      expect(transform!.y).toBeCloseTo(
        100 * Math.sin(angle) + 100 * Math.cos(angle) - 100,
      )
    }
  },
)
