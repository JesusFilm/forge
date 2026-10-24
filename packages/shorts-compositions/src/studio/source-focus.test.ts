import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import type { StudioPreview } from "@forge/studio-contracts/preview"
import { StudioComposition } from "./Composition"
vi.mock("remotion", () => ({
  AbsoluteFill: ({
    children,
    style,
  }: {
    children: React.ReactNode
    style: React.CSSProperties
  }) => React.createElement("div", { style }, children),
  Sequence: ({ children }: { children: React.ReactNode }) => children,
  Html5Video: ({ style }: { style: React.CSSProperties }) =>
    React.createElement("video", { style }),
  OffthreadVideo: ({ style }: { style: React.CSSProperties }) =>
    React.createElement("video", { style }),
  useCurrentFrame: () => 0,
  useBufferState: () => ({}),
}))
const ref = { assetId: "media", versionId: "v1", digest: "a".repeat(64) }
const document = studioDocumentSchema.parse({
  version: 1,
  runtimeVersion: "v1",
  title: "LUMO",
  language: "english",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 30,
  components: [],
  packRevisionIds: [],
  tracks: [{ id: "video", kind: "visual" }],
  items: [
    {
      id: "clip",
      trackId: "video",
      kind: "video",
      startFrame: 0,
      durationInFrames: 30,
      source: {
        videoId: "video",
        dubId: "dub",
        editionId: "edition",
        language: "english",
        subtitle: null,
        preview: ref,
        export: ref,
        startMs: 0,
        endMs: 1000,
      },
      volume: 1,
    },
  ],
})
const input: StudioPreview = {
  document,
  code: {},
  media: { clip: { file: "clip.mp4", sourceStartMs: 0, kind: "hls" } },
}
it("moves inside the cover fit identically in preview and export, preserving centre by default", () => {
  for (const mode of ["preview", "render"] as const) {
    for (const x of [0, 0.5, 1]) {
      const focused = {
        ...input,
        document: {
          ...document,
          items: document.items.map((item) => ({
            ...item,
            focus: { x, y: 0.5 },
          })),
        },
      }
      const html = renderToStaticMarkup(
        React.createElement(StudioComposition, {
          input: focused,
          mode,
          mediaBaseUrl: "https://studio.test/",
        }),
      )
      expect(html).toContain(`object-position:${x * 100}% 50%`)
      expect(html).toContain("object-fit:cover")
    }
    expect(
      renderToStaticMarkup(
        React.createElement(StudioComposition, {
          input,
          mode,
          mediaBaseUrl: "https://studio.test/",
        }),
      ),
    ).toContain("object-position:50% 50%")
  }
})
