import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SubtitleLabDashboard } from "./subtitle-lab-dashboard"
import type {
  SubtitleLabCorpusVersion,
  SubtitleLabReferenceIssue,
  SubtitleLabRunSummary,
} from "./subtitle-lab-operator-types"

const corpus: SubtitleLabCorpusVersion = {
  id: "corpus-1",
  status: "PROVISIONAL",
  identityDigest: "a".repeat(64),
  manifestDigest: "b".repeat(64),
  lockDigest: "c".repeat(64),
  authority: "provisional",
  certification: {},
  supersedesVersionId: null,
  approvedById: null,
  approvedAt: null,
  createdAt: "2026-08-20T10:00:00.000Z",
  cells: [
    {
      id: "cell-es",
      caseId: "jesus-film-1",
      collectionKey: "Jesus Film",
      videoId: "video-1",
      editionIdentity: "edition-1",
      sourceLanguageId: "language-en",
      sourceLanguageSlug: "english",
      sourceTrackIdentity: "source-track",
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
      referenceTrackIdentity: "reference-track",
      sourceSnapshotDigest: "d".repeat(64),
      sourceSnapshotRawDigest: "e".repeat(64),
      sourceSnapshotClippedDigest: "f".repeat(64),
      referenceSnapshotDigest: "1".repeat(64),
      referenceSnapshotRawDigest: "2".repeat(64),
      referenceSnapshotClippedDigest: "3".repeat(64),
      metadata: {},
    },
  ],
}

const runs: SubtitleLabRunSummary[] = [
  {
    id: "run-1",
    status: "PARTIAL",
    requestedProvider: "openrouter",
    requestedModel: "google/gemini-2.5-flash",
    promptPolicyId: "subtitle-enrichment-production-v1",
    codeRevision: "revision-1",
    cellCount: 1,
    createdAt: "2026-08-20T11:00:00.000Z",
    terminalAt: "2026-08-20T11:05:00.000Z",
  },
]

const issues: SubtitleLabReferenceIssue[] = [
  {
    id: "issue-1",
    status: "OPEN",
    corpusCellId: "cell-es",
    reviewId: "review-1",
    caseId: "jesus-film-1",
    collectionKey: "Jesus Film",
    targetLanguageId: "language-es",
    targetLanguageSlug: "spanish",
    dispositionReason: null,
    correctedCorpusVersionId: null,
    createdAt: "2026-08-20T12:00:00.000Z",
  },
]

describe("SubtitleLabDashboard", () => {
  it("renders corpus proof, bounded launch controls, immutable runs, and human queues", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SubtitleLabDashboard, {
        initialCorpus: corpus,
        initialReferenceIssues: issues,
        initialRuns: runs,
      }),
    )

    expect(markup).toContain("Subtitle Quality Lab")
    expect(markup).toContain("Development benchmark")
    expect(markup).toContain("PROVISIONAL")
    expect(markup).toContain(corpus.manifestDigest)
    expect(markup).toContain(corpus.lockDigest)
    expect(markup).toContain("Import frozen corpus")
    expect(markup).toContain("Certify exact snapshots")
    expect(markup).toContain('max="3"')
    expect(markup).toContain('min="60"')
    expect(markup).toContain('max="600"')
    expect(markup).toContain("google/gemini-2.5-flash")
    expect(markup).toContain("Partial")
    expect(markup).toContain("Open reference issues")
    expect(markup).toContain("Assign reviewers from run detail")
    expect(markup).toContain("Compare immutable reports")
    expect(markup).toContain("One declared changed axis")
    expect(markup).not.toMatch(/>\s*(Publish|Activate prompt|Deploy)\s*</i)
  })
})
