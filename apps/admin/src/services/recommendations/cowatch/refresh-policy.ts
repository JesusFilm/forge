import { z } from "zod"
import { CowatchPublicationLimitsSchema } from "./projection.service"
import {
  COWATCH_SOURCE_WINDOW_VERSION,
  type CowatchSourceWindow,
} from "./source-window"

export const COWATCH_REFRESH_POLICY_VERSION =
  "cowatch-refresh-seven-day-mature-v1"
export const COWATCH_REFRESH_INTERVAL_MS = 12 * 3_600_000
export const COWATCH_REFRESH_CHECK_MS = 5 * 60_000
export const COWATCH_REFRESH_GRANT_MS = 29 * 86_400_000
export const COWATCH_REFRESH_LEASE_MS = 3 * 60_000
const bytes = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

/** Explicit measured ceilings, not a capacity estimate or permission to execute. */
export const CowatchRefreshBudgetSchema = z
  .object({
    publicationLimits: CowatchPublicationLimitsSchema,
    publicationReserveBytes: bytes,
    maxRetainedGraphBytes: bytes,
    maxRetainedGenerations: z.number().int().min(2).max(64),
    maxDatabaseBytes: bytes,
  })
  .strict()
  .refine(
    (budget) =>
      budget.publicationReserveBytes < budget.maxRetainedGraphBytes &&
      budget.maxRetainedGraphBytes < budget.maxDatabaseBytes,
  )
export type CowatchRefreshBudget = z.infer<typeof CowatchRefreshBudgetSchema>

/** Whole seven-day event population, matured beyond the six-hour hard capability. */
export function cowatchRefreshSourceWindow(now: Date): CowatchSourceWindow {
  const evaluationAsOf = new Date(
    Math.floor(now.getTime() / 3_600_000) * 3_600_000,
  )
  const windowEnd = new Date(evaluationAsOf.getTime() - 7 * 3_600_000)
  return {
    version: COWATCH_SOURCE_WINDOW_VERSION,
    windowStart: new Date(windowEnd.getTime() - 7 * 86_400_000),
    windowEnd,
    evaluationAsOf,
  }
}
