// @vitest-environment jsdom
import { createElement, StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { createHash, webcrypto } from "node:crypto"
import { encodeLaunchEnvelope } from "@/lib/editor-helpers"
import { SubtitleEditorApp } from "./subtitle-editor-app"
import type { BootstrapReviewSessionResult } from "@/lib/manager-client"
const client = vi.hoisted(() => ({
  exchange: vi.fn(),
  bootstrap: vi.fn(),
  save: vi.fn(),
}))
vi.mock("@/lib/manager-client", async (original) => ({
  ...(await original<typeof import("@/lib/manager-client")>()),
  exchangeLaunchCode: client.exchange,
  bootstrapReviewSession: client.bootstrap,
  saveReviewedVtt: client.save,
}))
const vtt = (text: string) =>
  `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${text}\n`
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const review = (
  jobId: string,
  text = "equal base",
): BootstrapReviewSessionResult => ({
  jobId,
  sourceArtifactKey: "subtitles-fr",
  baseArtifactKey: "subtitles-fr",
  targetLanguage: "fr",
  muxPlaybackId: null,
  mediaUrl: null,
  vtt: vtt(text),
  baseArtifactFingerprint: hash(vtt(text)),
})
let host: HTMLDivElement, root: Root
const render = async (jobId: string, launchCode = `code-${jobId}`) => {
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(SubtitleEditorApp, {
          initialLaunch: null,
          initialLaunchEnvelope: { jobId, launchCode },
        }),
      ),
    ),
  )
}
const editor = () =>
  host.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Subtitle VTT text"]',
  )!
const saveButton = () =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Save reviewed subtitles",
  )!
const reloadButton = () =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Reload latest reviewed version",
  )!
const edit = async (text: string) => {
  await act(async () => {
    const el = editor()
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(el, text)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const click = async (button: HTMLButtonElement) => {
  await act(async () => button.click())
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  client.exchange.mockImplementation(async ({ jobId }) => ({
    editSessionToken: `token-${jobId}`,
    expiresAt: "later",
  }))
  client.bootstrap.mockImplementation(async ({ jobId }) => review(jobId))
  client.save.mockImplementation(async (input) => ({
    jobId: input.jobId,
    revision: 1,
    contentFingerprint: hash(input.vtt),
    baseArtifactFingerprint: input.baseArtifactFingerprint,
  }))
  vi.spyOn(window, "confirm").mockReturnValue(true)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})
it("IR1F1: failed different launch with equal base cannot save old draft; new owner recovers separately", async () => {
  await render("a")
  await edit(vtt("job A unsaved private draft"))
  client.bootstrap.mockRejectedValueOnce(new Error("bootstrap B failed"))
  await render("b")
  expect(saveButton().disabled).toBe(true)
  expect(editor().disabled).toBe(true)
  expect(host.textContent).toContain("bootstrap B failed")
  const retained = host.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Unsaved draft from job a"]',
  )
  expect(retained?.value).toBe(vtt("job A unsaved private draft"))
  await click(saveButton())
  expect(client.save).not.toHaveBeenCalled()
  await click(reloadButton())
  expect(client.exchange).toHaveBeenCalledTimes(2)
  expect(editor().value).toBe(vtt("equal base"))
  expect(retained?.value).toBe(vtt("job A unsaved private draft"))
  await edit(vtt("job B only"))
  await click(saveButton())
  expect(client.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      jobId: "b",
      editSessionToken: "token-b",
      vtt: vtt("job B only"),
    }),
  )
  const discard = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Discard retained draft",
  )!
  await click(discard)
  expect(
    host.querySelector('textarea[aria-label="Unsaved draft from job a"]'),
  ).toBeNull()
})
it("equivalent launch, StrictMode and resize keep one initialization and the dirty draft", async () => {
  await render("a")
  await edit(vtt("private"))
  await render("a")
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(SubtitleEditorApp, {
          initialLaunch: encodeLaunchEnvelope({
            jobId: "a",
            launchCode: "code-a",
          }),
          initialLaunchEnvelope: null,
        }),
      ),
    ),
  )
  await act(async () => {
    Object.defineProperty(window, "innerWidth", {
      value: 1190,
      configurable: true,
    })
    window.dispatchEvent(new Event("resize"))
  })
  expect(client.exchange).toHaveBeenCalledTimes(1)
  expect(client.bootstrap).toHaveBeenCalledTimes(1)
  expect(editor().value).toBe(vtt("private"))
  expect(saveButton().disabled).toBe(false)
  client.save.mockRejectedValueOnce(new Error("save failed"))
  await click(saveButton())
  expect(editor().value).toBe(vtt("private"))
  expect(saveButton().disabled).toBe(false)
  client.bootstrap.mockRejectedValueOnce(new Error("reload failed"))
  await click(reloadButton())
  expect(editor().value).toBe(vtt("private"))
})
it("stale initialization cannot replace a newer owner", async () => {
  let finish!: (value: BootstrapReviewSessionResult) => void
  client.bootstrap.mockImplementationOnce(
    () =>
      new Promise<BootstrapReviewSessionResult>((resolve) => {
        finish = resolve
      }),
  )
  await render("a")
  await render("b")
  await edit(vtt("B private"))
  await act(async () => finish(review("a", "stale A")))
  expect(editor().value).toBe(vtt("B private"))
  await click(saveButton())
  expect(client.save).toHaveBeenCalledWith(
    expect.objectContaining({ jobId: "b", vtt: vtt("B private") }),
  )
})
it("stale save acknowledgement cannot clear the new owner's draft", async () => {
  await render("a")
  await edit(vtt("A private"))
  let finish!: (value: unknown) => void
  client.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await click(saveButton())
  await render("b")
  await edit(vtt("B private"))
  await act(async () =>
    finish({
      jobId: "a",
      revision: 1,
      contentFingerprint: hash(vtt("A private")),
      baseArtifactFingerprint: hash(vtt("equal base")),
    }),
  )
  expect(editor().value).toBe(vtt("B private"))
  expect(host.textContent).not.toContain("Saved as reviewed revision")
  expect(
    host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Unsaved draft from job a"]',
    )?.value,
  ).toBe(vtt("A private"))
})

