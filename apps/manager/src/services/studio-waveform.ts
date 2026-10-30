import { sourceAdmissionDocument } from "./studio-source-admission"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import pLimit from "p-limit"
import { z } from "zod"
import type { StudioDocument } from "@forge/studio-contracts"
import { studioSourceSnapshotSchema } from "@forge/studio-contracts/sources"
import { studioAssetVersionSchema } from "@forge/studio-contracts/assets"
import {
  studioHlsRendition,
  studioHlsSegments,
} from "@forge/studio-contracts/hls"
import {
  createStudioAssetBroker,
  createStudioSourceDownload,
  type StudioBrokerClient,
} from "./studio-broker"
import { env } from "@/config/env"
import { pcmPeaks, waveformKey } from "@/features/video-studio/waveform-data"
const execute = promisify(execFile)
const limit = pLimit(2)
const cache = new Map<string, number[]>()
class StudioWaveformError extends Error {}

export async function prepareStudioWaveform(
  call: StudioBrokerClient,
  projectId: string,
  document: StudioDocument,
  itemId: string,
  signal?: AbortSignal,
) {
  const item = document.items.find((i) => i.id === itemId)
  if (!item || (item.kind !== "video" && item.kind !== "audio"))
    throw new StudioWaveformError("Select an audio clip")
  const durationMs =
    item.kind === "video"
      ? item.source.endMs - item.source.startMs
      : (item.durationInFrames * 1000) / document.fps
  if (durationMs <= 0 || durationMs > 300000)
    throw new StudioWaveformError(
      "Waveform previews support clips up to five minutes",
    )
  // Re-authorize before consulting the immutable-data cache.
  let source: z.infer<typeof studioSourceSnapshotSchema> | undefined
  if (item.kind === "video") {
    const sources = z
      .array(
        z.object({ itemId: z.string(), snapshot: studioSourceSnapshotSchema }),
      )
      .parse(
        await call("preview-sources", {
          projectId,
          document: sourceAdmissionDocument(document),
        }),
      )
    source = sources.find((s) => s.itemId === itemId)?.snapshot
    if (!source) throw new StudioWaveformError("Source audio unavailable")
  } else {
    await call("read", projectId)
    const asset = studioAssetVersionSchema.parse(
      await call("asset", item.asset),
    )
    if (
      !["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"].includes(
        asset.mimeType,
      )
    )
      throw new StudioWaveformError("Unsupported audio format")
  }
  const key = createHash("sha256")
    .update(waveformKey(item, document.fps) + (source?.catalogDigest ?? ""))
    .digest("hex")
  const prior = cache.get(key)
  if (prior) return { peaks: prior }
  return limit(async () => {
    signal?.throwIfAborted()
    const reused = cache.get(key)
    if (reused) return { peaks: reused }
    const directory = await mkdtemp(join(tmpdir(), "studio-waveform-"))
    try {
      let path: string, offsetMs: number
      if (item.kind === "video" && source) {
        const download = createStudioSourceDownload(signal, 32 * 1024 * 1024)
        const master = (await download(source.hlsUrl, 1048576)).toString()
        const rendition = studioHlsRendition(master, source.hlsUrl, 270, false)
        const segments = studioHlsSegments(
          (await download(rendition.url, 1048576)).toString(),
          rendition.url,
        ).filter(
          (s) => s.endMs > item.source.startMs && s.startMs < item.source.endMs,
        )
        if (
          !segments.length ||
          segments.length > 64 ||
          segments[0]!.startMs > item.source.startMs ||
          segments.at(-1)!.endMs + 1 < item.source.endMs
        )
          throw new StudioWaveformError("Audio range unavailable")
        const names: string[] = []
        for (const [index, segment] of segments.entries()) {
          const name = `segment-${index}.ts`
          names.push(name)
          await writeFile(
            join(directory, name),
            await download(segment.url, 16 * 1024 * 1024),
          )
        }
        path = join(directory, "audio.m3u8")
        await writeFile(
          path,
          [
            "#EXTM3U",
            "#EXT-X-VERSION:3",
            `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...segments.map((s) => s.duration)))}`,
            "#EXT-X-MEDIA-SEQUENCE:0",
            ...segments.flatMap((s, i) => [
              `#EXTINF:${s.duration},`,
              names[i]!,
            ]),
            "#EXT-X-ENDLIST",
          ].join("\n"),
        )
        offsetMs = item.source.startMs - segments[0]!.startMs
      } else if (item.kind === "audio") {
        path = join(directory, "audio.bin")
        await writeFile(
          path,
          await createStudioAssetBroker(call, signal).read(
            item.asset,
            32 * 1024 * 1024,
          ),
        )
        offsetMs = item.sourceStartMs
      } else throw new StudioWaveformError("Source audio unavailable")
      let stdout: Buffer
      try {
        const result = await execute(
          env.STUDIO_FFMPEG_PATH ?? "ffmpeg",
          [
            "-v",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "file,crypto,data",
            "-i",
            path,
            "-ss",
            String(offsetMs / 1000),
            "-t",
            String(durationMs / 1000),
            "-map",
            "0:a:0",
            "-vn",
            "-af",
            "apad",
            "-ac",
            "1",
            "-ar",
            "4000",
            "-f",
            "s16le",
            "pipe:1",
          ],
          {
            encoding: "buffer",
            timeout: 20000,
            maxBuffer: 3 * 1024 * 1024,
            signal,
          },
        )
        stdout = result.stdout
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          throw new StudioWaveformError(
            "Waveform previews require the configured FFmpeg binary",
          )
        throw new StudioWaveformError(
          "Audio waveform unavailable for this clip",
        )
      }
      if (!stdout.length)
        throw new StudioWaveformError("This clip has no decodable audio")
      const peaks = pcmPeaks(stdout)
      if (cache.size >= 128) cache.delete(cache.keys().next().value!)
      cache.set(key, peaks)
      return { peaks }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
