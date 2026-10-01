import { spawn } from "node:child_process"
import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * The "source pack": everything a finished devotional was rendered FROM,
 * kept next to the MP4 as `<name>.source/`.
 *
 * Why it exists (feat-573): the render stages its manifest, film clip,
 * background and per-segment audio in a temp dir that is deleted when the
 * encode finishes. A later cut-down into vertical shorts needs exactly those
 * files, laid out the same way, so it can re-render any span of the
 * devotional through the same composition at zero TTS cost. Without the pack
 * the only way back was a full re-run of the pipeline.
 *
 * Videos are re-encoded to save disk (owner choice 2026-10-01). The stage
 * files are already CRF 18, so the saving is real but modest, measured on
 * Martha and Mary: the film at CRF 20 is about 25% smaller, the background at
 * CRF 23 about 44% smaller, roughly 450 MB down to 280 MB per devotional.
 * The background is NOT downscaled: some cards blur it by under a pixel.
 * Audio and the manifest are copied byte-for-byte, so word timings and
 * durations still match.
 */

/** CRF for a file a card plays as the film (what viewers watch closely). */
export const FILM_CRF = 20
/** CRF for every other video: the blurred, darkened background. */
export const BACKGROUND_CRF = 23

export const SOURCE_PACK_VERSION = 1

/** `/out/name.mp4` → `/out/name.source` */
export function sourcePackDir(videoPath: string): string {
  return videoPath.replace(/\.mp4$/i, "") + ".source"
}

/**
 * Every staged file the manifest points at: any string under a key ending in
 * `File` (`audioFile`, `videoFile`, `bgFile`, `musicFile`, and whatever is
 * added later), at any depth. Walking the keys rather than listing them is
 * deliberate: a new per-card asset that is not in the pack would only show
 * up as a broken short weeks later.
 */
export function collectManifestFiles(manifest: unknown): string[] {
  const found = new Set<string>()
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(walk)
      return
    }
    if (!v || typeof v !== "object") return
    for (const [k, child] of Object.entries(v)) {
      if (/File$/.test(k) && typeof child === "string" && child) {
        // Staged names are bare relative paths. Anything else would let the
        // pack copy from (or write to) outside the stage.
        if (path.isAbsolute(child) || child.split(/[\\/]/).includes("..")) {
          throw new Error(`manifest ${k} is not a staged file: ${child}`)
        }
        found.add(child)
      } else {
        walk(child)
      }
    }
  }
  walk(manifest)
  return [...found].sort()
}

/**
 * Files some card plays as the film (`videoFile`). A per-card `bgFile` can
 * point at the same clip, so the film's quality is decided by this role, not
 * by which key happened to be seen first.
 */
export function filmFiles(manifest: unknown): Set<string> {
  const found = new Set<string>()
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== "object") return
    for (const [k, child] of Object.entries(v)) {
      if (k === "videoFile" && typeof child === "string") found.add(child)
      else walk(child)
    }
  }
  walk(manifest)
  return found
}

/** Re-encode a staged video at a quality that survives a 1080p re-render. */
export function transcodeVideo(
  src: string,
  dest: string,
  crf: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(
      "ffmpeg",
      [
        "-y",
        "-i",
        src,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-crf",
        String(crf),
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        // The film clip's own sound is part of the cut: copy it untouched.
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        dest,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    )
    let err = ""
    c.stderr.on("data", (d) => {
      if (err.length < 4000) err += d.toString()
    })
    c.on("error", reject)
    c.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${err.trim().slice(-500)}`))
    })
  })
}

/** How the pack's manifest was rendered, so a cut-down matches the look. */
export type SourcePackRender = {
  comp: string
  style: string
  layout: string
  musicVolume: number
  xfadeSec: number
  videoAudioLevel: number
  /** The options bag passed to the Remotion render script. */
  options: Record<string, unknown>
}

export type SourcePackInput = {
  stage: string
  manifest: unknown
  videoPath: string
  /** The devotional text as rendered (paragraph roles, credits, verse). */
  devotional: unknown
  render: SourcePackRender
  log?: (msg: string) => void
  /** Injected in tests; ffmpeg by default. */
  transcode?: (src: string, dest: string, crf: number) => Promise<void>
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Write `<name>.source/` next to the rendered video. Built in a sibling temp
 * dir and renamed into place, so a crash halfway never leaves a pack that
 * looks complete but is missing files.
 */
export async function writeSourcePack(input: SourcePackInput): Promise<string> {
  const log = input.log ?? (() => {})
  const transcode = input.transcode ?? transcodeVideo
  const dir = sourcePackDir(input.videoPath)
  const tmp = `${dir}.partial-${process.pid}`
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  try {
    const files = collectManifestFiles(input.manifest)
    const film = filmFiles(input.manifest)
    let bytes = 0
    for (const f of files) {
      const src = path.join(input.stage, f)
      const dest = path.join(tmp, f)
      await mkdir(path.dirname(dest), { recursive: true })
      if (VIDEO_EXT.test(f)) {
        await transcode(src, dest, film.has(f) ? FILM_CRF : BACKGROUND_CRF)
      } else await copyFile(src, dest)
      bytes += (await stat(dest)).size
    }
    const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n"
    await writeFile(path.join(tmp, "manifest.json"), json(input.manifest))
    await writeFile(path.join(tmp, "devotional.json"), json(input.devotional))
    await writeFile(
      path.join(tmp, "render.json"),
      json({
        version: SOURCE_PACK_VERSION,
        createdAt: new Date().toISOString(),
        video: path.basename(input.videoPath),
        files,
        ...input.render,
      }),
    )
    // The video name is already unique (`nextFreePath`), so a pack with this
    // name belongs to a take whose MP4 was moved away. Owner rule: nothing is
    // overwritten, so it goes to `archive/` like any old output.
    if (await exists(dir)) {
      const archive = path.join(path.dirname(dir), "archive")
      await mkdir(archive, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      await rename(dir, path.join(archive, `${path.basename(dir)}-${stamp}`))
    }
    await rename(tmp, dir)
    log(
      `source pack → ${dir} (${files.length} files, ` +
        `${(bytes / 1024 / 1024).toFixed(0)} MB)`,
    )
    return dir
  } catch (e) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
    throw e
  }
}
