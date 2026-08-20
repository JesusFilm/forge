"use client"

import React from "react"
import { ArrowRight, RefreshCw, Rocket } from "lucide-react"

import {
  ModalBackdrop,
  ModalCloseButton,
  ModalHeader,
  ModalPanel,
} from "@/components/ui/modal-shell"
import type { EnrichFeedback } from "@/features/enrich-selection"

type EnrichActionControlsProps = {
  actionLabel?: string
  enrichActionReady: boolean
  enrichFeedback: EnrichFeedback | null
  isEnrichSubmitting: boolean
  languageSelectionRequired: boolean
  onCancel: () => void
  onEnrich: () => void | Promise<void>
  submittingLabel?: string
}

export function EnrichActionControls({
  actionLabel = "Enrich Now",
  enrichActionReady,
  enrichFeedback,
  isEnrichSubmitting,
  languageSelectionRequired,
  onCancel,
  onEnrich,
  submittingLabel = "Creating jobs...",
}: EnrichActionControlsProps) {
  const [isDetailModalOpen, setIsDetailModalOpen] = React.useState(false)
  const detailTitleId = React.useId()
  const actionDisabled = !enrichActionReady || isEnrichSubmitting
  const feedbackDetails = enrichFeedback?.details ?? []
  const hasFeedbackDetails = feedbackDetails.length > 0

  React.useEffect(() => {
    if (!hasFeedbackDetails) {
      setIsDetailModalOpen(false)
    }
  }, [hasFeedbackDetails])

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
        {isEnrichSubmitting ? submittingLabel : actionLabel}
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
          {hasFeedbackDetails ? (
            <button
              type="button"
              className="translation-feedback-detail-trigger"
              aria-haspopup="dialog"
              aria-expanded={isDetailModalOpen}
              onClick={() => setIsDetailModalOpen(true)}
            >
              {enrichFeedback.message}
            </button>
          ) : (
            enrichFeedback.message
          )}
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
          {hasFeedbackDetails && isDetailModalOpen ? (
            <ModalBackdrop
              role="presentation"
              onClick={() => setIsDetailModalOpen(false)}
            >
              <ModalPanel
                role="dialog"
                aria-modal="true"
                aria-labelledby={detailTitleId}
                className="translation-error-modal"
                onClick={(event) => event.stopPropagation()}
              >
                <ModalHeader>
                  <div>
                    <p className="translation-error-modal-kicker">
                      Enrichment request
                    </p>
                    <h2 id={detailTitleId}>Error details</h2>
                  </div>
                  <ModalCloseButton
                    onClick={() => setIsDetailModalOpen(false)}
                  />
                </ModalHeader>
                <div className="translation-error-modal-body">
                  <p className="translation-error-modal-summary">
                    {enrichFeedback.message}
                  </p>
                  <ul className="translation-error-detail-list">
                    {feedbackDetails.map((detail, index) => (
                      <li
                        className="translation-error-detail-item"
                        key={`${detail.label}:${detail.message}:${index}`}
                      >
                        <span className="translation-error-detail-label">
                          {detail.label}
                        </span>
                        <span className="translation-error-detail-message">
                          {detail.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </ModalPanel>
            </ModalBackdrop>
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