it("a different session on the same job invalidates the old base and keeps its draft separate", async () => {
  await render("a")
  await edit(vtt("old session private"))
  client.bootstrap.mockRejectedValueOnce(new Error("new session failed"))
  await render("a", "different-code-a")
  expect(saveButton().disabled).toBe(true)
  expect(
    host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Unsaved draft from job a"]',
    )?.value,
  ).toBe(vtt("old session private"))
  await click(reloadButton())
  expect(editor().value).toBe(vtt("equal base"))
})
it("resizing during delayed initialization does not repeat the single-use exchange", async () => {
  let finish!: (value: { editSessionToken: string; expiresAt: string }) => void
  client.exchange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await render("a")
  await act(async () => {
    Object.defineProperty(window, "innerWidth", {
      value: 1180,
      configurable: true,
    })
    window.dispatchEvent(new Event("resize"))
  })
  await render("a")
  await act(async () =>
    finish({ editSessionToken: "token-a", expiresAt: "later" }),
  )
  expect(client.exchange).toHaveBeenCalledTimes(1)
  expect(client.bootstrap).toHaveBeenCalledTimes(1)
  expect(saveButton().disabled).toBe(false)
})
it("stale reload response cannot overwrite a different launch or its retained old draft", async () => {
  await render("a")
  await edit(vtt("A unsaved"))
  let finish!: (value: BootstrapReviewSessionResult) => void
  client.bootstrap.mockImplementationOnce(
    () =>
      new Promise<BootstrapReviewSessionResult>((resolve) => {
        finish = resolve
      }),
  )
  await click(reloadButton())
  await render("b")
  await edit(vtt("B unsaved"))
  await act(async () => finish(review("a", "stale reload")))
  expect(editor().value).toBe(vtt("B unsaved"))
  expect(
    host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Unsaved draft from job a"]',
    )?.value,
  ).toBe(vtt("A unsaved"))
})
