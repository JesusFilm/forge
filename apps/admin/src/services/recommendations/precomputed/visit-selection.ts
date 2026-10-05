import { Prisma } from "@prisma/client"
import { precomputedBrowserUnitDigest } from "./visit-identity"

/** Private selection evidence belongs to the same signed browser unit that
 * was admitted. A reset or deletion removes that cookie; profile choices do
 * not gate contextual clicks or change the experiment arm. */
export async function matchesPrivateVisitBrowser(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string
    browserDigest?: string | null
    now: Date
  },
): Promise<boolean> {
  const binding = await tx.recommendationPrecomputedVisitRequest.findUnique({
    where: { requestId: input.requestId },
    include: { visit: true },
  })
  if (!binding) return true
  if (
    !input.browserDigest ||
    !/^[a-f0-9]{64}$/.test(input.browserDigest) ||
    binding.expiresAt <= input.now ||
    binding.visit.expiresAt <= input.now ||
    binding.visit.eligibility !== "eligible"
  )
    return false

  const expected = precomputedBrowserUnitDigest(
    binding.visit.experimentId,
    input.browserDigest,
  )
  return binding.visit.browserUnitDigest === expected
}
