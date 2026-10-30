/** Historical scheduler identity remains registered for stored replay. */
export async function runRecommendationProfileReconciliationScheduler(
  input: { ledgerRunId?: string } = {},
): Promise<void> {
  "use workflow"
  await stepCompleteBehavioralRetirement(input)
}

async function stepCompleteBehavioralRetirement(input: {
  ledgerRunId?: string
}): Promise<void> {
  "use step"
  if (!input.ledgerRunId) return
  const { prisma } = await import("@/db/client")
  await prisma.workflowRun.updateMany({
    where: { id: input.ledgerRunId, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      status: "CANCELLED",
      finishedAt: new Date(),
      summary: "Behavioral recommendations retired.",
    },
  })
}
