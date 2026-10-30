// @vitest-environment jsdom
import React, { act, useCallback, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Short } from "@forge/studio-contracts"
import { EditorSession } from "./editor-session"
import { Library } from "./library"
import { ViewportFileDrop } from "./viewport-file-drop"
import { Timeline } from "./timeline"
import { EditorHeader } from "./editor-header"
import { MediaDragProvider } from "./media-drag"
import { studioCall } from "./client"
import { timelineRows } from "./timeline-layout"
import { mediaDropLocation } from "./media-drop"

vi.mock("./client", () => ({ studioCall: vi.fn() }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
const reference = {
  assetId: "source",
  versionId: "source-v1",
  digest: "0".repeat(64),
}
const source = {
  videoId: "film",
  dubId: "dub",
  editionId: "edition",
  language: "english",
  subtitle: null,
  preview: reference,
  export: reference,
  startMs: 0,
  endMs: 10000,
}
const candidate = {
  videoId: "film",
  dubId: "dub",
  editionId: "edition",
  language: "english",
  title: "Source footage",
  durationMs: 18000,
  tracks: [],
  downloads: [{ id: "download", height: 1080, quality: "high" }],
}
const project: Short = {
  projectId: "project",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "operator" },
  document: {
    version: 1,
    title: "Project",
    language: "english",
    runtimeVersion: "studio-proof-1",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 900,
    tracks: [{ id: "main", kind: "visual" }],
    items: [],
    components: [],
  },
}
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let session: EditorSession
const report = vi.fn()
function Harness() {
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  )
  const [workspace, setWorkspace] = useState<"preview" | "media">("preview")
  const [opened, setOpened] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const receiveFiles = useCallback((files: File[]) => {
    setDroppedFiles((pending) => [...pending, ...files])
    setOpened(true)
    setWorkspace("media")
  }, [])
  const consumeFiles = useCallback(
    (count: number) => setDroppedFiles((pending) => pending.slice(count)),
    [],
  )
  return React.createElement(
    MediaDragProvider,
    null,
    React.createElement(
      "div",
      { className: "nle-editor" },
      React.createElement(ViewportFileDrop, {
        enabled: state.editable,
        onFiles: receiveFiles,
      }),
      React.createElement(EditorHeader, {
        state,
        session,
        workspace,
        onWorkspaceChange: (next) => {
          setWorkspace(next)
          setOpened(true)
        },
        onSettings: report,
        onAssistant: report,
        onScripts: report,
        onProduction: report,
        onRender: report,
        onHistory: report,
      }),
      opened &&
        React.createElement(
          "div",
          { hidden: workspace !== "media" },
          React.createElement(Library, {
            session,
            state,
            active: workspace === "media",
            incomingFiles: droppedFiles,
            onIncomingFilesHandled: consumeFiles,
          }),
        ),
      React.createElement(Timeline, { session, state, onError: report }),
    ),
  )
}
function element(selector: string) {
  const node = container.querySelector<HTMLElement>(selector)
  if (!node) throw new Error(`Missing ${selector}`)
  return node
}
async function click(selector: string) {
  await act(async () => element(selector).click())
}
async function openMedia() {
  await click("#nle-media-tab")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}
const transfer = () => ({
  setData: vi.fn(),
  setDragImage: vi.fn(),
  effectAllowed: "",
  dropEffect: "",
})
async function dispatch(
  selector: string,
  type: string,
  dataTransfer: ReturnType<typeof transfer> & {
    types?: string[]
    files?: File[]
  },
  clientX = 120,
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { dataTransfer, clientX })
  await act(async () => element(selector).dispatchEvent(event))
}
beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
  session = new EditorSession(structuredClone(project), {
    read: async () => project,
    apply: vi.fn(),
  })
  vi.mocked(studioCall).mockImplementation(async (action) =>
    action === "search" ? [candidate] : action === "capture" ? { source } : [],
  )
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(React.createElement(Harness)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it("defers library requests until Media is selected and preserves search through workspace switches", async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(studioCall).not.toHaveBeenCalled()
  await openMedia()
  expect(container.textContent).not.toContain("Add text card")
  expect(container.textContent).toContain("english · 18s")
  expect(
    Array.from(
      container.querySelectorAll('[aria-label="Content categories"] button'),
      (node) => node.textContent,
    ),
  ).toEqual(["Media", "Custom component"])
  expect(
    Array.from(
      container.querySelectorAll('[aria-label="Media types"] button'),
      (node) => node.textContent,
    ),
  ).toEqual(["JFP", "Videos", "Images", "Audio"])
  expect(container.querySelector(".nle-library-content h2")).toBeNull()
  const input = element('[aria-label="Search library"]') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Source")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await vi.advanceTimersByTimeAsync(300)
  })
  await click("#nle-preview-tab")
  expect(element('[aria-label="Media browser"]').parentElement?.hidden).toBe(
    true,
  )
  await click("#nle-media-tab")
  expect(
    (element('[aria-label="Search library"]') as HTMLInputElement).value,
  ).toBe("Source")
  expect(container.querySelector("dialog")).toBeNull()
})

