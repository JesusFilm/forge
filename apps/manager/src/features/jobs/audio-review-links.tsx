"use client"

import { ExternalLink } from "lucide-react"
import { buildJobArtifactHref } from "@/lib/job-artifacts"
import type { JobRecord } from "@/types/job"

type AudioReviewArtifactKey = "original-audio" | "cleaned-audio"

type AudioReviewLinksProps = {
  job: JobRecord
}

function getAudioReviewArtifactHref(
  job: JobRecord,
  key: AudioReviewArtifactKey,
): string | null {
  const artifact = job.artifacts[key]
  if (artifact?.kind !== "downloadable") {
    return null
  }

  return buildJobArtifactHref(job.id, key)
}

function AudioReviewItem({
  label,
  href,
}: {
  label: string
  href: string | null
}) {
  return (
    <div className="jobs-audio-review-item">
      <div className="small">{label}</div>
      {href ? (
        <a
          href={href}
          className="jobs-audio-review-link"
          target="_blank"
          rel="noreferrer"
          aria-label={`Listen to ${label.toLowerCase()} in a new tab`}
          title={`Listen to ${label.toLowerCase()} in a new tab`}
        >
          <ExternalLink size={14} aria-hidden="true" />
          <span>Listen</span>
        </a>
      ) : (
        <span className="jobs-no-issue">{label} not available yet.</span>
      )}
    </div>
  )
}

export function AudioReviewLinks({ job }: AudioReviewLinksProps) {
  const originalAudioHref = getAudioReviewArtifactHref(job, "original-audio")
  const cleanedAudioHref = getAudioReviewArtifactHref(job, "cleaned-audio")

  if (!originalAudioHref && !cleanedAudioHref) {
    return null
  }

  return (
    <section
      className="jobs-audio-review"
      aria-labelledby={`audio-review-${job.id}`}
    >
      <div className="jobs-audio-review-header">
        <h3 className="jobs-audio-review-title" id={`audio-review-${job.id}`}>
          Audio review
        </h3>
      </div>
      <div className="jobs-audio-review-grid">
        <AudioReviewItem label="Original audio" href={originalAudioHref} />
        <AudioReviewItem label="Cleaned audio" href={cleanedAudioHref} />
      </div>
    </section>
  )
}
