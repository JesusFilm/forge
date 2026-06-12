"use client"

// Shorts Studio steps card — reuses the jobs feature's CollapsibleStepRow +
// StepStatusGlyph so shorts steps render exactly like every other job's
// steps (plan "UI": reuse, no new design system).

import React from "react"
import {
  Clapperboard,
  CloudUpload,
  Scissors,
  type LucideIcon,
} from "lucide-react"
import { CollapsibleStepRow } from "@/features/jobs/collapsible-step-row"
import {
  formatDuration,
  STEP_DESCRIPTION_BY_NAME,
  StepStatusGlyph,
} from "@/features/jobs/live-job-steps-table"
import { getArtifactsForStep } from "@/lib/job-artifacts"
import { formatStepName } from "@/lib/workflow-steps"
import type { JobRecord, WorkflowStepName } from "@/types/job"

const SHORTS_STEP_ICONS: Partial<Record<WorkflowStepName, LucideIcon>> = {
  shorts_prepare: Scissors,
  shorts_render: Clapperboard,
  shorts_mux_output: CloudUpload,
}

export function ShortsStepsTable({ job }: { job: JobRecord }) {
  return (
    <section className="collection-card jobs-card">
      <div className="jobs-card-header">
        <h3 className="jobs-section-title">Steps</h3>
      </div>
      <div className="jobs-table-wrap">
        <table className="table jobs-table jobs-detail-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Duration</th>
              <th>Artifacts</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {job.steps.map((step) => {
              // Live worker progress is mirrored into the running step's
              // details by the workflow (throttled onProgress).
              const progress =
                step.status === "running" && step.details?.progress != null
                  ? Math.round(step.details.progress * 100)
                  : null

              return (
                <CollapsibleStepRow
                  key={step.name}
                  stepName={step.name}
                  title={formatStepName(step.name)}
                  description={STEP_DESCRIPTION_BY_NAME[step.name]}
                  icon={SHORTS_STEP_ICONS[step.name] ?? Clapperboard}
                  duration={formatDuration(step.startedAt, step.finishedAt)}
                  artifacts={getArtifactsForStep(
                    step.name,
                    job.id,
                    job.artifacts,
                  )}
                  status={step.status}
                  statusIcon={<StepStatusGlyph status={step.status} />}
                  retries={step.retries}
                  inlineSummary={
                    progress !== null ? (
                      <span className="jobs-step-inline-summary-note">
                        {progress}%
                        {step.details?.message
                          ? ` · ${step.details.message}`
                          : ""}
                      </span>
                    ) : null
                  }
                  inlineError={step.error ?? null}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
