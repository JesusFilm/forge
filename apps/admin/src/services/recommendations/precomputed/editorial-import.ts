import { createHash } from "node:crypto"
import { z } from "zod"
import type { precomputedChoiceSchema } from "./contract"

type Choice = z.infer<typeof precomputedChoiceSchema>
const id = z.string().trim().min(1).max(191)
const text = z.string().trim().min(12).max(600)
const editorial = z.object({
  schemaVersion: z.literal("editorial-related-videos-v1"),
  sourceGeneration: id,
  reviewBasis: z.string().min(1),
  records: z
    .array(
      z.object({
        sourceVideoId: id,
        sourceTitle: z.string().min(1),
        setRationale: text,
        evidenceFlags: z.array(z.string()),
        recommendations: z
          .array(
            z.object({
              rank: z.number().int().min(1).max(6),
              videoId: id,
              reason: text,
            }),
          )
          .length(6),
      }),
    )
    .min(1)
    .max(5000),
})

export class EditorialImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EditorialImportError"
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export type EditorialImportPlan = {
  version: "editorial-import-v1"
  generationId: string
  inputCutoff: string
  artifactSha256: string
  sourceGeneration: string
  reviewBasis: string
  sources: Array<{
    sourceVideoId: string
    choices: Choice[]
    exclusions: Array<{ targetVideoId: string; reason: string }>
    evidenceFlags: string[]
  }>
}

/** Expected content rejection returns a reason; transport/database failures throw. */
type Validate = (source: string, choices: Choice[]) => Promise<string | null>

async function mapFour<T, R>(
  items: T[],
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  let failure: unknown
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (!failure && next < items.length) {
        const index = next++
        try {
          results[index] = await run(items[index])
        } catch (cause) {
          failure ??=
            cause || new EditorialImportError("Import operation failed")
        }
      }
    }),
  )
  if (failure) throw failure
  return results
}

export async function prepareEditorialImport(input: {
  raw: string
  generationId: string
  inputCutoff: string
  validate: Validate
}): Promise<EditorialImportPlan> {
  const artifact = editorial.parse(JSON.parse(input.raw))
  id.parse(input.generationId)
  z.iso.datetime().parse(input.inputCutoff)
  const ids = artifact.records.map((r) => r.sourceVideoId)
  if (new Set(ids).size !== ids.length)
    throw new EditorialImportError("Duplicate source IDs")
  for (const source of artifact.records) {
    const targets = source.recommendations.map((r) => r.videoId)
    if (
      new Set(targets).size !== 6 ||
      targets.includes(source.sourceVideoId) ||
      source.recommendations.some((r, index) => r.rank !== index + 1) ||
      targets.some((target) => !ids.includes(target))
    )
      throw new EditorialImportError(
        `Invalid editorial slate: ${source.sourceVideoId}`,
      )
  }
  const sources = await mapFour(artifact.records, async (source) => {
    const baseError = await input.validate(source.sourceVideoId, [])
    if (baseError)
      throw new EditorialImportError(
        `Source unavailable: ${source.sourceVideoId}: ${baseError}`,
      )
    const choices: Choice[] = source.recommendations.map((item) => ({
      targetVideoId: item.videoId,
      kind: "direct",
      rank: item.rank,
      relationship: "editorial-related",
      reasonEnglish: item.reason,
      addedViewingValueEnglish: source.setRationale,
      evidence: { basis: "metadata", fields: ["title", "description"] },
    }))
    const unresolved = source.evidenceFlags.includes(
      "title-profile-mismatch-or-transcript-language-issue",
    )
    const accepted: Choice[] = []
    const exclusions: EditorialImportPlan["sources"][number]["exclusions"] = []
    if (unresolved) {
      for (const item of choices)
        exclusions.push({
          targetVideoId: item.targetVideoId,
          reason: "unresolved_source_evidence",
        })
    } else if (!(await input.validate(source.sourceVideoId, choices))) {
      accepted.push(...choices)
    } else {
      // Keep original editorial order; never relax the producer's identity rules.
      for (const item of choices) {
        const candidate = { ...item, rank: accepted.length + 1 }
        const reason = await input.validate(source.sourceVideoId, [
          ...accepted,
          candidate,
        ])
        if (reason)
          exclusions.push({ targetVideoId: item.targetVideoId, reason })
        else accepted.push(candidate)
      }
    }
    return {
      sourceVideoId: source.sourceVideoId,
      choices: accepted,
      exclusions,
      evidenceFlags: source.evidenceFlags,
    }
  })
  return {
    version: "editorial-import-v1",
    generationId: input.generationId,
    inputCutoff: input.inputCutoff,
    artifactSha256: createHash("sha256").update(input.raw).digest("hex"),
    sourceGeneration: artifact.sourceGeneration,
    reviewBasis: artifact.reviewBasis,
    sources,
  }
}

export function editorialImportManifest(plan: EditorialImportPlan) {
  if (plan.version !== "editorial-import-v1")
    throw new EditorialImportError("Unsupported import plan")
  const ids = plan.sources.map((source) => source.sourceVideoId)
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new EditorialImportError("Invalid source set")
  return {
    action: "start" as const,
    generationId: plan.generationId,
    modelId: "codex-editorial-session",
    promptVersion: "editorial-related-videos-v1",
    inputDigest: digest(plan),
    sourceSetDigest: digest([...ids].sort()),
    inputCutoff: plan.inputCutoff,
    expectedSourceCount: ids.length,
    inputMode: "content_only" as const,
    inputSnapshotMode: "observed_fenced" as const,
  }
}

/** Only the deployed producer API writes rows; completion never activates serving. */
export async function executeEditorialImport(
  plan: EditorialImportPlan,
  send: (payload: unknown) => Promise<unknown>,
) {
  await send(editorialImportManifest(plan))
  await mapFour(plan.sources, (source) =>
    send({
      action: "source",
      generationId: plan.generationId,
      sourceVideoId: source.sourceVideoId,
      choices: source.choices,
    }),
  )
  return send({ action: "complete", generationId: plan.generationId })
}