it("shows linked clip placement, captures only on drop and inserts one undoable source at that frame", async () => {
  await openMedia()
  const data = transfer()
  await dispatch(".nle-library-card", "dragstart", data)
  expect(data.setDragImage).toHaveBeenCalledOnce()
  expect(studioCall).toHaveBeenCalledTimes(1)
  await dispatch('.nle-track[data-group="Visual"]', "dragenter", data)
  expect(container.querySelectorAll(".nle-media-drop-clip")).toHaveLength(2)
  const frame = Math.round(
    120 / Number(element("[data-media-px]").dataset.mediaPx),
  )
  await dispatch('.nle-track[data-group="Visual"]', "drop", data)
  expect(studioCall).toHaveBeenCalledWith(
    "capture",
    expect.objectContaining({
      videoId: "film",
      downloadId: "download",
      startMs: 0,
      endMs: 10000,
      trackId: null,
    }),
  )
  expect(session.getSnapshot().document.items).toHaveLength(1)
  expect(session.getSnapshot().document.items[0]).toMatchObject({
    kind: "video",
    startFrame: frame,
    durationInFrames: 300,
    volume: 1,
    trackId: "main",
  })
  expect(
    timelineRows(session.getSnapshot().document).filter(
      (row) => row.linkedSourceAudio,
    ),
  ).toHaveLength(1)
  await act(async () => session.undo())
  expect(session.getSnapshot().document.items).toHaveLength(0)
  await act(async () => session.redo())
  expect(session.getSnapshot().document.items).toHaveLength(1)
})

it("does not capture or edit after an outside drop or incompatible track", async () => {
  await openMedia()
  const data = transfer()
  await dispatch(".nle-library-card", "dragstart", data)
  await dispatch(".nle-library-card", "dragend", data)
  expect(studioCall).toHaveBeenCalledTimes(1)
  expect(session.getSnapshot().document.items).toHaveLength(0)
  const doc = session.getSnapshot().document
  expect(mediaDropLocation(doc, "image", "Audio", 80)).toBeNull()
  expect(mediaDropLocation(doc, "audio", "Audio", 80)).toEqual({
    startFrame: 80,
    trackId: undefined,
  })
})

it("drags retained audio to an audio track without capturing footage", async () => {
  await openMedia()
  vi.mocked(studioCall).mockResolvedValueOnce([
    {
      reference,
      filename: "Music",
      mimeType: "audio/mpeg",
      role: "music",
      provenance: { status: "recorded", recorded: { durationMs: 12000 } },
    },
  ])
  await click('[aria-label="Media types"] button:nth-child(2)')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  await click('[aria-label="Media types"] button:nth-child(4)')
  const data = transfer()
  await dispatch(".nle-library-card", "dragstart", data)
  await dispatch('.nle-track[data-group="Visual"]', "drop", data)
  expect(session.getSnapshot().document.items).toHaveLength(0)
  await dispatch('.nle-track[data-group="Audio"]', "drop", data)
  expect(session.getSnapshot().document.items[0]).toMatchObject({
    kind: "audio",
    durationInFrames: 360,
    asset: reference,
  })
  expect(studioCall).toHaveBeenCalledTimes(2)
  expect(
    session.getSnapshot().document.tracks.some((t) => t.kind === "audio"),
  ).toBe(true)
})

