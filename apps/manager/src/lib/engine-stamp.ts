import { z } from "zod"

import type { EnrichmentEngine, JobOptions } from "@/types/job"

/**
 * The closed set of engine stamps — single source of truth for the zod guard.
 * `satisfies` proves it stays in lockstep with the `EnrichmentEngine` union.
 */
export const ENGINE_STAMPS = [
  "workflow",
  "mastra",
] as const satisfies readonly EnrichmentEngine[]

/**
 * Default engine for any job created before the stamp existed, or whose stamp
 * is missing / corrupt. MUST be "workflow": the durable dependency stays
 * installed through Phase 1, so an unstamped in-flight job belongs to it.
 * Reading a missing stamp as "mastra" would wrongly accept callbacks for jobs
 * the old engine owns.
 */
export const DEFAULT_ENGINE: EnrichmentEngine = "workflow"

const engineStampSchema = z.enum(ENGINE_STAMPS).catch(DEFAULT_ENGINE)

/**
 * Resolve a job's engine stamp from its `options`. Falls back to "workflow" on
 * missing / unknown values and never throws — a corrupt stamp on a durable job
 * record degrades to the safe engine rather than crashing a callback gate or a
 * recovery sweep.
 */
export function readEngineStamp(
  options: Pick<JobOptions, "engine"> | null | undefined,
): EnrichmentEngine {
  return engineStampSchema.parse(options?.engine)
}
