"use client"

import { Pause, Play } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { EnrichmentAutomation } from "./automation-contract"
import {
  AUTOMATION_REFRESH_MODE_LABELS,
  AUTOMATION_TEMPLATE_LABELS,
} from "./automation-contract"
import { formatLanguageSummary } from "./automation-list-presenter"
import { AutomationRunHistory } from "./automation-run-history"

function formatDateTime(value?: string | null): string {
  if (!value) return "n/a"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export function AutomationList({
  automations,
  emptyMessage,
  onStatusChange,
  languageNamesByCoreId,
}: {
  automations: EnrichmentAutomation[]
  emptyMessage: string
  languageNamesByCoreId: ReadonlyMap<string, string>
  onStatusChange: (
    automation: EnrichmentAutomation,
    status: "active" | "paused",
  ) => void
}) {
  if (automations.length === 0) {
    return (
      <p className="text-[15px] leading-7 text-muted-foreground">
        {emptyMessage}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {automations.map((automation) => (
        <article
          key={automation.documentId}
          className="space-y-5 rounded-[2rem] border border-border bg-card px-6 py-6 shadow-[0_1px_2px_rgba(8,8,8,0.04)]"
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 space-y-2">
              <strong className="block text-[1.55rem] leading-[1.08] font-semibold tracking-[-0.035em] text-foreground">
                {automation.name}
              </strong>
              <p className="text-[1rem] leading-7 tracking-[-0.015em] text-muted-foreground">
                {AUTOMATION_TEMPLATE_LABELS[automation.template]} ·{" "}
                {automation.scheduleSummary ?? "Schedule pending"} · cap{" "}
                {automation.maxVideosPerRun}
              </p>
            </div>
            <Badge
              variant={automation.status === "active" ? "success" : "pending"}
              className="shrink-0"
            >
              {automation.status === "active" ? "Active" : "Paused"}
            </Badge>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <dt className="text-[0.82rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Refresh
              </dt>
              <dd className="text-[1rem] font-medium tracking-[-0.015em] text-foreground">
                {AUTOMATION_REFRESH_MODE_LABELS[automation.refreshMode]}
              </dd>
            </div>
            <div className="space-y-2">
              <dt className="text-[0.82rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Target languages
              </dt>
              <dd className="text-[1rem] font-medium tracking-[-0.015em] text-foreground">
                {formatLanguageSummary(
                  automation.targetLanguageIds,
                  languageNamesByCoreId,
                )}
              </dd>
            </div>
            <div className="space-y-2">
              <dt className="text-[0.82rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Next run
              </dt>
              <dd className="text-[1rem] font-medium tracking-[-0.015em] text-foreground">
                {formatDateTime(automation.nextRunAt)}
              </dd>
            </div>
            <div className="space-y-2">
              <dt className="text-[0.82rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Last result
              </dt>
              <dd className="text-[1rem] font-medium tracking-[-0.015em] text-foreground">
                {automation.lastRunStatus ?? "n/a"}
              </dd>
            </div>
          </dl>

          <AutomationRunHistory runs={automation.runs} />

          <div className="flex justify-end">
            {automation.status === "active" ? (
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => onStatusChange(automation, "paused")}
              >
                <Pause className="size-4" aria-hidden="true" />
                Pause
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => onStatusChange(automation, "active")}
              >
                <Play className="size-4" aria-hidden="true" />
                Resume
              </Button>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}
