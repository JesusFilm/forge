import { describe, expect, it } from "vitest"
import { exampleManifest } from "@forge/shorts-compositions/studio-proof/example"
import { contentIdentity, sha256, verifyBrokerInput } from "./broker.js"

describe("trusted media broker", () => {
  it("invalidates identity on prop, source, trim, or runtime dependency edits", () => {
    const original = contentIdentity(exampleManifest)
    for (const change of [
      {
        ...exampleManifest,
        props: { ...exampleManifest.props, title: "edit" },
      },
      { ...exampleManifest, source: exampleManifest.source + "\n" },
      { ...exampleManifest, componentVersion: "v2" },
      {
        ...exampleManifest,
        asset: { ...exampleManifest.asset, trimStartMs: 2000, trimEndMs: 4000 },
      },
    ])
      expect(contentIdentity(change)).not.toBe(original)
    expect(contentIdentity(JSON.parse(JSON.stringify(exampleManifest)))).toBe(
      original,
    )
  })
  it("binds exact catalog selection and subtitle bytes, rejecting mismatched media", () => {
    const bytes = {
      preview: Buffer.from("#EXTM3U\nsegment-0.ts"),
      segments: { "segment-0.ts": Buffer.from("segment") },
      export: Buffer.from("mp4"),
      subtitle: Buffer.from(
        JSON.stringify(exampleManifest.asset.subtitle.cues),
      ),
    }
    const manifest = structuredClone(exampleManifest)
    manifest.asset.previewDigest = sha256(bytes.preview)
    manifest.asset.previewSegments = [
      {
        name: "segment-0.ts",
        digest: sha256(bytes.segments["segment-0.ts"]),
        size: 7,
      },
    ]
    manifest.asset.exportDigest = sha256(bytes.export)
    manifest.asset.subtitle.digest = sha256(bytes.subtitle)
    const selection = {
      videoId: "synthetic-video",
      dubId: "synthetic-dub",
      editionId: "synthetic-edition",
      languageSlug: "english",
      subtitleTrackId: "synthetic-track",
      subtitleEditionId: "synthetic-edition",
      subtitleLanguageSlug: "english",
      eligible: true,
    }
    expect(verifyBrokerInput(manifest, selection, bytes).identity).toBe(
      contentIdentity(manifest),
    )
    expect(() =>
      verifyBrokerInput(
        manifest,
        { ...selection, subtitleEditionId: "wrong" },
        bytes,
      ),
    ).toThrow()
    expect(() =>
      verifyBrokerInput(manifest, selection, {
        ...bytes,
        export: Buffer.from("changed"),
      }),
    ).toThrow()
    expect(() =>
      verifyBrokerInput(manifest, selection, {
        ...bytes,
        segments: { "segment-0.ts": Buffer.from("changed") },
      }),
    ).toThrow()
    expect(() =>
      verifyBrokerInput(manifest, { ...selection, eligible: false }, bytes),
    ).toThrow()
  })
})
