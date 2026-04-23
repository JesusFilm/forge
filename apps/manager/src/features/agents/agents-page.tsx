"use client"

import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/api-fetch"
import type {
  AutomationDraft,
  EnrichmentAutomation,
} from "./automation-contract"
import { AutomationForm, type LanguageOption } from "./automation-form"
import { AutomationList } from "./automation-list"
import { SharedAgentWorkbench } from "./shared-agent-workbench"
import type { SharedAgentCatalogItem } from "./shared-agent-contract"

export function AgentsPage({
  initialAutomations,
  languageOptions,
  sharedAgents,
}: {
  initialAutomations: EnrichmentAutomation[]
  languageOptions: LanguageOption[]
  sharedAgents: SharedAgentCatalogItem[]
}) {
  const [automations, setAutomations] = useState(initialAutomations)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [dryRunAutomationIds, setDryRunAutomationIds] = useState<Set<string>>(
    () => new Set(),
  )

  const activeAutomations = useMemo(
    () => automations.filter((automation) => automation.status === "active"),
    [automations],
  )
  const pausedAutomations = useMemo(
    () => automations.filter((automation) => automation.status === "paused"),
    [automations],
  )
  const languageNamesByCoreId = useMemo(
    () =>
      new Map(
        languageOptions.map((language) => [language.coreId, language.name]),
      ),
    [languageOptions],
  )

  useEffect(() => {
    if (!isCreateModalOpen) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsCreateModalOpen(false)
      }
    }

    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [isCreateModalOpen])

  async function refreshAutomations() {
    const response = await apiFetch("/api/automations", { cache: "no-store" })
    if (!response.ok) {
      throw new Error("Automations did not refresh.")
    }
    const payload = (await response.json()) as {
      automations: EnrichmentAutomation[]
    }
    setAutomations(payload.automations)
  }

  async function createAutomation(draft: AutomationDraft) {
    const response = await apiFetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })
    const payload = (await response.json()) as {
      automation?: EnrichmentAutomation
      error?: string
      details?: string[]
    }
    if (!response.ok || !payload.automation) {
      throw new Error(
        payload.details?.join(" ") ??
          payload.error ??
          "Automation was not created.",
      )
    }
    setAutomations((current) => [payload.automation!, ...current])
    setStatusMessage("Automation created.")
  }

  async function updateStatus(
    automation: EnrichmentAutomation,
    status: "active" | "paused",
  ) {
    const response = await apiFetch(
      `/api/automations/${encodeURIComponent(automation.documentId)}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    )
    const payload = (await response.json()) as {
      automation?: EnrichmentAutomation
      error?: string
    }
    if (!response.ok || !payload.automation) {
      setStatusMessage(payload.error ?? "Automation status did not update.")
      return
    }
    setAutomations((current) =>
      current.map((candidate) =>
        candidate.documentId === payload.automation!.documentId
          ? payload.automation!
          : candidate,
      ),
    )
    setStatusMessage(
      status === "active" ? "Automation resumed." : "Automation paused.",
    )
  }

  async function runDryRun(automation: EnrichmentAutomation) {
    setDryRunAutomationIds((current) => {
      const next = new Set(current)
      next.add(automation.documentId)
      return next
    })
    setStatusMessage("Dry run started.")
    try {
      const response = await apiFetch(
        `/api/automations/${encodeURIComponent(automation.documentId)}/dry-run`,
        { method: "POST" },
      )
      const payload = (await response.json()) as {
        automation?: EnrichmentAutomation
        error?: string
      }
      if (!response.ok || !payload.automation) {
        setStatusMessage(payload.error ?? "Dry run did not start.")
        return
      }
      setAutomations((current) =>
        current.map((candidate) =>
          candidate.documentId === payload.automation!.documentId
            ? payload.automation!
            : candidate,
        ),
      )
      setStatusMessage("Dry run report ready.")
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Dry run did not start.",
      )
    } finally {
      setDryRunAutomationIds((current) => {
        const next = new Set(current)
        next.delete(automation.documentId)
        return next
      })
    }
  }

  return (
    <section className="collection-card jobs-card agents-card">
      <div className="jobs-card-header">
        <div>
          <h2 className="jobs-card-title">Agents</h2>
          <p className="small agents-subtitle">
            Shared Mastra agents and recurring enrichment automations.
          </p>
        </div>
      </div>

      <section className="agents-section">
        <div className="agents-automation-header">
          <div>
            <h3 className="jobs-day-heading">Shared agents</h3>
            <p className="small agents-section-copy">
              Reusable specialists for translation, video upgrades, SEO, and
              marketing.
            </p>
          </div>
        </div>
        <SharedAgentWorkbench agents={sharedAgents} />
      </section>

      {isCreateModalOpen && (
        <div
          className="agents-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsCreateModalOpen(false)
            }
          }}
        >
          <section
            className="agents-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agents-create-title"
          >
            <div className="agents-modal-header">
              <div>
                <h3 id="agents-create-title" className="agents-modal-title">
                  New automation
                </h3>
                <p className="small agents-modal-subtitle">
                  Create recurring enrichment work for eligible videos.
                </p>
              </div>
              <button
                type="button"
                className="agents-modal-close"
                onClick={() => setIsCreateModalOpen(false)}
              >
                Close
              </button>
            </div>
            <AutomationForm
              languageOptions={languageOptions}
              onCreate={createAutomation}
              onCancel={() => setIsCreateModalOpen(false)}
              onCreated={() => setIsCreateModalOpen(false)}
            />
          </section>
        </div>
      )}

      {statusMessage && (
        <p className="jobs-status jobs-status-success">{statusMessage}</p>
      )}

      <section className="agents-section">
        <div className="agents-automation-header">
          <div>
            <h3 className="jobs-day-heading">Automations</h3>
            <p className="small agents-section-copy">
              Recurring enrichment work for eligible videos.
            </p>
          </div>
          <div className="agents-header-actions">
            <button
              type="button"
              className="collection-cache-clear jobs-refresh-link"
              onClick={() => {
                void refreshAutomations()
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              className="jobs-primary-button"
              onClick={() => setIsCreateModalOpen(true)}
            >
              New automation
            </button>
          </div>
        </div>
        <h4 className="jobs-day-heading agents-subheading">Active</h4>
        <AutomationList
          automations={activeAutomations}
          emptyMessage="No active automations."
          languageNamesByCoreId={languageNamesByCoreId}
          onStatusChange={updateStatus}
          onDryRun={runDryRun}
          dryRunAutomationIds={dryRunAutomationIds}
        />
      </section>

      <section className="agents-section">
        <h4 className="jobs-day-heading agents-subheading">Paused</h4>
        <AutomationList
          automations={pausedAutomations}
          emptyMessage="No paused automations."
          languageNamesByCoreId={languageNamesByCoreId}
          onStatusChange={updateStatus}
          onDryRun={runDryRun}
          dryRunAutomationIds={dryRunAutomationIds}
        />
      </section>
    </section>
  )
}
