import { Prisma } from "@prisma/client"
import { lockPrecomputedCtrEvidence } from "./ctr-fence"
import { precomputedBrowserUnitDigest } from "./visit-identity"

async function currentPrivateBinding(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string
    expectedVisitId?: string | null
    clock: () => Date
  },
) {
  const binding = await tx.recommendationPrecomputedVisitRequest.findUnique({
    where: { requestId: input.requestId },
    include: { visit: true },
  })
  // A pre-read private request stays private even after raw link expiry.
  if (
    !binding ||
    (input.expectedVisitId && binding.visitId !== input.expectedVisitId)
  )
    return null
  await lockPrecomputedCtrEvidence(tx, binding.visit.experimentId, "shared")
  // Re-read after the fence: archive may have deleted the link while we waited.
  const current = await tx.recommendationPrecomputedVisitRequest.findUnique({
    where: { requestId: input.requestId },
    include: { visit: true },
  })
  const now = input.clock()
  if (
    !current ||
    (input.expectedVisitId && current.visitId !== input.expectedVisitId) ||
    current.expiresAt <= now ||
    current.visit.expiresAt <= now ||
    current.visit.eligibility !== "eligible" ||
    (await tx.recommendationPrecomputedCtrReport.findFirst({
      where: { experimentId: current.visit.experimentId, isFinal: true },
      select: { revision: true },
    }))
  )
    return null

  return {
    now,
    experimentId: current.visit.experimentId,
    browserUnitDigest: current.visit.browserUnitDigest,
  }
}

/** Render/impression receipts share the archive/finalization fence. */
export async function lockPrivatePrecomputedRequestEvidence(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string
    expectedVisitId?: string | null
    clock: () => Date
  },
): Promise<Date | null> {
  return (await currentPrivateBinding(tx, input))?.now ?? null
}

/** Private selections belong to the admitted signed browser unit. A reset or
 * deletion removes that cookie; profile controls do not gate contextual clicks. */
export async function matchesPrivateVisitBrowser(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string
    expectedVisitId?: string | null
    browserDigest?: string | null
    clock: () => Date
  },
): Promise<Date | null> {
  const current = await currentPrivateBinding(tx, input)
  if (
    !current ||
    !input.browserDigest ||
    !/^[a-f0-9]{64}$/.test(input.browserDigest)
  )
    return null

  const expected = precomputedBrowserUnitDigest(
    current.experimentId,
    input.browserDigest,
  )
  return current.browserUnitDigest === expected ? current.now : null
}
