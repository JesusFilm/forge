/**
 * KTD17 and F2 — whether a campaign's test send is still collecting receipts,
 * and until about when.
 *
 * KTD14 — this module is on the agent path, so it never sends. It reads the
 * campaign and its ledger row with Prisma and imports nothing from the send
 * path: `dispatch.ts` imports from here, never the reverse.
 */
import {
  WorkflowRunStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client"

/**
 * The wait before a run's last reconcile. The workflow module declares the
 * same value, and the agent path may not import it, so a test pins the two.
 */
export const PUSH_TEST_RECEIPT_WINDOW_MS = 15 * 60_000

export type PushTestRunState =
  | Readonly<{ running: false; receiptsUntil: null }>
  | Readonly<{ running: true; receiptsUntil: Date }>

const NOT_RUNNING: PushTestRunState = { running: false, receiptsUntil: null }

function isTestRun(details: Prisma.JsonValue): boolean {
  return (
    typeof details === "object" &&
    details !== null &&
    !Array.isArray(details) &&
    details.kind === "TEST"
  )
}

/**
 * A test that is queued or running. `startedAt` is set only when the run
 * starts, so a queued test counts its window from `createdAt`.
 */
export async function readPushTestRunState(
  prisma: Pick<PrismaClient, "pushCampaign" | "workflowRun">,
  campaignId: string,
): Promise<PushTestRunState> {
  const campaign = await prisma.pushCampaign.findUnique({
    where: { id: campaignId },
    select: { workflowRunLogId: true },
  })
  if (!campaign?.workflowRunLogId) return NOT_RUNNING
  const ledger = await prisma.workflowRun.findUnique({
    where: { id: campaign.workflowRunLogId },
    select: { status: true, details: true, startedAt: true, createdAt: true },
  })
  if (
    !ledger ||
    !isTestRun(ledger.details) ||
    (ledger.status !== WorkflowRunStatus.QUEUED &&
      ledger.status !== WorkflowRunStatus.RUNNING)
  ) {
    return NOT_RUNNING
  }
  const from = ledger.startedAt ?? ledger.createdAt
  return {
    running: true,
    receiptsUntil: new Date(from.getTime() + PUSH_TEST_RECEIPT_WINDOW_MS),
  }
}

/** `HH:MM` UTC. The minute rounds up, so the time is never before `at`. */
export function formatPushReceiptsClock(at: Date): string {
  const minute = new Date(Math.ceil(at.getTime() / 60_000) * 60_000)
  return minute.toISOString().slice(11, 16)
}

/** KTD17 — a test cannot be cancelled, so the refusal names when it ends. */
export function formatPushTestRunRefusal(receiptsUntil: Date): string {
  return `The last test is still collecting receipts until about ${formatPushReceiptsClock(receiptsUntil)} UTC. Send a new test after that.`
}
