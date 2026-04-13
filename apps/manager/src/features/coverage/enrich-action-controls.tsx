"use client"

import React from "react"

import type { EnrichFeedback } from "@/features/enrich-selection"
import { buildDashboardHrefWithReportQuery } from "@/features/nav/dashboard-nav-model"

type EnrichActionControlsProps = {
  enrichActionReady: boolean
  enrichFeedback: EnrichFeedback | null
  isEnrichSubmitting: boolean
  languageSelectionRequired: boolean
  onCancel: () => void
  onEnrich: () => void | Promise<void>
  reportQuery?: string
}

export function EnrichActionControls({
  enrichActionReady,
  enrichFeedback,
  isEnrichSubmitting,
  languageSelectionRequired,
  onCancel,
  onEnrich,
  reportQuery = "",
}: EnrichActionControlsProps) {
  const actionDisabled = !enrichActionReady || isEnrichSubmitting
  const feedbackActionHref = enrichFeedback?.action
    ? buildDashboardHrefWithReportQuery(enrichFeedback.action.href, reportQuery)
    : null

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
        <svg
          className={isEnrichSubmitting ? "icon is-spinning" : "icon"}
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />
        </svg>
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
                href={feedbackActionHref ?? enrichFeedback.action.href}
              >
                {enrichFeedback.action.label}
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
