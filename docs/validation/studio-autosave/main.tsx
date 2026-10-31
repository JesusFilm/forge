import React from "react"
import { createRoot } from "react-dom/client"
import { StudioEditor } from "@qa/editor"
const asset = { assetId: "audio", versionId: "v1", digest: "a".repeat(64) }
const initial = {
  projectId: "fixture",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "fixture" },
  document: {
    version: 1,
    title: "Autosave fixture",
    language: "english",
    runtimeVersion: "studio-proof-1",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 300,
    tracks: [
      { id: "main", kind: "visual" },
      { id: "audio", kind: "audio" },
    ],
    components: [],
    items: [
      {
        id: "caption",
        kind: "text",
        trackId: "main",
        startFrame: 0,
        durationInFrames: 300,
        text: "Caption",
        properties: { fontSize: 90 },
      },
      {
        id: "ending",
        kind: "audio",
        trackId: "audio",
        startFrame: 240,
        durationInFrames: 60,
        asset,
        sourceStartMs: 0,
        volume: 1,
      },
    ],
  },
}
let stored =
  JSON.parse(sessionStorage.getItem("fixture-project") ?? "null") ?? initial
let expired = false,
  offline = false,
  delay = 0,
  previewCalls = 0
const commands: unknown[] = []
const receipts = new Map<string, unknown>()
const originalFetch = window.fetch.bind(window)
window.fetch = async (url, options) => {
  if (url === "/api/shorts/command") {
    const { action, input } = JSON.parse(String(options?.body))
    commands.push({ action, input })
    if (expired)
      return Response.json(
        { error: "Interactive Manager session required" },
        { status: 401 },
      )
    if (offline) throw new TypeError("Offline fixture")
    if (action === "read")
      return Response.json({ result: structuredClone(stored) })
    if (action === "apply") {
      await new Promise((resolve) => setTimeout(resolve, delay))
      if (receipts.has(input.idempotencyKey))
        return Response.json({ result: receipts.get(input.idempotencyKey) })
      if (input.expectedRevision !== stored.revision)
        return Response.json({ error: "Revision conflict" }, { status: 409 })
      stored = {
        ...stored,
        document: input.operations[0].document,
        revision: stored.revision + 1,
      }
      sessionStorage.setItem("fixture-project", JSON.stringify(stored))
      const result = {
        projectId: "fixture",
        revision: stored.revision,
        outcome: "ACCEPTED",
      }
      receipts.set(input.idempotencyKey, result)
      return Response.json({ result })
    }
    return Response.json({ result: [] })
  }
  if (url === "/api/shorts/preview") {
    previewCalls++
    if (expired)
      return Response.json(
        { error: "Interactive Manager session required" },
        { status: 401 },
      )
    const { document } = JSON.parse(String(options?.body))
    return Response.json({
      input: { document, code: {}, media: {} },
      urls: {},
      files: [],
    })
  }
  return originalFetch(url, options)
}
Object.assign(window, {
  qa: {
    stored: () => structuredClone(stored),
    commands: () => structuredClone(commands),
    expire: (value: boolean) => {
      expired = value
    },
    offline: (value: boolean) => {
      offline = value
    },
    delay: (value: number) => {
      delay = value
    },
    previewCalls: () => previewCalls,
    conflict: () => {
      stored = {
        ...stored,
        revision: stored.revision + 1,
        document: { ...stored.document, title: "Remote writer" },
      }
    },
  },
})
createRoot(window.document.getElementById("root")!).render(
  <StudioEditor projectId="fixture" />,
)
