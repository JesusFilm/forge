"use client"

import { useEffect, useMemo, useState } from "react"
import { Bot, RefreshCw } from "lucide-react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import {
  ModalBackdrop,
  ModalCloseButton,
  ModalHeader,
  ModalPanel,
} from "@/components/ui/modal-shell"
import {
  PageDescription,
  PageEyebrow,
  PageIntro,
  PageTitle,
} from "@/components/ui/page-intro"
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
    <section className="space-y-10">
      <PageIntro
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => {
                void refreshAutomations()
              }}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={() => setIsCreateModalOpen(true)}
            >
              <Bot className="size-4" aria-hidden="true" />
              New automation
            </Button>
          </>
        }
      >
        <PageEyebrow>Agent automations</PageEyebrow>
        <PageTitle className="text-[clamp(2.5rem,5vw,3.4rem)]">
          Agents
        </PageTitle>
        <PageDescription className="max-w-4xl">
          Schedule recurring enrichment runs for eligible videos and language
          coverage.
        </PageDescription>
      </PageIntro>

      {modalRoot && isCreateModalOpen
        ? createPortal(
            <ModalBackdrop
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setIsCreateModalOpen(false)
                }
              }}
            >
              <ModalPanel
                className="mx-auto w-full max-w-[58rem]"
                role="dialog"
                aria-modal="true"
                aria-labelledby="agents-create-title"
              >
                <ModalHeader>
                  <div className="space-y-2">
                    <h3
                      id="agents-create-title"
                      className="text-[clamp(2rem,4vw,2.75rem)] font-semibold tracking-[-0.04em] text-foreground"
                    >
                      New automation
                    </h3>
                    <p className="max-w-[32rem] text-[1rem] leading-7 text-muted-foreground sm:text-[1.125rem]">
                      Create recurring enrichment work for eligible videos.
                    </p>
                  </div>
                  <ModalCloseButton
                    onClick={() => setIsCreateModalOpen(false)}
                  />
                </ModalHeader>
                <AutomationForm
                  languageOptions={languageOptions}
                  onCreate={createAutomation}
                  onCancel={() => setIsCreateModalOpen(false)}
                  onCreated={() => setIsCreateModalOpen(false)}
                />
              </ModalPanel>
            </ModalBackdrop>,
            modalRoot,
          )
        : null}

      {statusMessage && (
        <p className="rounded-[1rem] border border-[rgba(29,185,84,0.28)] bg-[rgba(29,185,84,0.10)] px-3.5 py-2.5 text-[14px] font-medium text-[#15803d]">
          {statusMessage}
        </p>
      )}

      <section className="space-y-4 border-t border-border/70 pt-8">
        <h3 className="text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Active
        </h3>
        <AutomationList
          automations={activeAutomations}
          emptyMessage="No active automations."
          languageNamesByCoreId={languageNamesByCoreId}
          onStatusChange={updateStatus}
        />
      </section>

      <section className="space-y-4 border-t border-border/70 pt-8">
        <h3 className="text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Paused
        </h3>
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
