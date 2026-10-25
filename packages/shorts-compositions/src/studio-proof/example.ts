import {
  RUNTIME_VERSION,
  type StudioManifest,
} from "@forge/shorts-compositions/studio-proof/manifest"

// Synthetic mechanics fixture, never represented as verified Forge media.
export const exampleManifest: StudioManifest = {
  runtime: RUNTIME_VERSION,
  componentVersion: "example-v1",
  source: `export default function Generated(props: {title: string; color: string}) {
    const frame = Remotion.useCurrentFrame();
    return <div style={{position: 'absolute', top: 20, left: 20, color: props.color,
      fontSize: 28, transform: 'translateX(' + frame + 'px)'}}>{props.title}</div>;
  }`,
  controls: {
    title: { type: "text", maxLength: 100 },
    color: { type: "color" },
  },
  props: { title: "Dynamic Studio proof", color: "#ffffff" },
  width: 320,
  height: 180,
  fps: 30,
  durationInFrames: 60,
  authorLanguageSlug: "english",
  asset: {
    videoId: "synthetic-video",
    dubId: "synthetic-dub",
    editionId: "synthetic-edition",
    languageSlug: "english",
    previewDigest: "0".repeat(64),
    previewSegments: [
      { name: "segment-0.ts", digest: "0".repeat(64), size: 1 },
    ],
    exportDigest: "0".repeat(64),
    trimStartMs: 1000,
    trimEndMs: 3000,
    subtitle: {
      trackId: "synthetic-track",
      editionId: "synthetic-edition",
      languageSlug: "english",
      digest: "0".repeat(64),
      cues: [{ startMs: 500, endMs: 2000, text: "Exact source cue" }],
    },
  },
}
