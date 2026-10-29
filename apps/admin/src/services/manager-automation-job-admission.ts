import { Prisma } from "@prisma/client"
import { z } from "zod"
import { automationDraftSchema } from "@forge/automation-contracts"
import { ConcurrentModificationError } from "./errors"

const artifactSchema = z.object({
  kind: z.literal("metadata"),
  data: z.object({
    automationDocumentId: z.string().min(1),
    automationRunDocumentId: z.string().min(1),
    template: z.string(),
    refreshMode: z.string(),
    targetLanguageIds: z.array(z.string()),
    videoDocumentId: z.string().min(1),
    automationKey: z.string().min(1),
  }),
})

// Called in the job-creation transaction. Recovery and settlement lock this same
// parent row, so a timed-out dispatch cannot create jobs after losing its lease.
export async function assertAutomationJobAdmission(
  tx: Prisma.TransactionClient,
  artifacts: unknown,
  videoDocumentId: string | undefined,
) {
  if (
    !artifacts ||
    typeof artifacts !== "object" ||
    !("automation" in artifacts)
  )
    return
  const { data } = artifactSchema.parse(artifacts.automation)
  await tx.$queryRaw`SELECT id FROM manager_automation WHERE id=${data.automationDocumentId} FOR UPDATE`
  const run = await tx.managerAutomationRun.findUnique({
    where: { id: data.automationRunDocumentId },
    include: { automation: true },
  })
  const now = new Date()
  if (
    !run ||
    run.automationId !== data.automationDocumentId ||
    run.status !== "running" ||
    run.runMode !== "live" ||
    !run.scheduled ||
    !run.dispatchStartedAt ||
    run.activeAutomationId !== run.automationId ||
    run.leaseToken !== run.automation.leaseToken ||
    !run.automation.leaseExpiresAt ||
    run.automation.leaseExpiresAt <= now
  ) {
    throw new ConcurrentModificationError(
      "Automation dispatch",
      data.automationRunDocumentId,
    )
  }
  const definition = automationDraftSchema.parse(run.automation.definition)
  const target =
    definition.targetLanguageIds.slice().sort().join(",") || "source"
  if (
    data.videoDocumentId !== videoDocumentId ||
    data.template !== definition.template ||
    data.refreshMode !== definition.refreshMode ||
    JSON.stringify(data.targetLanguageIds.slice().sort()) !==
      JSON.stringify(definition.targetLanguageIds.slice().sort()) ||
    data.automationKey !== `${definition.template}:${videoDocumentId}:${target}`
  ) {
    throw new ConcurrentModificationError(
      "Automation input",
      data.automationRunDocumentId,
    )
  }
}
