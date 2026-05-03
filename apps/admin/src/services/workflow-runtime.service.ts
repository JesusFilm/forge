import { getWorld } from "workflow/runtime"

export type WorkflowRuntimeRun = {
  runId: string
  workflowName: string
  displayName: string
  status: string
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  error?: string
  stepCount: number
  eventCount: number
}

function displayNameFromWorkflowName(workflowName: string): string {
  const parts = workflowName.split("//").filter(Boolean)
  return parts[parts.length - 1] ?? workflowName
}

export async function loadWorkflowRuntimeRuns(
  limit = 20,
): Promise<WorkflowRuntimeRun[]> {
  try {
    const world = getWorld()
    const runs = await world.runs.list({
      pagination: { limit, sortOrder: "desc" },
      resolveData: "none",
    })

    return Promise.all(
      runs.data.map(async (run) => {
        const [steps, events] = await Promise.all([
          world.steps
            .list({
              runId: run.runId,
              pagination: { limit: 1000 },
              resolveData: "none",
            })
            .catch(() => ({ data: [] })),
          world.events
            .list({
              runId: run.runId,
              pagination: { limit: 1000 },
              resolveData: "none",
            })
            .catch(() => ({ data: [] })),
        ])

        return {
          runId: run.runId,
          workflowName: run.workflowName,
          displayName: displayNameFromWorkflowName(run.workflowName),
          status: run.status,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          error: run.error?.message,
          stepCount: steps.data.length,
          eventCount: events.data.length,
        }
      }),
    )
  } catch {
    return []
  }
}
