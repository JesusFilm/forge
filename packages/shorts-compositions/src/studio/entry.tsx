import React from "react"
import { Composition, registerRoot } from "remotion"
import {
  studioPreviewSchema,
  STUDIO_RUNTIME_VERSION,
} from "@forge/studio-contracts/preview"
import { StudioComposition } from "./Composition"
const blank = {
  document: {
    version: 1 as const,
    title: "Studio",
    language: "english",
    runtimeVersion: STUDIO_RUNTIME_VERSION,
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 30,
    tracks: [],
    items: [],
    components: [],
    packRevisionIds: [],
  },
  media: {},
  code: {},
}
registerRoot(() => (
  <Composition
    id="Studio"
    component={StudioComposition}
    width={320}
    height={180}
    fps={30}
    durationInFrames={30}
    defaultProps={{
      input: blank,
      mode: "render" as const,
      mediaBaseUrl: "http://127.0.0.1/",
    }}
    calculateMetadata={({ props }) => {
      const input = studioPreviewSchema.parse(props.input)
      return {
        width: input.document.width,
        height: input.document.height,
        fps: input.document.fps,
        durationInFrames: input.document.durationInFrames,
      }
    }}
  />
))
