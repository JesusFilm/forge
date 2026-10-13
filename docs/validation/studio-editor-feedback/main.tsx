import React from "react"
import { createRoot } from "react-dom/client"
import { StudioEditor } from "@qa/editor"
const asset = { assetId: "code", versionId: "v1", digest: "a".repeat(64) }
const document = {
  version: 1,
  title: "Canvas regression",
  language: "english",
  runtimeVersion: "studio-proof-1",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 300,
  tracks: [{ id: "mixed", kind: "visual" }],
  packRevisionIds: [],
  components: [
    {
      versionId: "Caption",
      code: asset,
      runtimeVersion: "studio-proof-1",
      dependencies: [],
      width: 1080,
      height: 1920,
      duration: { minFrames: 1, maxFrames: 300 },
      assets: [],
      controls: { text: { type: "text", maxLength: 100 } },
    },
  ],
  items: [
    {
      id: "footage",
      kind: "video",
      trackId: "mixed",
      startFrame: 0,
      durationInFrames: 300,
      volume: 0,
      source: {
        videoId: "fixture",
        dubId: "dub",
        editionId: "edition",
        language: "english",
        preview: asset,
        export: asset,
        subtitle: null,
        startMs: 0,
        endMs: 10000,
      },
    },
    {
      id: "caption",
      kind: "component",
      trackId: "mixed",
      startFrame: 0,
      durationInFrames: 300,
      componentVersionId: "Caption",
      properties: { text: "Caption" },
    },
    {
      id: "credit",
      kind: "text",
      trackId: "mixed",
      startFrame: 0,
      durationInFrames: 300,
      text: "Credit",
      properties: { fontSize: 90 },
      transform: {
        x: 0,
        y: 550,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
      },
    },
  ],
}
let stored = {
  projectId: "fixture",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "fixture" },
  document,
}
const saved = sessionStorage.getItem("fixture-project")
if (saved) stored = JSON.parse(saved)
const fetchMedia = window.fetch.bind(window)
window.fetch = async (url, options) => {
  if (url === "/api/shorts/command") {
    const { action, input } = JSON.parse(String(options?.body))
    let result: unknown = []
    if (action === "read") result = structuredClone(stored)
    if (action === "apply") {
      if (input.expectedRevision !== stored.revision)
        return Response.json({ error: "Revision conflict" }, { status: 409 })
      stored = {
        ...stored,
        document: input.operations[0].document,
        revision: stored.revision + 1,
      }
      sessionStorage.setItem("fixture-project", JSON.stringify(stored))
      result = {
        projectId: "fixture",
        revision: stored.revision,
        outcome: "ACCEPTED",
      }
    }
    return Response.json({ result })
  }
  if (url === "/api/shorts/preview") {
    const { document } = JSON.parse(String(options?.body))
    return Response.json({
      input: {
        document,
        code: {
          Caption:
            'import React from "react"; import {AbsoluteFill} from "remotion"; export default function Caption({text}) { return <AbsoluteFill style={{alignItems:"center",justifyContent:"center",fontSize:90,color:"white"}}><span>{text}</span></AbsoluteFill> }',
        },
        media: {
          footage: { file: "footage.m3u8", sourceStartMs: 0, kind: "hls" },
        },
      },
      urls: { "footage.m3u8": "/media/source.m3u8" },
      files: [],
    })
  }
  return fetchMedia(url, options)
}
// Inspect only fixture state; no production sessions or project data.
Object.assign(window, {
  fixtureStored: () => structuredClone(stored),
  fixtureReadyAt: null,
})
createRoot(window.document.getElementById("root")!).render(
  <StudioEditor projectId="fixture" />,
)
