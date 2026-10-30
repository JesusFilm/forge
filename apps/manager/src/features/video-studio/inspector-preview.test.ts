// @vitest-environment jsdom
import React, { act, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Short, StudioDocument } from "@forge/studio-contracts"
import { EditorSession } from "./editor-session"
import { Inspector } from "./inspector"
import Preview from "./preview"
import { useInspectorPreview } from "./use-inspector-preview"
import { startEditorAutosave } from "./editor-autosave"

const playerMounts = vi.hoisted(() => vi.fn())
vi.mock("@forge/shorts-compositions/studio/Composition", () => ({
  StudioComposition: () => null,
}))
// Observe the real Preview's player props, lifecycle and source preparation.
vi.mock("@remotion/player", async () => {
  const React = await import("react")
  return {
    Player: React.forwardRef(function TestPlayer(
      { inputProps }: { inputProps: { input: { document: StudioDocument } } },
      ref,
    ) {
      React.useEffect(() => {
        playerMounts()
      }, [])
      React.useImperativeHandle(
        ref,
        () => ({
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          getCurrentFrame: () => 0,
          seekTo: vi.fn(),
          pause: vi.fn(),
          isPlaying: () => false,
        }),
        [],
      )
      return React.createElement("output", {
        "data-player-document": JSON.stringify(inputProps.input.document),
      })
    }),
  }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const project: Short = {
  projectId: "live-inspector",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "operator" },
  document: {
    version: 1,
    title: "Live inspector",
    language: "english",
    runtimeVersion: "studio-proof-1",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 90,
    tracks: [{ id: "visual", kind: "visual" }],
    components: [],
    items: [
      {
        id: "image",
        kind: "image",
        trackId: "visual",
        startFrame: 0,
        durationInFrames: 90,
        asset: { assetId: "asset", versionId: "v1", digest: "a".repeat(64) },
        transform: {
          x: 1.23456789,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
        },
      },
    ],
  },
}
let container: HTMLDivElement,
  root: ReturnType<typeof createRoot>,
  session: EditorSession
let frame: FrameRequestCallback | null
let stopAutosave: () => void
const apply = vi.fn(),
  fetchPreview = vi.fn(),
  onError = vi.fn(),
  onPlaying = vi.fn()
function Host() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const preview = useInspectorPreview(state)
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Inspector, {
      session,
      state,
      onError,
      onPreview: preview.onPreview,
    }),
    React.createElement(Preview, {
      session,
      state: preview.state,
      projectId: project.projectId,
      playing: false,
      onPlaying,
    }),
  )
}
beforeEach(async () => {
  vi.useFakeTimers()
  frame = null
  vi.clearAllMocks()
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback
    return 1
  })
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame = null
  })
  fetchPreview.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      input: {
        document: project.document,
        media: {
          image: { file: "image.jpg", kind: "image", sourceStartMs: 0 },
        },
        code: {},
      },
      urls: { "image.jpg": "https://example.test/image.jpg" },
      files: [],
    }),
  })
  vi.stubGlobal("fetch", fetchPreview)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  session = new EditorSession(structuredClone(project), {
    read: async () => project,
    apply,
  })
  session.select("image")
  stopAutosave = startEditorAutosave(session)
  await act(async () => root.render(React.createElement(Host)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  stopAutosave()
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function playerDocument(): StudioDocument {
  return JSON.parse(
    container
      .querySelector("[data-player-document]")!
      .getAttribute("data-player-document")!,
  )
}
function label(name: string) {
  return container
    .querySelector(`input[aria-label="${name}"]`)!
    .closest("label")!
    .querySelector(".nle-number-label, .nle-number-unit")!
}
async function pointer(target: Element, type: string, x: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    button: 0,
  })
  Object.defineProperty(event, "pointerId", { value: 1 })
  await act(async () => {
    target.dispatchEvent(event)
  })
}
async function paint() {
  await act(async () => {
    const callback = frame
    frame = null
    callback?.(0)
  })
}
it.each([
  ["X", "x", 6.23456789],
  ["Y", "y", 5],
  ["Scale", "scaleX", 1.25],
  ["Rotation", "rotation", 5],
  ["Opacity", "opacity", 0.75],
])(
  "previews %s before release without saving or remounting media",
  async (name, property, expected) => {
    const control = label(name)
    const original = session.getSnapshot().document
    await pointer(control, "pointerdown", 100)
    const end = name === "Opacity" ? 80 : 120
    await pointer(control, "pointermove", end)
    await paint()
    expect(playerDocument().items[0]!.transform).toHaveProperty(
      property,
      expected,
    )
    expect(session.getSnapshot().document).toBe(original)
    expect(session.recovery().document).toBe(original)
    expect(session.getSnapshot().canUndo).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(apply).not.toHaveBeenCalled()
    expect(fetchPreview).toHaveBeenCalledTimes(1)
    expect(playerMounts).toHaveBeenCalledTimes(1)
    await pointer(control, "pointerup", end)
    expect(session.getSnapshot().document.items[0]!.transform).toHaveProperty(
      property,
      expected,
    )
    expect(playerDocument()).toEqual(session.getSnapshot().document)
    expect(session.getSnapshot().canUndo).toBe(true)
    await act(async () => session.undo())
    expect(session.getSnapshot().document).toEqual(original)
    expect(session.getSnapshot().canUndo).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  },
)
it("restores the player on cancellation and ignores drafts after selection changes", async () => {
  const control = label("X")
  await pointer(control, "pointerdown", 100)
  await pointer(control, "pointermove", 120)
  await paint()
  await pointer(control, "pointercancel", 120)
  expect(playerDocument()).toEqual(session.getSnapshot().document)
  expect(session.getSnapshot().canUndo).toBe(false)
  await pointer(control, "pointerdown", 100)
  await pointer(control, "pointermove", 140)
  await paint()
  await act(async () => session.select(null))
  expect(playerDocument()).toEqual(session.getSnapshot().document)
  expect(session.getSnapshot().canUndo).toBe(false)
})
it("previews crop through the same player without committing intermediate edits", async () => {
  const control = label("Crop left (%)")
  await pointer(control, "pointerdown", 100)
  await pointer(control, "pointermove", 140)
  await paint()
  expect(playerDocument().items[0]!.transform?.crop?.left).toBe(0.1)
  expect(
    session.getSnapshot().document.items[0]!.transform?.crop,
  ).toBeUndefined()
  await pointer(control, "pointerup", 140)
  expect(session.getSnapshot().document.items[0]!.transform?.crop?.left).toBe(
    0.1,
  )
})
it("previews nested text appearance controls and commits them once", async () => {
  await act(async () =>
    session.edit((d) => ({
      ...d,
      items: [
        {
          id: "image",
          kind: "text",
          trackId: "visual",
          startFrame: 0,
          durationInFrames: 90,
          text: "Text",
          properties: { shadow: true, shadowBlur: 8 },
        },
      ],
    })),
  )
  const before = session.getSnapshot().document
  const control = label("Shadow blur")
  await pointer(control, "pointerdown", 100)
  await pointer(control, "pointermove", 120)
  await paint()
  expect(playerDocument().items[0]).toMatchObject({
    properties: { shadowBlur: 13 },
  })
  expect(session.getSnapshot().document).toBe(before)
  await pointer(control, "pointerup", 120)
  expect(session.getSnapshot().document.items[0]).toMatchObject({
    properties: { shadowBlur: 13 },
  })
  await act(async () => session.undo())
  expect(session.getSnapshot().document).toEqual(before)
})
it("rejects a crop that hides the entire image without leaving a preview draft", async () => {
  await act(async () =>
    session.edit((d) => ({
      ...d,
      items: d.items.map((i) => ({
        ...i,
        transform: {
          ...project.document.items[0]!.transform!,
          crop: { left: 0, right: 0.5, top: 0, bottom: 0 },
        },
      })),
    })),
  )
  const before = session.getSnapshot().document
  const control = label("Crop left (%)")
  await pointer(control, "pointerdown", 100)
  await pointer(control, "pointermove", 340)
  await paint()
  expect(playerDocument()).toEqual(before)
  await pointer(control, "pointerup", 340)
  expect(session.getSnapshot().document).toBe(before)
  expect(onError).toHaveBeenCalledWith("Crop must leave a visible area")
})
