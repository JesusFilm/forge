"use client"

import React from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { getSceneEmbeddingSyncReport } from "@/lib/scene-embedding-sync-report"
import type { JobRecord, SceneEmbeddingSyncReport } from "@/types/job"

type SceneEmbeddingSyncCardProps = {
  job: JobRecord
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/70 py-3 last:border-b-0 last:pb-0 first:pt-0">
      <span className="text-[0.85rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="max-w-[14rem] text-right text-[0.98rem] leading-6 text-foreground">
        {value}
      </span>
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
    <Card className="rounded-[1.5rem] border-dashed bg-card shadow-none">
      <CardHeader className="pb-5">
        <h4 className="text-[1.1rem] font-semibold tracking-[-0.02em] text-foreground">
          Scene Embeddings CMS Sync
        </h4>
        <p className="text-[0.98rem] leading-7 text-muted-foreground">
          {getSceneEmbeddingSyncExplanation(checkedReport)}
        </p>
      </CardHeader>

      <CardContent className="grid gap-4 pt-0 md:grid-cols-2">
        <div className="rounded-[1.4rem] border border-border/70 bg-secondary/20 p-5">
          <h4 className="mb-4 text-[1rem] font-semibold tracking-[-0.02em] text-foreground">
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

        <div className="rounded-[1.4rem] border border-border/70 bg-secondary/20 p-5">
          <h4 className="mb-4 text-[1rem] font-semibold tracking-[-0.02em] text-foreground">
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
      </CardContent>
    </Card>
  )
}
