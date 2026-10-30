import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { studioAudioVolume } from "@forge/studio-contracts/audio"
import type { StudioPreview } from "@forge/studio-contracts/preview"
import { StudioComposition } from "./Composition"
const clock = vi.hoisted(() => ({ frame: 0 }))
vi.mock("remotion", () => ({
  AbsoluteFill: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  Sequence: ({ children }: { children: React.ReactNode }) => children,
  Html5Video: (props: { volume: number; useWebAudioApi?: boolean }) =>
    React.createElement("video", {
      "data-volume": props.volume,
      "data-gain": props.useWebAudioApi,
    }),
  OffthreadVideo: (props: { volume: number }) =>
    React.createElement("video", { "data-volume": props.volume }),
  Html5Audio: (props: { volume: number; useWebAudioApi?: boolean }) =>
    React.createElement("audio", {
      "data-volume": props.volume,
      "data-gain": props.useWebAudioApi,
    }),
  useCurrentFrame: () => clock.frame,
  useBufferState: () => ({}),
}))
const asset = { assetId: "a", versionId: "v1", digest: "a".repeat(64) }
const document = studioDocumentSchema.parse({
  version: 1,
  runtimeVersion: "v1",
  title: "Audio",
  language: "en",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 90,
  components: [],
  tracks: [
    { id: "v", kind: "visual" },
    { id: "a", kind: "audio" },
  ],
  items: [
    {
      id: "video",
      trackId: "v",
      kind: "video",
      startFrame: 10,
      durationInFrames: 60,
      playbackRate: 2,
      volume: 4,
      audioFade: {
        fadeInFrames: 20,
        fadeOutFrames: 15,
        fadeInCurve: 0.5,
        fadeOutCurve: -0.5,
        fadeInCurvePosition: 0.75,
        fadeOutCurvePosition: 0.25,
      },
      source: {
        videoId: "v",
        dubId: "d",
        editionId: "e",
        language: "en",
        subtitle: null,
        preview: asset,
        export: asset,
        startMs: 1000,
        endMs: 5000,
      },
    },
    {
      id: "music",
      trackId: "a",
      kind: "audio",
      startFrame: 10,
      durationInFrames: 60,
      sourceStartMs: 5000,
      asset,
      volume: 3,
      audioFade: {
        fadeInFrames: 10,
        fadeOutFrames: 20,
        fadeInCurve: -0.5,
        fadeOutCurve: 0.5,
        fadeInCurvePosition: 0.3,
        fadeOutCurvePosition: 0.8,
      },
    },
  ],
})
const input: StudioPreview = {
  document,
  code: {},
  media: {
    video: { file: "video.mp4", sourceStartMs: 0, kind: "hls" },
    music: { file: "audio.wav", sourceStartMs: 0, kind: "audio" },
  },
}
it("uses identical clip-relative envelope gains for video/audio in preview and export", () => {
  for (const frame of [9, 10, 20, 35, 60, 69]) {
    clock.frame = frame
    for (const mode of ["preview", "render"] as const) {
      const markup = renderToStaticMarkup(
        React.createElement(StudioComposition, {
          input,
          mode,
          mediaBaseUrl: "https://example.test/",
        }),
      )
      for (const item of document.items) {
        if (item.kind !== "video" && item.kind !== "audio") continue
        expect(markup).toContain(
          `data-volume="${studioAudioVolume(item, frame - item.startFrame)}"`,
        )
      }
      expect(markup).toContain('data-gain="true"')
    }
  }
})