it("drops failed captures without creating history or timeline items", async () => {
  await openMedia()
  vi.mocked(studioCall).mockRejectedValueOnce(
    new TypeError("Source unavailable"),
  )
  const data = transfer()
  await dispatch(".nle-library-card", "dragstart", data)
  await dispatch('.nle-track[data-group="Visual"]', "drop", data)
  expect(session.getSnapshot().document.items).toHaveLength(0)
  expect(session.getSnapshot().canUndo).toBe(false)
  expect(element('[role="alert"]').textContent).toContain("Source unavailable")
})

it("preserves intervening edits and suppresses a late capture after the browser unmounts", async () => {
  await openMedia()
  let complete!: (value: unknown) => void
  vi.mocked(studioCall).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const data = transfer()
  await dispatch(".nle-library-card", "dragstart", data)
  await dispatch('.nle-track[data-group="Visual"]', "drop", data)
  await act(async () =>
    session.edit((doc) => ({ ...doc, title: "Changed during capture" })),
  )
  await act(async () => complete({ source }))
  expect(session.getSnapshot().document.title).toBe("Changed during capture")
  expect(session.getSnapshot().document.items).toHaveLength(1)
  vi.mocked(studioCall).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  await dispatch(".nle-library-card", "dragstart", data)
  await dispatch('.nle-track[data-group="Visual"]', "drop", data)
  await act(async () => root.render(null))
  await act(async () => complete({ source }))
  expect(session.getSnapshot().document.items).toHaveLength(1)
})

it("shows skeleton cards during search, an empty result and a working clear action", async () => {
  vi.mocked(studioCall).mockResolvedValueOnce([])
  await click("#nle-media-tab")
  expect(container.querySelectorAll(".nle-library-skeleton")).toHaveLength(12)
  expect(container.querySelector(".nle-library-empty")).toBeNull()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(container.querySelector(".nle-library-skeleton")).toBeNull()
  expect(container.textContent).toContain("No JFP footage available")
  expect(container.querySelector(".nle-empty-drop-zone")).not.toBeNull()
  expect(container.textContent).toContain(
    "Upload your own media to get started.",
  )
  const chooser = vi
    .spyOn(element('input[type="file"]'), "click")
    .mockImplementation(() => {})
  await click(".nle-library-empty .nle-primary")
  expect(chooser).toHaveBeenCalledOnce()
  vi.mocked(studioCall).mockResolvedValueOnce([])
  const input = element('[aria-label="Search library"]') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "missing")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(container.querySelectorAll(".nle-library-skeleton")).toHaveLength(12)
  expect(container.querySelector(".nle-library-empty")).toBeNull()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(container.textContent).toContain("No results for “missing”")
  await click(".nle-library-empty > button:last-child")
  expect(input.value).toBe("")
  expect(container.querySelectorAll(".nle-library-skeleton")).toHaveLength(12)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(container.querySelector(".nle-library-empty")).toBeNull()
  expect(container.textContent).toContain("Source footage")
})

it("separates shared media without refetching or offering video as an image", async () => {
  await openMedia()
  vi.mocked(studioCall).mockResolvedValueOnce([
    { reference, filename: "Still", mimeType: "image/png", role: "background" },
    {
      reference: { ...reference, versionId: "video" },
      filename: "source.mp4",
      mimeType: "video/mp4",
      role: "source",
      provenance: {
        status: "recorded",
        recorded: { title: "Shared clip", durationMs: 120000 },
      },
    },
    {
      reference: { ...reference, versionId: "audio" },
      filename: "Music",
      mimeType: "audio/mpeg",
      role: "music",
    },
    {
      reference: { ...reference, versionId: "document" },
      filename: "Notes",
      mimeType: "text/plain",
      role: "document",
    },
  ])
  await click('[aria-label="Media types"] button:nth-child(2)')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  await click('[aria-label="Media types"] button:nth-child(3)')
  expect(element(".nle-library-card strong").textContent).toBe("Still")
  expect(element('input[type="file"]').getAttribute("accept")).toContain(
    "video/mp4",
  )
  expect(element('input[type="file"]').hidden).toBe(true)
  const calls = vi.mocked(studioCall).mock.calls.length
  await click('[aria-label="Media types"] button:nth-child(2)')
  expect(element(".nle-library-card strong").textContent).toBe("Shared clip")
  expect(element(".nle-library-card > span:last-child").textContent).toBe("2m")
  expect(element(".nle-library-card").draggable).toBe(false)
  expect(container.querySelector(".nle-library-image")).not.toBeNull()
  expect(element('input[type="file"]').hidden).toBe(true)
  await click(".nle-library-card")
  expect(container.querySelector(".nle-media-selection")).toBeNull()
  expect(session.getSnapshot().document.items).toHaveLength(0)
  await click('[aria-label="Media types"] button:nth-child(4)')
  expect(element(".nle-library-card strong").textContent).toBe("Music")
  expect(container.querySelector(".nle-library-image")).toBeNull()
  expect(
    element('[aria-label="Search library"]').getAttribute("placeholder"),
  ).toBe("Search audio…")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(studioCall).toHaveBeenCalledTimes(calls)
})

