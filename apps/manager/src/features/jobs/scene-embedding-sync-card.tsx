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
    report && report.status !== "indexed" && report.status !== "skipped_empty",
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
    case "indexed":
      return "Scene embeddings were indexed into CMS."
    case "skipped_empty":
      return "Scene analysis completed, but no indexable scene descriptions were produced."
    case "unsupported":
      return "This workflow run does not have a CMS video target for scene embedding sync."
    case "failed":
      if (report.reason === "video_not_found") {
        return "The target CMS video could not be found when scene sync ran."
      }
      if (report.reason === "unpublished_video") {
        return "Only published CMS videos are indexed in v1, so draft-only content was not synced."
      }
      if (report.reason === "artifact_missing") {
        return "The scene analysis artifact could not be read back for scene embedding sync."
      }
      return "Scene analysis succeeded, but the scene embedding sync subphase did not."
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
          Scene Embeddings CMS Sync
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
            CMS Scene Vector Index
          </h4>
          <SummaryRow
            label="Resolved video ID"
            value={String(checkedReport.resolvedVideoId ?? "–")}
          />
          <SummaryRow
            label="Rows indexed"
            value={String(checkedReport.indexedSceneCount ?? 0)}
          />
          <SummaryRow label="Model" value={checkedReport.model ?? "–"} />
          <SummaryRow
            label="Embedding tokens"
            value={String(checkedReport.embeddingTokens ?? 0)}
          />
        </div>
      </div>
    </section>
  )
}
