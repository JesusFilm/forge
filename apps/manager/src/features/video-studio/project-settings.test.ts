// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Short } from "@forge/studio-contracts"
import { EditorSession } from "./editor-session"
import { ProjectSettings } from "./project-settings"
import { Inspector } from "./inspector"
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
const project: Short = {
  projectId: "settings",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "operator" },
  document: {
    version: 1,
    title: "My short",
    language: "english",
    runtimeVersion: "studio-proof-1",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 90,
    tracks: [{ id: "visual", kind: "visual" }],
    components: [],
    items: [
      {
        id: "title",
        kind: "text",
        trackId: "visual",
        startFrame: 0,
        durationInFrames: 90,
        text: "Title card",
        properties: {},
      },
    ],
  },
}
let container: HTMLDivElement,
  root: ReturnType<typeof createRoot>,
  session: EditorSession
const close = vi.fn()
beforeEach(() => {
  close.mockClear()
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "")
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open")
  }
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  session = new EditorSession(structuredClone(project), {
    read: async () => project,
    apply: vi.fn(),
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render(editable = true) {
  await act(async () =>
    root.render(
      React.createElement(ProjectSettings, {
        session,
        state: { ...session.getSnapshot(), editable },
        onClose: close,
      }),
    ),
  )
}
async function width(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Width"]',
  )!
  input.value = value
  await act(async () =>
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  )
}
async function submit() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  )
}
it("stages dimensions until Apply, then records one undoable project edit", async () => {
  await render()
  await width("1920")
  expect(session.getSnapshot().document.width).toBe(1080)
  await submit()
  expect(session.getSnapshot().document.width).toBe(1920)
  expect(session.getSnapshot().document.height).toBe(1920)
  expect(session.getSnapshot().document.items).toEqual(project.document.items)
  expect(close).toHaveBeenCalledOnce()
  session.undo()
  expect(session.getSnapshot().document.width).toBe(1080)
})
it("Cancel and Escape leave staged settings unapplied", async () => {
  await render()
  await width("1920")
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[type="button"]')!
      .click(),
  )
  expect(session.getSnapshot().document).toEqual(project.document)
  expect(close).toHaveBeenCalledOnce()
  await act(async () =>
    container
      .querySelector("dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true })),
  )
  expect(close).toHaveBeenCalledTimes(2)
  expect(session.getSnapshot().document).toEqual(project.document)
})
it("read-only projects cannot apply settings", async () => {
  await render(false)
  expect(container.querySelector("fieldset")!.disabled).toBe(true)
  expect(
    container.querySelector<HTMLButtonElement>('button[type="submit"]')!
      .disabled,
  ).toBe(true)
  await submit()
  expect(session.getSnapshot().document).toEqual(project.document)
  expect(close).not.toHaveBeenCalled()
})
it("an empty inspector contains no project fields or cards list", async () => {
  session.select(null)
  await act(async () =>
    root.render(
      React.createElement(Inspector, {
        session,
        state: session.getSnapshot(),
        onError: vi.fn(),
      }),
    ),
  )
  expect(container.textContent).toBe("Nothing to inspect")
  expect(container.querySelectorAll("input,button")).toHaveLength(0)
})
