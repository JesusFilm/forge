// React-free feasibility contract. Not the canonical Studio project model.
import { z } from "zod"

export class StudioProofError extends Error {}
export const RUNTIME_VERSION =
  "studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16"
const id = z.string().min(1).max(128)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const control = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      maxLength: z.number().int().min(1).max(500),
    })
    .strict(),
  z.object({ type: z.literal("color") }).strict(),
])
export const manifestSchema = z
  .object({
    runtime: z.literal(RUNTIME_VERSION),
    componentVersion: id,
    source: z.string().min(1).max(32_768),
    controls: z.record(
      z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/),
      control,
    ),
    props: z.record(z.string(), z.string().max(500)),
    width: z.number().int().min(16).max(1920),
    height: z.number().int().min(16).max(1920),
    fps: z.literal(30),
    durationInFrames: z.number().int().min(1).max(300),
    authorLanguageSlug: id,
    asset: z
      .object({
        videoId: id,
        dubId: id,
        editionId: id,
        languageSlug: id,
        previewDigest: digest,
        previewSegments: z
          .array(
            z
              .object({
                name: z.string().regex(/^segment-[0-9]+\.ts$/),
                digest,
                size: z
                  .number()
                  .int()
                  .positive()
                  .max(64 * 1_048_576),
              })
              .strict(),
          )
          .min(1)
          .max(32),
        exportDigest: digest,
        subtitle: z
          .object({
            trackId: id,
            editionId: id,
            languageSlug: id,
            digest,
            cues: z
              .array(
                z
                  .object({
                    startMs: z.number().nonnegative(),
                    endMs: z.number().positive(),
                    text: z.string().max(2000),
                  })
                  .strict(),
              )
              .max(1000),
          })
          .strict(),
        trimStartMs: z.number().int().nonnegative().max(86_400_000),
        trimEndMs: z.number().int().positive().max(86_400_000),
      })
      .strict(),
  })
  .strict()
export type StudioManifest = z.infer<typeof manifestSchema>

export function parseManifest(value: unknown): StudioManifest {
  const m = manifestSchema.parse(value)
  const { asset } = m
  if (
    asset.languageSlug !== m.authorLanguageSlug ||
    asset.subtitle.languageSlug !== m.authorLanguageSlug ||
    asset.subtitle.editionId !== asset.editionId
  ) {
    throw new StudioProofError(
      "Exact dub language and subtitle edition required",
    )
  }
  if (
    asset.trimEndMs <= asset.trimStartMs ||
    Math.abs(
      ((asset.trimEndMs - asset.trimStartMs) * m.fps) / 1000 -
        m.durationInFrames,
    ) > 0.001
  ) {
    throw new StudioProofError(
      "Trim must match the bounded composition duration",
    )
  }
  if (
    Object.keys(m.controls).length > 16 ||
    Object.keys(m.props).length !== Object.keys(m.controls).length
  )
    throw new StudioProofError("Invalid editable properties")
  for (const [key, c] of Object.entries(m.controls)) {
    const value = m.props[key]
    if (
      typeof value !== "string" ||
      (c.type === "text"
        ? value.length > c.maxLength
        : !/^#[a-fA-F0-9]{6}$/.test(value))
    )
      throw new StudioProofError("Invalid editable property")
  }
  if (asset.subtitle.cues.some((c) => c.endMs <= c.startMs))
    throw new StudioProofError("Invalid subtitle interval")
  return m
}

export function sourceTimeMs(m: StudioManifest, frame: number): number {
  if (!Number.isInteger(frame) || frame < 0 || frame >= m.durationInFrames)
    throw new StudioProofError("Frame outside source trim")
  return m.asset.trimStartMs + (frame * 1000) / m.fps
}
export function subtitlesAt(m: StudioManifest, frame: number): string[] {
  const ms = sourceTimeMs(m, frame)
  return m.asset.subtitle.cues
    .filter((c) => c.startMs <= ms && ms < c.endMs)
    .map((c) => c.text)
}
