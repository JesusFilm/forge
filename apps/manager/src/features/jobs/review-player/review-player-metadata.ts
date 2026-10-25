import type { JobRecord } from "@/types/job"
import type { ReviewMetadataValue } from "./review-player-types"

export type ReviewMetadataDisplayField =
  | {
      kind: "text"
      label: string
      value?: string
    }
  | {
      kind: "list"
      label: string
      values: string[]
    }

type BuildReviewMetadataFieldsInput = {
  job: Pick<JobRecord, "sourceCollectionTitle" | "sourceMediaTitle">
  metadata: ReviewMetadataValue
}

function normalizeText(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeList(values?: string[]): string[] {
  return (values ?? [])
    .map((value) => normalizeText(value))
    .filter((value): value is string => value != null)
}

export function buildReviewMetadataFields({
  job,
  metadata,
}: BuildReviewMetadataFieldsInput): ReviewMetadataDisplayField[] {
  return [
    {
      kind: "text",
      label: "Title",
      value: normalizeText(metadata.title),
    },
    {
      kind: "text",
      label: "Description",
      value: normalizeText(metadata.description),
    },
    {
      kind: "text",
      label: "Language",
      value: normalizeText(metadata.language),
    },
    {
      kind: "text",
      label: "Collections",
      value: normalizeText(job.sourceCollectionTitle),
    },
    {
      kind: "text",
      label: "Source media",
      value: normalizeText(job.sourceMediaTitle),
    },
    {
      kind: "list",
      label: "Topics",
      values: normalizeList(metadata.topics),
    },
    {
      kind: "list",
      label: "Speakers",
      values: normalizeList(metadata.speakers),
    },
    {
      kind: "list",
      label: "Tags",
      values: normalizeList(metadata.tags),
    },
  ]
}
