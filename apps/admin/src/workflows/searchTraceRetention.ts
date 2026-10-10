import { sleep } from "workflow"
import type {
  SearchTraceRetentionJobResult,
  SearchTraceRetentionSchedulerInput,
  SearchTraceRetentionWorkflowInput,
} from "@/services/search-trace-retention/job"

export async function runSearchTraceRetention(
  input: SearchTraceRetentionWorkflowInput = {},
): Promise<SearchTraceRetentionJobResult> {
  "use workflow"

  return stepRunSearchTraceRetention(input)
}

async function stepRunSearchTraceRetention(
  input: SearchTraceRetentionWorkflowInput,
): Promise<SearchTraceRetentionJobResult> {
  "use step"

  const { runSearchTraceRetentionJob } =
    await import("@/services/search-trace-retention/job")
  return runSearchTraceRetentionJob(input)
}

export async function runSearchTraceRetentionScheduler(
  input: SearchTraceRetentionSchedulerInput = {},
): Promise<never> {
  "use workflow"

  await stepMarkSchedulerStarted(input)
  await stepRunScheduledPurge()

  while (true) {
    const nextRunAt = await stepNextRunAt(input)
    await sleep(nextRunAt)
    await stepRunScheduledPurge()
  }
}

async function stepMarkSchedulerStarted(
  input: SearchTraceRetentionSchedulerInput,
): Promise<void> {
  "use step"

  const { markSearchTraceRetentionSchedulerStarted } =
    await import("@/services/search-trace-retention/job")
  await markSearchTraceRetentionSchedulerStarted(input)
}

async function stepNextRunAt(
  input: SearchTraceRetentionSchedulerInput,
): Promise<Date> {
  "use step"

  const {
    nextSearchTraceRetentionRunAt,
    recordSearchTraceRetentionSchedulerHeartbeat,
  } = await import("@/services/search-trace-retention/job")
  const nextRunAt = nextSearchTraceRetentionRunAt()
  await recordSearchTraceRetentionSchedulerHeartbeat(input, nextRunAt)
  return nextRunAt
}

async function stepRunScheduledPurge(): Promise<void> {
  "use step"

  const { runSearchTraceRetentionFromScheduler } =
    await import("@/services/search-trace-retention/job")
  await runSearchTraceRetentionFromScheduler()
}