it("uploads dropped media to the library without adding timeline clips", async () => {
  await openMedia()
  const upload = vi.fn(async (_url: string, options: RequestInit) => {
    const form = options.body as FormData
    const file = form.get("file") as File
    return {
      ok: true,
      json: async () => ({
        reference: { ...reference, versionId: file.name },
        filename: file.name,
        mimeType: file.type,
        role: form.get("role"),
        provenance: { status: "unknown", recorded: {} },
      }),
    }
  })
  vi.stubGlobal("fetch", upload)
  const files = [
    new File(["video"], "clip.mp4", { type: "video/mp4" }),
    new File(["sound"], "music.mp3", { type: "audio/mpeg" }),
  ]
  const dataTransfer = { ...transfer(), types: ["Files"], files }
  await dispatch("#nle-library-content", "dragenter", dataTransfer)
  expect(container.querySelector(".nle-viewport-file-drop")).not.toBeNull()
  await dispatch("#nle-library-content", "drop", dataTransfer)
  expect(container.querySelector(".nle-viewport-file-drop")).toBeNull()
  expect(upload).toHaveBeenCalledTimes(2)
  expect(
    upload.mock.calls.map((call) => (call[1].body as FormData).get("role")),
  ).toEqual(["background", "music"])
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(element(".nle-library-card strong").textContent).toBe("clip.mp4")
  await click('[aria-label="Media types"] button:nth-child(4)')
  expect(element(".nle-library-card strong").textContent).toBe("music.mp3")
  expect(session.getSnapshot().document.items).toHaveLength(0)
  expect(session.getSnapshot().canUndo).toBe(false)
})

it("uses the manual file chooser and validates uploads before sending bytes", async () => {
  await openMedia()
  const upload = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      reference,
      filename: "photo.png",
      mimeType: "image/png",
      role: "background",
      provenance: { status: "unknown", recorded: {} },
    }),
  }))
  vi.stubGlobal("fetch", upload)
  const input = element('input[type="file"]') as HTMLInputElement
  const chooser = vi.spyOn(input, "click").mockImplementation(() => {})
  await click(".nle-library-toolbar > button")
  expect(chooser).toHaveBeenCalledOnce()
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["image"], "photo.png", { type: "image/png" })],
  })
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  )
  expect(upload).toHaveBeenCalledOnce()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(element(".nle-library-card strong").textContent).toBe("photo.png")
  expect(session.getSnapshot().document.items).toHaveLength(0)
  const invalid = {
    ...transfer(),
    types: ["Files"],
    files: [new File(["text"], "notes.txt", { type: "text/plain" })],
  }
  await dispatch("#nle-library-content", "drop", invalid)
  expect(upload).toHaveBeenCalledOnce()
  expect(element('[role="alert"]').textContent).toContain("notes.txt")
})

it("reports failed uploads without creating timeline items", async () => {
  await openMedia()
  const upload = vi.fn(async () => ({ ok: false }))
  vi.stubGlobal("fetch", upload)
  await dispatch("#nle-library-content", "drop", {
    ...transfer(),
    types: ["Files"],
    files: [new File(["sound"], "failed.mp3", { type: "audio/mpeg" })],
  })
  expect(element('[role="alert"]').textContent).toContain(
    "Could not upload: failed.mp3",
  )
  expect(session.getSnapshot().document.items).toHaveLength(0)
  expect(
    element(".nle-library-toolbar > button").hasAttribute("disabled"),
  ).toBe(false)
})

