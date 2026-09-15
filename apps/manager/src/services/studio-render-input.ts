import { createHash } from "node:crypto"
import { z } from "zod"
import {
  studioDocumentSchema,
  studioAssetReferenceSchema,
} from "@forge/studio-contracts"
import { studioAssetVersionSchema } from "@forge/studio-contracts/assets"
import { studioSourceSnapshotSchema } from "@forge/studio-contracts/sources"
import {
  studioPreviewSchema,
  type StudioPreview,
} from "@forge/studio-contracts/preview"
import { STUDIO_RENDER_INPUT_BYTES } from "@forge/studio-contracts/render"
import {
  createStudioAssetBroker,
  readRetainedStudioSource,
  StudioBrokerError,
  type StudioBrokerClient,
} from "./studio-broker"

/** Resolve immutable export bytes only. No original-source download, preview
 * session, provider call, document edit or evaluation of authored code occurs. */
export async function prepareStudioRenderInput(
  call: StudioBrokerClient,
  projectId: string,
  rawDocument: unknown,
  proofKey: string,
  signal: AbortSignal,
) {
  const document = studioDocumentSchema.parse(rawDocument)
  const sources = z
    .array(
      z.object({
        snapshot: studioSourceSnapshotSchema,
        itemId: z.string(),
        startMs: z.number(),
        endMs: z.number(),
      }),
    )
    .parse(await call("preview-sources", { projectId, document }))
  const assets = createStudioAssetBroker(call, signal)
  const files: {
    name: string
    digest: string
    size: number
    base64: string
  }[] = []
  const media: StudioPreview["media"] = {},
    code: StudioPreview["code"] = {}
  let size = 0
  const read = async (
    ref: z.infer<typeof studioAssetReferenceSchema>,
    max = STUDIO_RENDER_INPUT_BYTES,
  ) => {
    signal.throwIfAborted()
    const bytes = await assets.read(
      ref,
      Math.min(max, STUDIO_RENDER_INPUT_BYTES - size),
    )
    size += bytes.length
    return bytes
  }
  const add = (name: string, bytes: Buffer) => {
    if (files.some((file) => file.name === name))
      throw new StudioBrokerError("Duplicate render file")
    files.push({
      name,
      digest: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
      base64: bytes.toString("base64"),
    })
  }
  for (const entry of sources) {
    const { snapshot } = entry
    if (
      !proofKey ||
      snapshot.materialization !== "broker-manifest" ||
      !snapshot.coveredRanges.some(
        (range) => range.startMs <= entry.startMs && range.endMs >= entry.endMs,
      )
    )
      throw new StudioBrokerError(
        "Render requires retained export bytes covering the complete source range",
      )
    const retained = await readRetainedStudioSource(
      call,
      { ...assets, read },
      snapshot,
      entry,
      proofKey,
    )
    if (retained.length !== 2)
      throw new StudioBrokerError("Retained export codec authority is missing")
    const { manifest, proof } = retained[1]!
    const info = z
      .object({
        playlist: studioAssetReferenceSchema,
        sourceStartMs: z.number().nonnegative(),
        segmentDurations: z.array(z.number().positive()),
        verification: z.literal("decoded-h264-v1"),
      })
      .parse(proof)
    await read(info.playlist, 1048576)
    if (info.segmentDurations.length !== manifest.media.length)
      throw new StudioBrokerError("Invalid retained export segment proof")
    const prefix = `source-${files.length}`,
      names = manifest.media.map((_, i) => `${prefix}-${i}.ts`)
    for (let i = 0; i < manifest.media.length; i++)
      add(names[i]!, await read(manifest.media[i]!))
    const name = `${prefix}.m3u8`
    const playlist = Buffer.from(
      [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...info.segmentDurations))}`,
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        ...names.flatMap((name, i) => [
          `#EXTINF:${info.segmentDurations[i]},`,
          name,
        ]),
        "#EXT-X-ENDLIST",
        "",
      ].join("\n"),
    )
    size += playlist.length
    if (size > STUDIO_RENDER_INPUT_BYTES)
      throw new StudioBrokerError("Render input exceeds its byte budget")
    add(name, playlist)
    media[entry.itemId] = {
      file: name,
      sourceStartMs: info.sourceStartMs,
      kind: "hls",
    }
  }
  for (const item of document.items) {
    if (item.kind !== "image" && item.kind !== "audio") continue
    const asset = studioAssetVersionSchema.parse(
      await call("asset", item.asset),
    )
    const allowed =
      item.kind === "image"
        ? ["image/png", "image/jpeg", "image/webp"]
        : ["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"]
    if (!allowed.includes(asset.mimeType))
      throw new StudioBrokerError("Unsupported render asset type")
    const name = `asset-${files.length}`
    add(name, await read(item.asset, 32 * 1024 * 1024))
    media[item.id] = { file: name, sourceStartMs: 0, kind: item.kind }
  }
  const active = new Set(
    document.items.flatMap((item) =>
      item.kind === "component" ? [item.componentVersionId] : [],
    ),
  )
  for (const component of document.components.filter((component) =>
    active.has(component.versionId),
  ))
    code[component.versionId] = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(await read(component.code, 32768))
  signal.throwIfAborted()
  return { input: studioPreviewSchema.parse({ document, media, code }), files }
}
