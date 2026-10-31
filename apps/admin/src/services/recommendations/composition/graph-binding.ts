import type { Prisma } from "@prisma/client"
import { RecommendationConflictError } from "../errors"

/** Historical graph-bound composition cannot be reactivated. */
export async function validateCompositionGraph(
  _tx: Prisma.TransactionClient,
  _generationId: string,
  _now: Date,
): Promise<{ expiresAt: Date }> {
  throw new RecommendationConflictError("behavioral_recommendations_retired")
}
