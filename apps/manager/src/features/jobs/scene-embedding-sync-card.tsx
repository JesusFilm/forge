"use client"

import React from "react"
import { getSceneEmbeddingSyncReport } from "@/lib/scene-embedding-sync-report"
import type { JobRecord, SceneEmbeddingSyncReport } from "@/types/job"

type SceneEmbeddingSyncCardProps = {
  job: JobRecord
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="jobs-embedding-sync-row">
      <span className="jobs-embedding-sync-label">{label}</span>
      <span className="jobs-embedding-sync-value">{value}</span>
    </div>
  )
}

export function hasSceneEmbeddingSyncIssue(
  report: SceneEmbeddingSyncReport | undefined,
): report is SceneEmbeddingSyncReport {
  return Boolean(
    report &&
    report.status !== "source_ready" &&
    report.status !== "skipped_empty",
  )
}

export function shouldExpandSceneEmbeddingSyncByDefault(
  report: SceneEmbeddingSyncReport | undefined,
): boolean {
  return hasSceneEmbeddingSyncIssue(report)
}

export function getSceneEmbeddingSyncExplanation(
  report: SceneEmbeddingSyncReport,
): string {
  switch (report.status) {
    case "source_ready":
      return "Scene analysis source data is ready for Admin and Mastra."
    case "skipped_empty":
      return "Scene analysis completed, but no indexable scene descriptions were produced."
    case "unsupported":
      return "This workflow run does not have enough scene source context."
    case "failed":
      if (report.reason === "video_not_found") {
        return "The target video could not be found when scene source preparation ran."
      }
      if (report.reason === "unpublished_video") {
        return "Only publishable videos are prepared for scene source handoff."
      }
      if (report.reason === "artifact_missing") {
        return "The scene analysis artifact could not be read back for source handoff."
      }
      return "Scene analysis succeeded, but the scene source handoff subphase did not."
  }
}

export function SceneEmbeddingSyncInlineDetails({
  job,
}: SceneEmbeddingSyncCardProps) {
  const report = getSceneEmbeddingSyncReport(job.artifacts)
  if (!hasSceneEmbeddingSyncIssue(report)) {
    return null
  }

  const checkedReport = report

  return (
    <section className="jobs-embedding-sync-inline">
      <div className="jobs-embedding-sync-inline-header">
        <h4 className="jobs-embedding-sync-inline-title">
          Scene Analysis Source
        </h4>
        <p className="jobs-embedding-sync-inline-summary">
          {getSceneEmbeddingSyncExplanation(checkedReport)}
        </p>
      </div>

      <div className="jobs-embedding-sync-grid">
        <div className="jobs-embedding-sync-panel">
          <h4 className="jobs-embedding-sync-heading">
            Generated Scene Analysis
          </h4>
          <SummaryRow
            label="Scenes generated"
            value={String(checkedReport.generatedSceneCount)}
          />
          <SummaryRow
            label="Scenes indexable"
            value={String(checkedReport.indexableSceneCount)}
          />
          <SummaryRow
            label="Skipped empties"
            value={String(checkedReport.skippedEmptySceneIndexes?.length ?? 0)}
          />
        </div>

        <div className="jobs-embedding-sync-panel">
          <h4 className="jobs-embedding-sync-heading">
            Mastra Scene Embedding Handoff
          </h4>
          <SummaryRow label="Status" value={checkedReport.status} />
          <SummaryRow
            label="Scenes ready"
            value={String(checkedReport.indexableSceneCount)}
          />
        </div>
      </div>
    </section>
  )
}
