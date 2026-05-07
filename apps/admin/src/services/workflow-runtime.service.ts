import { getWorld } from "workflow/runtime"
import type { Event, Hook, Step, WorkflowRun } from "@workflow/world"

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

export type WorkflowRuntimeRunDetail = {
  run: WorkflowRun
  events: Event[]
  steps: Step[]
  hooks: Hook[]
  hasMoreEvents: boolean
  hasMoreSteps: boolean
  hasMoreHooks: boolean
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

export async function loadWorkflowRuntimeRunDetail(
  runId: string,
): Promise<WorkflowRuntimeRunDetail | null> {
  try {
    const world = getWorld()
    const run = (await world.runs.get(runId, {
      resolveData: "none",
    })) as WorkflowRun
    const [events, steps, hooks] = await Promise.all([
      world.events.list({
        runId,
        pagination: { limit: 1000, sortOrder: "asc" },
        resolveData: "none",
      }),
      world.steps.list({
        runId,
        pagination: { limit: 1000 },
        resolveData: "none",
      }),
      world.hooks.list({
        runId,
        pagination: { limit: 1000 },
        resolveData: "none",
      }),
    ])

    return {
      run,
      events: events.data as Event[],
      steps: steps.data as Step[],
      hooks: hooks.data as Hook[],
      hasMoreEvents: events.hasMore,
      hasMoreSteps: steps.hasMore,
      hasMoreHooks: hooks.hasMore,
    }
  } catch {
    return null
  }
}
