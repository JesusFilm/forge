// Render-props resolution + propsHash contract (plan 2026-06-11-002
// decision 8). The canonical props = operator draft knobs + caption pages +
// the clip referenced BY ARTIFACT IDENTITY (assetId + artifactType) — never
// runtime URLs. Manager canonicalizes and computes sha256 ONCE; the worker
// treats the hash as an opaque dedupe token and never recomputes it.

import { createHash } from "node:crypto"
import {
  shortInputPropsSchema,
  type ShortDraft,
} from "@forge/shorts-compositions/schema"
import { z } from "zod"
import type { ShortsClipMeta } from "@/lib/shorts-artifacts"

// Composition input props minus the server-injected clipUrl — exactly what
// the worker render submit body carries (apps/shorts-worker routes/jobs.ts
// uses shortInputPropsSchema.omit({ clipUrl: true }) on its side).
export const shortRenderPropsSchema = shortInputPropsSchema.omit({
  clipUrl: true,
})

export type ShortRenderProps = z.infer<typeof shortRenderPropsSchema>

export class ShortsPropsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ShortsPropsValidationError"
  }
}

// Composes the final render props from the operator draft + the worker's
// clip meta artifact. Server-derived fields (fps, clipDurationSec, hasAudio)
// come from clip meta only — the draft schema cannot carry them (plan
// decision 15). Throws ShortsPropsValidationError on schema violations
// (deterministic — callers map to FatalError).
export function resolveShortInputProps(input: {
  draft: ShortDraft
  clipMeta: ShortsClipMeta
}): ShortRenderProps {
  const { draft, clipMeta } = input
  const candidate = {
    templateId: draft.templateId,
    accentColor: draft.accentColor,
    captionPosition: draft.captionPosition,
    captionFont: draft.captionFont,
    waveformStyle: draft.waveformStyle,
    ...(draft.title !== undefined ? { title: draft.title } : {}),
    showCaptions: draft.showCaptions,
    captionPages: draft.captionPages,
    // The worker re-encodes clips at constant fps; ffprobe may report e.g.
    // 30.0 — round to satisfy the int schema without changing semantics.
    fps: Math.round(clipMeta.fps),
    clipDurationSec: clipMeta.durationSec,
    hasAudio: clipMeta.hasAudio,
  }

  const parsed = shortRenderPropsSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new ShortsPropsValidationError(
      `resolved short input props failed schema validation: ${parsed.error.message}`,
    )
  }
  return parsed.data
}

// Canonical JSON: object keys recursively sorted, arrays kept in order,
// undefined object values dropped (matching JSON.stringify semantics).
// Deterministic across key-insertion order so the propsHash is stable.
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) {
      throw new ShortsPropsValidationError(
        `value of type ${typeof value} is not JSON-serializable`,
      )
    }
    return encoded
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((entry) =>
        entry === undefined ? "null" : canonicalJsonStringify(entry),
      )
      .join(",")}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))

  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${canonicalJsonStringify(entryValue)}`,
    )
    .join(",")}}`
}

export type ShortsClipIdentity = {
  assetId: string
  artifactType: "shorts-clip-v1"
}

// sha256 hex over the canonical JSON of { clip, props }. clipUrl is never
// present (ShortRenderProps omits it by construction); the clip identity
// pins the hash to the exact clip artifact the props were resolved against.
// The worker's render dedupe key is `render:{assetId}:{propsHash}` — this
// hash IS the second half of that key.
export function computePropsHash(
  props: ShortRenderProps,
  clipIdentity: ShortsClipIdentity,
): string {
  const canonical = canonicalJsonStringify({ clip: clipIdentity, props })
  return createHash("sha256").update(canonical, "utf8").digest("hex")
}

// ---------------------------------------------------------------------------
// Render-props audit artifact (shorts-render-props-v1.json)
// ---------------------------------------------------------------------------

// Written by the render workflow's resolve step BEFORE the worker submit.
// The submit step re-reads this artifact (verifying propsHash provenance)
// instead of re-deriving props from the draft — the draft may move between
// steps, and the audit copy IS what must be sent.
export const shortsRenderPropsArtifactSchema = z.looseObject({
  propsHash: z.string().regex(/^[a-f0-9]{64}$/),
  draftVersion: z.number().int().min(1),
  props: shortRenderPropsSchema,
  generatedAt: z.string(),
})

export type ShortsRenderPropsArtifact = z.infer<
  typeof shortsRenderPropsArtifactSchema
>

export function buildShortsRenderPropsArtifact(input: {
  propsHash: string
  draftVersion: number
  props: ShortRenderProps
  generatedAt?: string
}): ShortsRenderPropsArtifact {
  return {
    propsHash: input.propsHash,
    draftVersion: input.draftVersion,
    props: input.props,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  }
}

export function parseShortsRenderPropsArtifact(
  value: unknown,
): ShortsRenderPropsArtifact | null {
  const parsed = shortsRenderPropsArtifactSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
