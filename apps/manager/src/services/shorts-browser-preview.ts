import { z } from "zod"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { studioAssetVersionSchema } from "@forge/studio-contracts/assets"
import { studioSourceSnapshotSchema } from "@forge/studio-contracts/sources"
import {
  studioPreviewSchema,
  type StudioPreview,
} from "@forge/studio-contracts/preview"
import {
  canonicalMediaUrl,
  createStudioAssetBroker,
  StudioBrokerError,
  StudioBrokerBusyError,
  type StudioBrokerClient,
} from "./studio-broker"

let preparing = false

/** Authorize references only; source HLS is decoded by the browser, not staged. */
export async function prepareBrowserPreview(
  call: StudioBrokerClient,
  projectId: string,
  raw: unknown,
  signal?: AbortSignal,
) {
  if (preparing)
    throw new StudioBrokerBusyError(
      "Another preview is preparing. Try again shortly.",
    )
  preparing = true
  try {
    const document = studioDocumentSchema.parse(raw)
    const sources = z
      .array(
        z.object({ itemId: z.string(), snapshot: studioSourceSnapshotSchema }),
      )
      .parse(await call("preview-sources", { projectId, document }))
    const media: StudioPreview["media"] = {},
      code: StudioPreview["code"] = {}
    const urls: Record<string, string> = {}
    const files: { name: string; type: string; base64: string }[] = []
    const assets = createStudioAssetBroker(call, signal)
    let remaining = 64 * 1024 * 1024
    for (const { itemId, snapshot } of sources) {
      const name = `source-${itemId}`
      media[itemId] = { file: name, sourceStartMs: 0, kind: "hls" }
      urls[name] = canonicalMediaUrl(snapshot.hlsUrl).href
    }
    for (const item of document.items) {
      if (item.kind !== "audio" && item.kind !== "image") continue
      const name = `asset-${item.asset.versionId}`
      const asset = studioAssetVersionSchema.parse(
        await call("asset", item.asset),
      )
      const allowed =
        item.kind === "image"
          ? ["image/png", "image/jpeg", "image/webp"]
          : ["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"]
      if (!allowed.includes(asset.mimeType))
        throw new StudioBrokerError("Unsupported preview asset type")
      if (!files.some((file) => file.name === name)) {
        const bytes = await assets.read(
          item.asset,
          Math.min(32 * 1024 * 1024, remaining),
        )
        remaining -= bytes.length
        files.push({
          name,
          type: asset.mimeType,
          base64: bytes.toString("base64"),
        })
      }
      media[item.id] = { file: name, sourceStartMs: 0, kind: item.kind }
    }
    const active = new Set(
      document.items.flatMap((item) =>
        item.kind === "component" ? [item.componentVersionId] : [],
      ),
    )
    for (const component of document.components.filter((component) =>
      active.has(component.versionId),
    )) {
      const bytes = await assets.read(
        component.code,
        Math.min(32768, remaining),
      )
      remaining -= bytes.length
      code[component.versionId] = new TextDecoder("utf-8", {
        fatal: true,
      }).decode(bytes)
    }
    signal?.throwIfAborted()
    return {
      input: studioPreviewSchema.parse({ document, media, code }),
      urls,
      files,
    }
  } finally {
    preparing = false
  }
}
