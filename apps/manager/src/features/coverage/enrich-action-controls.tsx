"use client"

import React from "react"
import { ArrowRight, RefreshCw, Rocket } from "lucide-react"

import type { EnrichFeedback } from "@/features/enrich-selection"

type EnrichActionControlsProps = {
  enrichActionReady: boolean
  enrichFeedback: EnrichFeedback | null
  isEnrichSubmitting: boolean
  languageSelectionRequired: boolean
  onCancel: () => void
  onEnrich: () => void | Promise<void>
}

export function EnrichActionControls({
  enrichActionReady,
  enrichFeedback,
  isEnrichSubmitting,
  languageSelectionRequired,
  onCancel,
  onEnrich,
}: EnrichActionControlsProps) {
  const actionDisabled = !enrichActionReady || isEnrichSubmitting

  return (
    <div className="translation-controls">
      <button
        type="button"
        className="translation-primary"
        disabled={actionDisabled}
        aria-busy={isEnrichSubmitting}
        title={
          languageSelectionRequired
            ? "Select at least one language before enriching."
            : undefined
        }
        onClick={() => {
          void onEnrich()
        }}
      >
        {isEnrichSubmitting ? (
          <RefreshCw className="icon is-spinning" aria-hidden="true" />
        ) : (
          <Rocket className="icon" aria-hidden="true" />
        )}
        {isEnrichSubmitting ? "Creating jobs..." : "Enrich Now"}
      </button>
      <button
        type="button"
        className="translation-secondary"
        onClick={onCancel}
        aria-label="Cancel and clear selection"
        title="Cancel and clear selection"
      >
        <svg
          className="icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="m15 9-6 6M9 9l6 6" />
        </svg>
      </button>
      {isEnrichSubmitting ? (
        <div className="translation-feedback translation-feedback--neutral">
          Submitting enrichment request...
        </div>
      ) : enrichFeedback ? (
        <div
          className={`translation-feedback translation-feedback--${enrichFeedback.tone}`}
        >
          {enrichFeedback.message}
          {enrichFeedback.action ? (
            <>
              {" "}
              <a
                className="translation-feedback-action"
                href={enrichFeedback.action.href}
              >
                {enrichFeedback.action.label}
                <ArrowRight className="icon" aria-hidden="true" />
              </a>
            </>
          ) : null}
        </div>
      ) : languageSelectionRequired ? (
        <div className="translation-feedback translation-feedback--neutral">
          Select at least one language to enable enrichment.
        </div>
      ) : null}
    </div>
  )
}