it("accepts files over the timeline before Media is opened", async () => {
  const upload = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      reference,
      filename: "anywhere.png",
      mimeType: "image/png",
      role: "background",
      provenance: { status: "unknown", recorded: {} },
    }),
  }))
  vi.stubGlobal("fetch", upload)
  const data = {
    ...transfer(),
    types: ["Files"],
    files: [new File(["image"], "anywhere.png", { type: "image/png" })],
  }
  expect(container.querySelector('[aria-label="Media browser"]')).toBeNull()
  await dispatch(".nle-timeline", "dragenter", data)
  expect(container.textContent).toContain("Drop to upload")
  expect(studioCall).not.toHaveBeenCalled()
  await dispatch(".nle-timeline", "drop", data)
  expect(container.querySelector(".nle-viewport-file-drop")).toBeNull()
  expect(upload).toHaveBeenCalledOnce()
  expect(element("#nle-media-tab").getAttribute("aria-selected")).toBe("true")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(container.textContent).toContain("anywhere.png")
  expect(session.getSnapshot().document.items).toHaveLength(0)
})

it("dismisses the viewport overlay on cancellation and ignores internal drags", async () => {
  const data = { ...transfer(), types: ["Files"], files: [] }
  await dispatch(".nle-timeline", "dragenter", data)
  expect(container.querySelector(".nle-viewport-file-drop")).not.toBeNull()
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
  })
  expect(container.querySelector(".nle-viewport-file-drop")).toBeNull()
  await dispatch(".nle-timeline", "dragenter", {
    ...transfer(),
    types: ["application/x-studio-media"],
  })
  expect(container.querySelector(".nle-viewport-file-drop")).toBeNull()
  expect(studioCall).not.toHaveBeenCalled()
})

it("blocks file navigation in read-only mode and releases window handlers on unmount", async () => {
  const onFiles = vi.fn()
  await act(async () =>
    root.render(
      React.createElement(ViewportFileDrop, { enabled: false, onFiles }),
    ),
  )
  const data = {
    types: ["Files"],
    files: [new File(["image"], "blocked.png", { type: "image/png" })],
  }
  const drop = new Event("drop", { bubbles: true, cancelable: true })
  Object.assign(drop, { dataTransfer: data })
  await act(async () => {
    window.dispatchEvent(drop)
  })
  expect(drop.defaultPrevented).toBe(true)
  expect(onFiles).not.toHaveBeenCalled()
  expect(container.querySelector(".nle-viewport-file-drop")).toBeNull()
  await act(async () => root.render(null))
  const after = new Event("drop", { cancelable: true })
  Object.assign(after, { dataTransfer: data })
  window.dispatchEvent(after)
  expect(after.defaultPrevented).toBe(false)
})

it("queues a second viewport drop while an upload is running", async () => {
  let complete!: () => void
  const uploaded = (name: string) => ({
    reference: { ...reference, versionId: name },
    filename: name,
    mimeType: "image/png",
    role: "background",
    provenance: { status: "unknown", recorded: {} },
  })
  const upload = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = () =>
            resolve({ ok: true, json: async () => uploaded("first.png") })
        }),
    )
    .mockResolvedValueOnce({
      ok: true,
      json: async () => uploaded("second.png"),
    })
  vi.stubGlobal("fetch", upload)
  const data = (name: string) => ({
    ...transfer(),
    types: ["Files"],
    files: [new File(["image"], name, { type: "image/png" })],
  })
  await dispatch(".nle-timeline", "drop", data("first.png"))
  expect(upload).toHaveBeenCalledOnce()
  await dispatch(".nle-timeline", "drop", data("second.png"))
  expect(upload).toHaveBeenCalledOnce()
  await act(async () => complete())
  expect(upload).toHaveBeenCalledTimes(2)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(container.textContent).toContain("first.png")
  expect(container.textContent).toContain("second.png")
  expect(session.getSnapshot().document.items).toHaveLength(0)
})
