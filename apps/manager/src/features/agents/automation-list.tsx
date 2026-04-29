"use client"

import { Pause, Play } from "lucide-react"
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
    return <p className="small agents-empty">{emptyMessage}</p>
  }

  return (
    <div className="agents-list">
      {automations.map((automation) => (
        <article key={automation.documentId} className="agents-row">
          <div className="agents-row-main">
            <div>
              <div className="agents-row-title">{automation.name}</div>
              <div className="agents-row-meta">
                {AUTOMATION_TEMPLATE_LABELS[automation.template]} ·{" "}
                {automation.scheduleSummary ?? "Schedule pending"} · cap{" "}
                {automation.maxVideosPerRun}
              </div>
            </div>
            <span className={`badge ${automation.status}`}>
              {automation.status === "active" ? "Active" : "Paused"}
            </span>
          </div>
          <dl className="agents-detail-grid">
            <div>
              <dt>Refresh</dt>
              <dd>{AUTOMATION_REFRESH_MODE_LABELS[automation.refreshMode]}</dd>
            </div>
            <div>
              <dt>Target languages</dt>
              <dd>
                {formatLanguageSummary(
                  automation.targetLanguageIds,
                  languageNamesByCoreId,
                )}
              </dd>
            </div>
            <div>
              <dt>Next run</dt>
              <dd>{formatDateTime(automation.nextRunAt)}</dd>
            </div>
            <div>
              <dt>Last result</dt>
              <dd>{automation.lastRunStatus ?? "n/a"}</dd>
            </div>
          </dl>
          <AutomationRunHistory runs={automation.runs} />
          <div className="agents-row-actions">
            {automation.status === "active" ? (
              <button
                type="button"
                className="jobs-primary-button agents-secondary-button"
                onClick={() => onStatusChange(automation, "paused")}
              >
                <Pause className="icon" aria-hidden="true" />
                Pause
              </button>
            ) : (
              <button
                type="button"
                className="jobs-primary-button"
                onClick={() => onStatusChange(automation, "active")}
              >
                <Play className="icon" aria-hidden="true" />
                Resume
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}
