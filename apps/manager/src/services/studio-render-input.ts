import { studioMediaStartTimes } from "@forge/studio-contracts/transitions"
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
  prepareStudioRenderSources,
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
  // Metadata is immutable or resolved for this preparation's source snapshot.
  // Repeated clips must still validate their own ranges, but need not make the
  // same metadata round trips for each occurrence. Never cache transfer grants
  // or share this cache across preparations/projects.
  const metadata = new Map<string, Promise<unknown>>()
  const readMetadata: StudioBrokerClient = (action, input) => {
    signal.throwIfAborted()
    if (action !== "asset" && action !== "source") return call(action, input)
    const identity = JSON.stringify([action, input])
    let pending = metadata.get(identity)
    if (!pending) {
      pending = call(action, input)
      metadata.set(identity, pending)
    }
    return pending
  }
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
  const retainedBytes = new Map<
    string,
    Awaited<ReturnType<typeof assets.read>>
  >()
  const fileByDigest = new Map<string, string>()
  const read = async (
    ref: z.infer<typeof studioAssetReferenceSchema>,
    max = STUDIO_RENDER_INPUT_BYTES,
  ) => {
    signal.throwIfAborted()
    const identity = JSON.stringify([ref.assetId, ref.versionId, ref.digest])
    const prior = retainedBytes.get(identity)
    if (prior) {
      if (prior.length > max)
        throw new StudioBrokerError("Render input exceeds its byte budget")
      return prior
    }
    const bytes = await assets.read(
      ref,
      Math.min(max, STUDIO_RENDER_INPUT_BYTES - size),
    )
    size += bytes.length
    retainedBytes.set(identity, bytes)
    return bytes
  }
  const add = (name: string, bytes: Buffer) => {
    const digest = createHash("sha256").update(bytes).digest("hex")
    const prior = fileByDigest.get(digest)
    if (prior) return prior
    if (files.some((file) => file.name === name))
      throw new StudioBrokerError("Duplicate render file")
    files.push({
      name,
      digest,
      size: bytes.length,
      base64: bytes.toString("base64"),
    })
    fileByDigest.set(digest, name)
    return name
  }
  const mediaStarts = studioMediaStartTimes(document)
  for (const resolvedEntry of sources) {
    const entry = {
      ...resolvedEntry,
      startMs: mediaStarts.get(resolvedEntry.itemId) ?? resolvedEntry.startMs,
    }
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
      readMetadata,
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
      names = manifest.media.map((ref) => `source-${ref.digest}.ts`)
    for (let i = 0; i < manifest.media.length; i++)
      names[i] = add(names[i]!, await read(manifest.media[i]!))
    const playlistName = `${prefix}.m3u8`
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
    const name = add(playlistName, playlist)
    media[entry.itemId] = {
      file: name,
      sourceStartMs: info.sourceStartMs,
      kind: "hls",
    }
  }
  for (const item of document.items) {
    if (item.kind !== "image" && item.kind !== "audio") continue
    const asset = studioAssetVersionSchema.parse(
      await readMetadata("asset", item.asset),
    )
    const allowed =
      item.kind === "image"
        ? ["image/png", "image/jpeg", "image/webp"]
        : ["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"]
    if (!allowed.includes(asset.mimeType))
      throw new StudioBrokerError("Unsupported render asset type")
    const name = add(
      `asset-${files.length}`,
      await read(item.asset, 32 * 1024 * 1024),
    )
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

/** Durable render leases own preparation too: canonical descriptors are resolved
 * through the trusted broker, never client URLs or a human-edit impersonation.
 * Materialization adds retained byte identities without editing the admitted revision. */
export async function prepareStudioDraftRenderInput(
  call: StudioBrokerClient,
  projectId: string,
  rawDocument: unknown,
  proofKey: string,
  signal: AbortSignal,
  preparation: {
    read(): Promise<unknown>
    save(document: unknown): Promise<unknown>
  },
) {
  const existing = await preparation.read()
  const pinned =
    existing ??
    (await preparation.save(
      (await prepareStudioRenderSources(call, projectId, rawDocument, signal))
        .document,
    ))
  const { document } = z
    .object({ document: studioDocumentSchema })
    .parse(pinned)
  return prepareStudioRenderInput(call, projectId, document, proofKey, signal)
}
