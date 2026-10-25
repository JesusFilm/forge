"use client"

import React from "react"
import { ChevronDown, ExternalLink, type LucideIcon } from "lucide-react"
import type { StepStatus, WorkflowStepName } from "@/types/job"

type CollapsibleStepArtifact = {
  key: string
  label: string
  url: string
}

type CollapsibleStepRowBaseProps = {
  stepName: WorkflowStepName
  title: string
  description: string
  icon: LucideIcon
  duration: string
  artifacts: CollapsibleStepArtifact[]
  status: StepStatus
  statusIcon: React.ReactNode
  retries: number
  inlineSummary?: React.ReactNode
  inlineError?: string | null
}

type CollapsibleStepRowStaticProps = {
  isExpanded?: false
  onToggle?: undefined
  detailContent?: undefined
  detailRowClassName?: undefined
}

type CollapsibleStepRowExpandableProps = {
  isExpanded: boolean
  onToggle: () => void
  detailContent: React.ReactNode
  detailRowClassName?: string
}

type CollapsibleStepRowProps = CollapsibleStepRowBaseProps &
  (CollapsibleStepRowStaticProps | CollapsibleStepRowExpandableProps)

export function CollapsibleStepRow({
  stepName,
  title,
  description,
  icon: StepIcon,
  duration,
  artifacts,
  status,
  statusIcon,
  retries,
  inlineSummary,
  inlineError,
  isExpanded = false,
  onToggle,
  detailContent,
  detailRowClassName,
}: CollapsibleStepRowProps) {
  const isExpandable = detailContent != null && onToggle != null
  const handleToggle = onToggle ?? (() => {})
  const detailRowId = React.useId()
  const disclosureLabel = `${isExpanded ? "Collapse" : "Expand"} ${title} details`

  return (
    <React.Fragment key={stepName}>
      <tr
        className={
          [
            inlineError ? "jobs-row-with-issue" : null,
            isExpandable ? "jobs-clickable-row" : null,
            isExpanded ? "jobs-step-row-expanded" : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onClick={isExpandable ? handleToggle : undefined}
      >
        <td>
          <span className="jobs-step-label">
            <StepIcon
              className="jobs-step-label-icon"
              aria-hidden="true"
              size={24}
            />
            <span className="jobs-step-label-text">
              <span className="jobs-step-label-title">{title}</span>
              <span className="jobs-step-label-subtitle">{description}</span>
              {inlineSummary ? (
                <span className="jobs-step-inline-summary">
                  {inlineSummary}
                </span>
              ) : null}
            </span>
          </span>
        </td>
        <td>{duration}</td>
        <td>
          {artifacts.length === 0 ? (
            <span className="jobs-no-issue">-</span>
          ) : (
            <div className="jobs-step-artifacts">
              {artifacts.map((artifact) => (
                <a
                  key={`${stepName}-${artifact.key}`}
                  href={artifact.url}
                  target="_blank"
                  rel="noreferrer"
                  className="jobs-step-artifact-link"
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Open ${artifact.label} in a new tab`}
                  title={`Open ${artifact.label} in a new tab`}
                >
                  <ExternalLink
                    className="jobs-step-artifact-icon"
                    aria-hidden="true"
                    size={14}
                  />
                  <span className="jobs-step-artifact-label">
                    {artifact.label}
                  </span>
                </a>
              ))}
            </div>
          )}
        </td>
        <td>
          <div className="jobs-step-status-cell">
            <span
              className={`jobs-step-status-icon jobs-step-status-icon-${status}`}
              role="img"
              aria-label={status}
              title={status}
            >
              {statusIcon}
            </span>
            {retries > 0 ? (
              <span
                className="jobs-step-retry-pill"
                title={`${retries} retries`}
              >
                x {retries}
              </span>
            ) : null}
            {isExpandable ? (
              <button
                type="button"
                className={`jobs-step-expand-button ${
                  isExpanded ? "jobs-step-expand-icon-open" : ""
                }`}
                onClick={(event) => {
                  event.stopPropagation()
                  handleToggle()
                }}
                aria-expanded={isExpanded}
                aria-controls={detailRowId}
                aria-label={disclosureLabel}
                title={disclosureLabel}
              >
                <ChevronDown size={18} />
              </button>
            ) : (
              <span className="jobs-step-expand-spacer" aria-hidden="true" />
            )}
          </div>
        </td>
      </tr>
      {inlineError ? (
        <tr className="jobs-issue-row">
          <td colSpan={4}>
            <p className="jobs-error-text" title={inlineError}>
              {inlineError}
            </p>
          </td>
        </tr>
      ) : null}
      {isExpandable && isExpanded ? (
        <tr
          id={detailRowId}
          className={[
            "jobs-step-detail-row",
            "jobs-collapsible-step-detail-row",
            detailRowClassName,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <td colSpan={4}>
            <div className="jobs-collapsible-step-detail-content">
              {detailContent}
            </div>
          </td>
        </tr>
      ) : null}
    </React.Fragment>
  )
}
