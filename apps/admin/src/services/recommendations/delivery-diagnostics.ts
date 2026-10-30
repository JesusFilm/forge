import { z } from "zod"
import { servedSnapshotValue } from "./served-item-payload"
import type { Prisma } from "@prisma/client"

const locale = z
  .string()
  .regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/)
  .max(32)
const audio = z.string().regex(/^[a-z0-9-]{1,64}$/)
const count = z.number().int().min(0).max(384)

export const SemanticRetrievalDiagnosticsSchema = z
  .object({
    seed: z.enum([
      "missing_transcript",
      "compatible_embedding_unavailable",
      "available",
    ]),
    presentationAvailable: z.boolean(),
    exactAudioAvailable: z.boolean(),
    nearestChunks: count,
    eligibleVideos: count,
    returnedCandidates: count,
  })
  .strict()

export type SemanticRetrievalDiagnostics = z.infer<
  typeof SemanticRetrievalDiagnosticsSchema
>

export const CuratedDeliveryDiagnosticsSchema = z
  .object({
    state: z.enum(["missing_generation", "missing_context", "available"]),
    nominatedCount: z.number().int().min(0).max(64),
  })
  .strict()

export type CuratedDeliveryDiagnostics = z.infer<
  typeof CuratedDeliveryDiagnosticsSchema
>

/** Request-owned facts only: no viewer/history IDs, vectors or free-form text. */
export const DeliveryDiagnosticsSchema = z
  .object({
    version: z.literal(1),
    transcriptLocale: locale,
    presentationLocale: locale,
    audioLanguageSlug: audio,
    retrieval: SemanticRetrievalDiagnosticsSchema.nullable(),
    curated: CuratedDeliveryDiagnosticsSchema.nullable(),
    candidateSource: z.enum(["fresh", "cached", "unavailable"]),
    requestedCount: z.number().int().min(1).max(64),
    composedCount: z.number().int().min(0).max(64),
  })
  .strict()

export type DeliveryDiagnostics = z.infer<typeof DeliveryDiagnosticsSchema>

export function readDeliveryDiagnostics(
  value: unknown,
): DeliveryDiagnostics | null {
  const parsed = DeliveryDiagnosticsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Historical empty requests have unknown audio; never infer it from locale. */
export function readDeliveryAudioContext(input: {
  deliveryDiagnostics?: unknown
  servedItemPayload: Prisma.JsonValue | null
  items: Array<{
    id: string
    presentation: Prisma.JsonValue
    candidateProvenance: Prisma.JsonValue
  }>
}): string | null {
  const diagnostics = readDeliveryDiagnostics(input.deliveryDiagnostics)
  if (diagnostics) return diagnostics.audioLanguageSlug
  const slugs = new Set<string>()
  try {
    for (const item of input.items) {
      const presentation = servedSnapshotValue(
        input.servedItemPayload,
        item,
      ).presentation
      if (
        !presentation ||
        typeof presentation !== "object" ||
        Array.isArray(presentation)
      )
        return null
      const parsed = audio.safeParse(presentation.audioLanguageSlug)
      if (!parsed.success) return null
      slugs.add(parsed.data)
    }
  } catch {
    return null
  }
  return slugs.size === 1 ? [...slugs][0]! : null
}
