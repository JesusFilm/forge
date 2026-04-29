"use client"

import { useEffect, useMemo, useState } from "react"
import { Bot, RefreshCw, X } from "lucide-react"
import { createPortal } from "react-dom"
import { apiFetch } from "@/lib/api-fetch"
import type {
  AutomationDraft,
  EnrichmentAutomation,
} from "./automation-contract"
import { AutomationForm, type LanguageOption } from "./automation-form"
import { AutomationList } from "./automation-list"

export function AgentsPage({
  initialAutomations,
  languageOptions,
}: {
  initialAutomations: EnrichmentAutomation[]
  languageOptions: LanguageOption[]
}) {
  const [automations, setAutomations] = useState(initialAutomations)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const modalRoot = typeof document === "undefined" ? null : document.body

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

  useEffect(() => {
    document.body.classList.toggle("studio-modal-open", isCreateModalOpen)
    return () => {
      document.body.classList.remove("studio-modal-open")
    }
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

  return (
    <section className="collection-card jobs-card agents-card">
      <header className="studio-page-intro studio-page-intro--with-actions">
        <div className="studio-page-intro-copy">
          <span className="studio-page-eyebrow">Agent automations</span>
          <h1>Agents</h1>
          <p>
            Schedule recurring enrichment runs for eligible videos and language
            coverage.
          </p>
        </div>
        <div className="studio-page-intro-actions agents-header-actions">
          <button
            type="button"
            className="collection-cache-clear jobs-refresh-link"
            onClick={() => {
              void refreshAutomations()
            }}
          >
            <RefreshCw className="icon" aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            className="jobs-primary-button"
            onClick={() => setIsCreateModalOpen(true)}
          >
            <Bot className="icon" aria-hidden="true" />
            New automation
          </button>
        </div>
      </header>

      {modalRoot && isCreateModalOpen
        ? createPortal(
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
                    aria-label="Close modal"
                    title="Close modal"
                    onClick={() => setIsCreateModalOpen(false)}
                  >
                    <X className="icon" aria-hidden="true" />
                  </button>
                </div>
                <AutomationForm
                  languageOptions={languageOptions}
                  onCreate={createAutomation}
                  onCancel={() => setIsCreateModalOpen(false)}
                  onCreated={() => setIsCreateModalOpen(false)}
                />
              </section>
            </div>,
            modalRoot,
          )
        : null}

      {statusMessage && (
        <p className="jobs-status jobs-status-success">{statusMessage}</p>
      )}

      <section className="agents-section">
        <h3 className="jobs-day-heading">Active</h3>
        <AutomationList
          automations={activeAutomations}
          emptyMessage="No active automations."
          languageNamesByCoreId={languageNamesByCoreId}
          onStatusChange={updateStatus}
        />
      </section>

      <section className="agents-section">
        <h3 className="jobs-day-heading">Paused</h3>
        <AutomationList
          automations={pausedAutomations}
          emptyMessage="No paused automations."
          languageNamesByCoreId={languageNamesByCoreId}
          onStatusChange={updateStatus}
        />
      </section>
    </section>
  )
}
