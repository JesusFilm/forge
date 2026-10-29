"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Bot, RefreshCw, X } from "lucide-react"
import { createPortal } from "react-dom"
import { AutomationResponseError, requestAutomation } from "./automation-api"
import type {
  AutomationDraft,
  EnrichmentAutomation,
  EnrichmentAutomationRun,
} from "./automation-contract"
import { AutomationForm, type LanguageOption } from "./automation-form"
import { AutomationList } from "./automation-list"
import { AutomationRunHistory } from "./automation-run-history"

export function AgentsPage({
  initialAutomations,
  languageOptions,
  requestedReport,
  reportError,
}: {
  initialAutomations: EnrichmentAutomation[]
  languageOptions: LanguageOption[]
  requestedReport?: {
    automationName: string
    run: EnrichmentAutomationRun
  } | null
  reportError?: string
}) {
  const [automations, setAutomations] = useState(initialAutomations)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [dryRunAutomationIds, setDryRunAutomationIds] = useState<Set<string>>(
    () => new Set(),
  )
  const modalRef = useRef<HTMLElement>(null)
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

    const previousFocus = document.activeElement
    modalRef.current?.querySelector<HTMLButtonElement>("button")?.focus()

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsCreateModalOpen(false)
      }
      if (event.key === "Tab") {
        const controls = modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        )
        const visible = Array.from(controls ?? []).filter(
          (element) => element.getClientRects().length > 0,
        )
        const first = visible[0]
        const last = visible.at(-1)
        if (!modalRef.current?.contains(document.activeElement)) {
          event.preventDefault()
          const nextFocus = event.shiftKey ? last : first
          nextFocus?.focus()
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }

    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("keydown", closeOnEscape)
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [isCreateModalOpen])

  useEffect(() => {
    document.body.classList.toggle("studio-modal-open", isCreateModalOpen)
    return () => {
      document.body.classList.remove("studio-modal-open")
    }
  }, [isCreateModalOpen])

  async function refreshAutomations() {
    const payload = await requestAutomation<{
      automations: EnrichmentAutomation[]
    }>(
      "/api/automations",
      { cache: "no-store" },
      "Automations did not refresh.",
    )
    setAutomations(payload.automations)
  }

  async function createAutomation(draft: AutomationDraft) {
    const payload = await requestAutomation<{
      automation?: EnrichmentAutomation
    }>(
      "/api/automations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      },
      "Automation was not created.",
    )
    if (!payload.automation) {
      throw new AutomationResponseError("Automation was not created.")
    }
    setAutomations((current) => [payload.automation!, ...current])
    setStatusMessage("Automation created.")
  }

  async function updateStatus(
    automation: EnrichmentAutomation,
    status: "active" | "paused",
  ) {
    try {
      const payload = await requestAutomation<{
        automation?: EnrichmentAutomation
      }>(
        `/api/automations/${encodeURIComponent(automation.documentId)}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
        "Automation status did not update.",
      )
      if (!payload.automation) {
        setStatusMessage("Automation status did not update.")
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
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Automation status did not update.",
      )
    }
  }

  async function runDryRun(automation: EnrichmentAutomation) {
    setDryRunAutomationIds((current) => {
      const next = new Set(current)
      next.add(automation.documentId)
      return next
    })
    setStatusMessage("Dry run started.")
    try {
      const payload = await requestAutomation<{
        automation?: EnrichmentAutomation
      }>(
        `/api/automations/${encodeURIComponent(automation.documentId)}/dry-run`,
        { method: "POST" },
        "Dry run did not start.",
      )
      if (!payload.automation) {
        setStatusMessage("Dry run did not start.")
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
              void refreshAutomations().catch((error: unknown) => {
                setStatusMessage(
                  error instanceof Error
                    ? error.message
                    : "Automations did not refresh.",
                )
              })
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
              className="design-system-eleven agents-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setIsCreateModalOpen(false)
                }
              }}
            >
              <section
                ref={modalRef}
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

      {reportError && (
        <p role="alert" className="jobs-status">
          {reportError}
        </p>
      )}
      {requestedReport && (
        <section
          className="agents-section"
          aria-labelledby="requested-automation-report"
        >
          <h2 id="requested-automation-report" className="jobs-day-heading">
            Run report: {requestedReport.automationName}
          </h2>
          <AutomationRunHistory runs={[requestedReport.run]} />
        </section>
      )}

      <section className="agents-section">
        <h3 className="jobs-day-heading">Active</h3>
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
        <h3 className="jobs-day-heading">Paused</h3>
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
