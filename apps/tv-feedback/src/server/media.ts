import "server-only"

import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import sharp from "sharp"

import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES } from "@/lib/contracts"

import type { Upload } from "./feedbackState"

const exec = promisify(execFile)

function signatureMatches(bytes: Buffer, type: string): boolean {
  if (type === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (type === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (type === "image/webp")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    )
  if (type === "video/mp4" || type === "video/quicktime")
    return bytes.toString("ascii", 4, 8) === "ftyp"
  return false
}

export async function readBounded(
  request: Request,
  limit: number,
): Promise<Buffer> {
  if (!request.body) throw new Error("empty_file")
  const reader = request.body.getReader()
  const chunks: Buffer[] = []
  let count = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      count += value.length
      if (count > limit) throw new Error("file_too_large")
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, count)
}

export async function normalizeMedia(
  upload: Upload,
  source: Buffer,
): Promise<{ bytes: Buffer; type: string; filename: string }> {
  if (source.length !== upload.size || !signatureMatches(source, upload.type))
    throw new Error("invalid_file")
  if (upload.kind === "image") {
    const metadata = await sharp(source, {
      limitInputPixels: 50_000_000,
    }).metadata()
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 50_000_000
    )
      throw new Error("invalid_image")
    const bytes = await sharp(source, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer()
    if (bytes.length > IMAGE_MAX_BYTES) throw new Error("image_too_large")
    return { bytes, type: "image/jpeg", filename: `${upload.id}.jpg` }
  }
  const directory = await mkdtemp(path.join(tmpdir(), "tv-feedback-"))
  const input = path.join(directory, "input.bin")
  const output = path.join(directory, "output.mp4")
  try {
    await writeFile(input, source, { flag: "wx", mode: 0o600 })
    const { stdout } = await exec(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name",
        "-of",
        "json",
        input,
      ],
      { timeout: 10_000, maxBuffer: 64 * 1024 },
    )
    const details = JSON.parse(stdout) as {
      format?: { duration?: string }
      streams?: Array<{ codec_type: string; codec_name: string }>
    }
    const duration = Number(details.format?.duration)
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 60 ||
      !details.streams?.some((s) => s.codec_type === "video")
    )
      throw new Error("invalid_video")
    const video = details.streams.find(
      (s) => s.codec_type === "video",
    )?.codec_name
    const audio = details.streams.find(
      (s) => s.codec_type === "audio",
    )?.codec_name
    const args =
      video === "h264" && (!audio || audio === "aac")
        ? ["-c:v", "copy", ...(audio ? ["-c:a", "copy"] : ["-an"])]
        : [
            "-vf",
            "scale=w=1920:h=1080:force_original_aspect_ratio=decrease",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "24",
            ...(audio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
          ]
    await exec(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-i",
        input,
        ...args,
        "-movflags",
        "+faststart",
        "-t",
        "60",
        "-y",
        output,
      ],
      { timeout: 180_000, maxBuffer: 64 * 1024 },
    )
    const bytes = await readFile(output)
    if (bytes.length > VIDEO_MAX_BYTES) throw new Error("video_too_large")
    return { bytes, type: "video/mp4", filename: `${upload.id}.mp4` }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
