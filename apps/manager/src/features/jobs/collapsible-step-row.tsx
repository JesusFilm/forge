"use client"

import React from "react"
import { ChevronDown, ExternalLink, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
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
  const statusToneClasses: Record<StepStatus, string> = {
    pending: "bg-secondary text-muted-foreground",
    running: "bg-[color:rgba(37,99,235,0.12)] text-[color:#2563eb]",
    completed: "bg-[color:rgba(29,185,84,0.12)] text-[color:#15803d]",
    failed: "bg-[color:rgba(239,51,64,0.12)] text-[color:var(--ds-brand-red)]",
    skipped: "bg-[color:rgba(8,8,8,0.08)] text-muted-foreground",
  }

  return (
    <React.Fragment key={stepName}>
      <tr
        className={cn(
          "border-t border-border/70 align-top transition-colors",
          isExpandable && "cursor-pointer hover:bg-secondary/25",
          isExpanded && "bg-secondary/20",
          inlineError && "bg-[color:rgba(239,51,64,0.04)]",
        )}
        onClick={isExpandable ? handleToggle : undefined}
      >
        <td className="py-5 pr-5">
          <span className="flex items-start gap-4">
            <StepIcon
              className="mt-0.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
              size={20}
            />
            <span className="min-w-0">
              <span className="block text-[1rem] font-semibold tracking-[-0.02em] text-foreground">
                {title}
              </span>
              <span className="mt-1 block text-[0.95rem] leading-6 text-muted-foreground">
                {description}
              </span>
              {inlineSummary ? (
                <span className="mt-2 block text-[0.9rem] leading-6 text-muted-foreground">
                  {inlineSummary}
                </span>
              ) : null}
            </span>
          </span>
        </td>
        <td className="py-5 pr-5 text-[0.95rem] leading-6 text-muted-foreground">
          {duration}
        </td>
        <td className="py-5 pr-5">
          {artifacts.length === 0 ? (
            <span className="text-[0.95rem] leading-6 text-muted-foreground">
              -
            </span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {artifacts.map((artifact) => (
                <a
                  key={`${stepName}-${artifact.key}`}
                  href={artifact.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[0.82rem] font-medium text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.04)] transition-colors hover:bg-accent"
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Open ${artifact.label} in a new tab`}
                  title={`Open ${artifact.label} in a new tab`}
                >
                  <ExternalLink
                    className="text-muted-foreground"
                    aria-hidden="true"
                    size={14}
                  />
                  <span>{artifact.label}</span>
                </a>
              ))}
            </div>
          )}
        </td>
        <td className="py-5">
          <div className="flex items-center justify-end gap-2">
            <span
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                statusToneClasses[status],
              )}
              role="img"
              aria-label={status}
              title={status}
            >
              {statusIcon}
            </span>
            {retries > 0 ? (
              <Badge
                variant="outline"
                className="px-2.5 py-1"
                title={`${retries} retries`}
              >
                x {retries}
              </Badge>
            ) : null}
            {isExpandable ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 rounded-full"
                onClick={(event) => {
                  event.stopPropagation()
                  handleToggle()
                }}
                aria-expanded={isExpanded}
                aria-controls={detailRowId}
                aria-label={disclosureLabel}
                title={disclosureLabel}
              >
                <ChevronDown
                  size={18}
                  className={cn(
                    "transition-transform duration-200",
                    isExpanded && "rotate-180",
                  )}
                />
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
      {inlineError ? (
        <tr className="border-t border-border/50">
          <td colSpan={4}>
            <p
              className="rounded-[18px] border border-[color:rgba(239,51,64,0.16)] bg-[color:rgba(239,51,64,0.08)] px-4 py-3 text-[0.95rem] leading-6 text-[color:var(--ds-brand-red)]"
              title={inlineError}
            >
              {inlineError}
            </p>
          </td>
        </tr>
      ) : null}
      {isExpandable && isExpanded ? (
        <tr id={detailRowId} className="border-t border-border/60">
          <td colSpan={4}>
            <div
              className={cn(
                "space-y-4 rounded-[22px] border border-border/70 bg-secondary/25 p-5 md:p-6",
                detailRowClassName,
              )}
            >
              {detailContent}
            </div>
          </td>
        </tr>
      ) : null}
    </React.Fragment>
  )
}
