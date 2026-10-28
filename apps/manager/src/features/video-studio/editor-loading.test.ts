// @vitest-environment jsdom
import React, { act } from "react"
import { renderToString } from "react-dom/server"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { StudioEditor } from "./editor"
import { studioCall } from "./client"

vi.mock("./client", () => ({ studioCall: vi.fn() }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

it("server-renders editor regions before any project read or media initialization", () => {
  const html = renderToString(
    React.createElement(StudioEditor, { projectId: "pending" }),
  )
  const page = document.createElement("div")
  page.innerHTML = html
  expect(page.querySelector('.nle-editor[aria-busy="true"]')).not.toBeNull()
  expect(page.querySelector(".nle-editor-header")).not.toBeNull()
  expect(page.querySelector('[aria-label="Preview"]')).not.toBeNull()
  expect(page.querySelector('[aria-label="Timeline"]')).not.toBeNull()
  expect(page.querySelector(".nle-inspector")?.textContent).toContain(
    "Nothing to inspect",
  )
  expect(
    [...page.querySelectorAll("button, input")].every(
      (el) => (el as HTMLButtonElement).disabled,
    ),
  ).toBe(true)
  expect(page.querySelector("video, audio, img, iframe")).toBeNull()
  expect(html).not.toContain("Opening project")
  expect(vi.mocked(studioCall)).not.toHaveBeenCalled()
})

it("keeps the shell visible during the read without touching recovery, then reports failures", async () => {
  let rejectRead: (error: Error) => void = () => {
    throw new Error("Read not started")
  }
  vi.mocked(studioCall).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectRead = reject
      }),
  )
  const storageWrite = vi.spyOn(Storage.prototype, "setItem")
  const storageRemove = vi.spyOn(Storage.prototype, "removeItem")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root!.render(React.createElement(StudioEditor, { projectId: "pending" })),
  )
  expect(
    container.querySelector('.nle-editor[aria-busy="true"]'),
  ).not.toBeNull()
  expect(studioCall).toHaveBeenCalledExactlyOnceWith("read", "pending")
  expect(storageWrite).not.toHaveBeenCalled()
  expect(storageRemove).not.toHaveBeenCalled()
  await act(async () => rejectRead(new Error("Project access denied")))
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Project unavailable",
  )
  expect(container.textContent).toContain("Project access denied")
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    "/dashboard/shorts",
  )
})
