// Trusted byte boundary. Only already-authorized exact catalog selections belong here.
import { parseSourceVtt } from "./subtitles.js"
import { createHash } from "node:crypto"
import {
  parseManifest,
  StudioProofError,
  type StudioManifest,
} from "@forge/shorts-compositions/studio-proof/manifest"

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`
  return JSON.stringify(value)
}
export function contentIdentity(value: unknown): string {
  return sha256(canonical(parseManifest(value)))
}

export type CatalogSelection = {
  videoId: string
  dubId: string
  editionId: string
  languageSlug: string
  subtitleTrackId: string
  subtitleEditionId: string
  subtitleLanguageSlug: string
  eligible: boolean
}
export function verifyBrokerInput(
  manifest: StudioManifest,
  selection: CatalogSelection,
  bytes: {
    preview: Uint8Array
    export: Uint8Array
    subtitle: Uint8Array
    segments: Record<string, Uint8Array>
  },
) {
  const m = parseManifest(manifest)
  const a = m.asset
  if (
    !selection.eligible ||
    a.videoId !== selection.videoId ||
    a.dubId !== selection.dubId ||
    a.editionId !== selection.editionId ||
    a.languageSlug !== selection.languageSlug ||
    a.subtitle.trackId !== selection.subtitleTrackId ||
    a.subtitle.editionId !== selection.subtitleEditionId ||
    a.subtitle.languageSlug !== selection.subtitleLanguageSlug
  )
    throw new StudioProofError(
      "Catalog selection does not match source identity",
    )
  for (const [kind, expected] of [
    ["preview", a.previewDigest],
    ["export", a.exportDigest],
    ["subtitle", a.subtitle.digest],
  ] as const) {
    const body = bytes[kind]
    const limit = kind === "subtitle" ? 1_048_576 : 64 * 1_048_576
    if (body.byteLength > limit || sha256(body) !== expected)
      throw new StudioProofError("Broker asset size or digest mismatch")
  }
  if (
    Object.keys(bytes.segments).length !== a.previewSegments.length ||
    new Set(a.previewSegments.map((s) => s.name)).size !==
      a.previewSegments.length
  )
    throw new StudioProofError("Preview segment inventory mismatch")
  let segmentBytes = 0
  for (const segment of a.previewSegments) {
    const body = bytes.segments[segment.name]
    if (
      !body ||
      body.byteLength !== segment.size ||
      sha256(body) !== segment.digest
    )
      throw new StudioProofError("Preview segment digest mismatch")
    segmentBytes += body.byteLength
    if (segmentBytes > 64 * 1_048_576)
      throw new StudioProofError("Preview segment budget exceeded")
  }
  const playlistReferences = Buffer.from(bytes.preview)
    .toString("utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
  if (
    canonical(playlistReferences) !==
    canonical(a.previewSegments.map((s) => s.name))
  )
    throw new StudioProofError(
      "Preview playlist references do not match declared segments",
    )
  const subtitleText = Buffer.from(bytes.subtitle).toString("utf8")
  const cues = subtitleText.startsWith("WEBVTT")
    ? parseSourceVtt(bytes.subtitle, {
        startMs: a.trimStartMs,
        endMs: a.trimEndMs,
      }).filter((c) => c.endMs > a.trimStartMs && c.startMs < a.trimEndMs)
    : JSON.parse(subtitleText)
  if (canonical(cues) !== canonical(a.subtitle.cues))
    throw new StudioProofError("Subtitle bytes do not match declared cues")
  return { manifest: m, identity: contentIdentity(m) }
}
