"use client"

import { useMemo, useState } from "react"
import type { Event, Hook, Step, WorkflowRun } from "@workflow/world"
import {
  WorkflowTraceViewer,
  type SpanSelectionInfo,
} from "@workflow/web-shared"

type WorkflowTraceClientProps = {
  run: WorkflowRun
  events: Event[]
  steps: Step[]
  hooks: Hook[]
  hasMoreEvents: boolean
  hasMoreSteps: boolean
  hasMoreHooks: boolean
}

function findEventByCorrelation(
  events: Event[],
  correlationId: string,
): Event | null {
  return events.find((event) => event.correlationId === correlationId) ?? null
}

export function WorkflowTraceClient({
  run,
  events,
  steps,
  hooks,
  hasMoreEvents,
  hasMoreSteps,
  hasMoreHooks,
}: WorkflowTraceClientProps) {
  const [selectedSpan, setSelectedSpan] = useState<SpanSelectionInfo | null>(
    null,
  )
  const spanDetailData = useMemo(() => {
    if (!selectedSpan) return null

    if (selectedSpan.resource === "run") {
      return run
    }

    if (selectedSpan.resource === "step") {
      return (
        steps.find((step) => step.stepId === selectedSpan.resourceId) ??
        findEventByCorrelation(events, selectedSpan.resourceId)
      )
    }

    if (selectedSpan.resource === "hook") {
      return (
        hooks.find((hook) => hook.hookId === selectedSpan.resourceId) ??
        findEventByCorrelation(events, selectedSpan.resourceId)
      )
    }

    if (selectedSpan.resource === "sleep") {
      return findEventByCorrelation(events, selectedSpan.resourceId)
    }

    return null
  }, [events, hooks, run, selectedSpan, steps])

  return (
    <div
      className="workflow-trace-shell dark min-h-0 flex-1 overflow-hidden bg-[var(--ds-background-100)] text-[var(--ds-gray-1000)]"
      data-theme="dark"
    >
      <WorkflowTraceViewer
        run={run}
        events={events}
        spanDetailData={spanDetailData}
        onSpanSelect={setSelectedSpan}
        hasMoreSpans={hasMoreEvents || hasMoreSteps || hasMoreHooks}
      />
    </div>
  )
}
