// Shorts draft artifact contract (plan 2026-06-11-002 decision 4).
//
// Whisper output (shorts-captions-v1) is immutable; operator edits live in
// this draft artifact (shorts-draft-v1.json under the short's assetId).
// `draftVersion` is incremented SERVER-SIDE on every save (last-write-wins,
// no optimistic-concurrency 409); `captionsGeneratedAt` is provenance — a
// draft built against regenerated captions is stale and gets reset.
// `updatedBy` is derived from the authenticated actor by the routes, never
// the request body.

import { buildCaptionPages } from "@forge/shorts-compositions/captions"
import { draftSchema, type ShortDraft } from "@forge/shorts-compositions/schema"
import { z } from "zod"
import {
  SHORTS_DRAFT_ARTIFACT_TYPE,
  type ShortsCaption,
} from "@/lib/shorts-artifacts"

export const INITIAL_DRAFT_UPDATED_BY = "system:shorts-prepare"

export const shortsDraftArtifactSchema = z.looseObject({
  draftVersion: z.number().int().min(1),
  captionsGeneratedAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  draft: draftSchema,
})

export type ShortsDraftArtifact = z.infer<typeof shortsDraftArtifactSchema>

export function parseShortsDraftArtifact(
  value: unknown,
): ShortsDraftArtifact | null {
  const parsed = shortsDraftArtifactSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// Default knob values for a freshly prepared short (plan decision 14 —
// Focus template, brand yellow accent, lower caption band).
export function buildInitialDraft(
  captions: ShortsCaption[],
  captionsGeneratedAt: string,
  now: () => Date = () => new Date(),
): ShortsDraftArtifact {
  const captionPages = buildCaptionPages(captions)
  const draft: ShortDraft = {
    templateId: "focus",
    accentColor: "#facc15",
    captionPosition: "lower",
    captionFont: "montserrat",
    waveformStyle: "bars",
    showCaptions: captions.length > 0,
    captionPages,
  }

  return {
    draftVersion: 1,
    captionsGeneratedAt,
    updatedBy: INITIAL_DRAFT_UPDATED_BY,
    updatedAt: now().toISOString(),
    draft,
  }
}

// Provenance decision for the prepare workflow: keep an existing draft only
// when it parses AND was built against the CURRENT captions artifact.
// Anything else (no draft, malformed draft, regenerated captions after a
// force-prepare) resets to the initial draft — force-prepare's documented
// caption-edit discard flows through this mismatch. Pure and unit-tested.
export function shouldResetDraft(
  existing: ShortsDraftArtifact | null,
  captionsGeneratedAt: string,
): boolean {
  return (
    existing === null || existing.captionsGeneratedAt !== captionsGeneratedAt
  )
}

// ---------------------------------------------------------------------------
// Storage helpers (S3-or-local via the manager storage service)
// ---------------------------------------------------------------------------

// Returns null for a missing OR malformed draft artifact — callers decide
// whether that is a reset (prepare) or a FatalError (render).
export async function readShortsDraft(
  assetId: string,
): Promise<ShortsDraftArtifact | null> {
  const { readArtifact } = await import("@/services/storage")

  // No existence pre-check: a missing artifact throws into the same catch as
  // a malformed one — both mean "no usable draft" (null).
  try {
    const bytes = await readArtifact(
      assetId,
      SHORTS_DRAFT_ARTIFACT_TYPE,
      "json",
    )
    return parseShortsDraftArtifact(
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    )
  } catch {
    return null
  }
}

export async function writeShortsDraft(
  assetId: string,
  artifact: ShortsDraftArtifact,
): Promise<void> {
  const { writeArtifact } = await import("@/services/storage")

  await writeArtifact({
    assetId,
    artifactType: SHORTS_DRAFT_ARTIFACT_TYPE,
    ext: "json",
    body: JSON.stringify(artifact, null, 2),
    contentType: "application/json",
  })
}
