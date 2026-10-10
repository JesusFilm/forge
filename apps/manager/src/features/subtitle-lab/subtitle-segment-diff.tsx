"use client"

import type { AlignedSubtitleSegment } from "./subtitle-review-presenter"
import { formatSubtitleTime } from "./subtitle-review-presenter"

type DiffToken = { text: string; changed: boolean }
type DiffOperation = { kind: "equal" | "insert" | "delete"; text: string }

const MAX_LCS_TOKENS = 1_024

export type SubtitleTextDiff = {
  left: DiffToken[]
  right: DiffToken[]
}

export function diffSubtitleText(
  leftText: string,
  rightText: string,
  locale?: string,
): SubtitleTextDiff {
  const operations = diffOperations(leftText, rightText, locale)

  return {
    left: operations
      .filter(({ kind }) => kind !== "insert")
      .map(({ kind, text }) => ({ text, changed: kind === "delete" })),
    right: operations
      .filter(({ kind }) => kind !== "delete")
      .map(({ kind, text }) => ({ text, changed: kind === "insert" })),
  }
}

export function SubtitleSegmentDiff({
  segment,
  locale,
  selected,
  mobileTrack,
  trackAProvenance,
  trackBProvenance,
  onSelect,
  onAddCorrection,
}: {
  segment: AlignedSubtitleSegment
  locale?: string
  selected: boolean
  mobileTrack: "source" | "A" | "B"
  trackAProvenance?: "human-reference" | "ai-candidate"
  trackBProvenance?: "human-reference" | "ai-candidate"
  onSelect: () => void
  onAddCorrection: (track: "A" | "B") => void
}) {
  const diff = diffSubtitleText(segment.trackAText, segment.trackBText, locale)
  const differenceLabels = [
    segment.lexicalDifference ? "Text differs" : null,
    segment.timingDifference ? "Timing differs" : null,
  ].filter(Boolean)

  return (
    <article
      className={`subtitle-review-segment${selected ? " is-selected" : ""}`}
      aria-current={selected ? "true" : undefined}
      data-mobile-track={mobileTrack}
    >
      <header className="subtitle-review-segment-header">
        <button
          type="button"
          className="subtitle-review-time-button"
          onClick={onSelect}
          aria-label={`Play segment from ${formatSubtitleTime(segment.startSeconds)} to ${formatSubtitleTime(segment.endSeconds)}`}
        >
          <span aria-hidden="true">▶</span>{" "}
          {formatSubtitleTime(segment.startSeconds)}–
          {formatSubtitleTime(segment.endSeconds)}
        </button>
        <div
          className="subtitle-review-difference-labels"
          aria-label={
            differenceLabels.length > 0
              ? differenceLabels.join(", ")
              : "No automatic differences detected"
          }
        >
          {differenceLabels.length > 0 ? (
            differenceLabels.map((label) => (
              <span key={label} className="subtitle-review-difference-label">
                <span aria-hidden="true">≠</span> {label}
              </span>
            ))
          ) : (
            <span className="subtitle-review-match-label">
              <span aria-hidden="true">=</span> Similar text and timing
            </span>
          )}
        </div>
      </header>

      <div className="subtitle-review-segment-grid">
        <SegmentColumn
          kind="source"
          label="Source context"
          emptyLabel="No overlapping source cue"
          empty={!segment.sourceText}
          mobileTrack={mobileTrack}
        >
          <bdi dir="auto" className="subtitle-review-caption-text">
            {segment.sourceText}
          </bdi>
        </SegmentColumn>
        <SegmentColumn
          kind="A"
          label="Track A"
          emptyLabel="No Track A cue in this window"
          empty={!segment.trackAText}
          mobileTrack={mobileTrack}
          provenance={trackAProvenance}
          onAddCorrection={() => onAddCorrection("A")}
        >
          <DiffText tokens={diff.left} />
        </SegmentColumn>
        <SegmentColumn
          kind="B"
          label="Track B"
          emptyLabel="No Track B cue in this window"
          empty={!segment.trackBText}
          mobileTrack={mobileTrack}
          provenance={trackBProvenance}
          onAddCorrection={() => onAddCorrection("B")}
        >
          <DiffText tokens={diff.right} />
        </SegmentColumn>
      </div>
    </article>
  )
}

function SegmentColumn({
  kind,
  label,
  emptyLabel,
  empty,
  mobileTrack,
  children,
  onAddCorrection,
  provenance,
}: {
  kind: "source" | "A" | "B"
  label: string
  emptyLabel: string
  empty: boolean
  mobileTrack: "source" | "A" | "B"
  children: React.ReactNode
  onAddCorrection?: () => void
  provenance?: "human-reference" | "ai-candidate"
}) {
  return (
    <section
      className={`subtitle-review-segment-column subtitle-review-segment-column--${kind.toLowerCase()}`}
      data-mobile-visible={mobileTrack === kind ? "true" : "false"}
      aria-label={label}
    >
      <div className="subtitle-review-segment-column-header">
        <strong>
          {label}
          {provenance
            ? ` · ${provenance === "human-reference" ? "Human reference" : "AI candidate"}`
            : ""}
        </strong>
        {onAddCorrection ? (
          <button
            type="button"
            className="subtitle-review-text-button"
            onClick={onAddCorrection}
            aria-label={`Add a correction for ${label}`}
          >
            Correct
          </button>
        ) : null}
      </div>
      {empty ? <span className="small">{emptyLabel}</span> : children}
    </section>
  )
}

function DiffText({ tokens }: { tokens: DiffToken[] }) {
  if (tokens.length === 0) return null
  return (
    <bdi dir="auto" className="subtitle-review-caption-text">
      {tokens.map((token, index) => (
        <span
          key={`${index}-${token.text}`}
          className={
            token.changed ? "subtitle-review-token-changed" : undefined
          }
        >
          {token.changed ? <span className="sr-only">Difference: </span> : null}
          {token.text}
        </span>
      ))}
    </bdi>
  )
}

function diffOperations(
  leftText: string,
  rightText: string,
  locale?: string,
): DiffOperation[] {
  if (leftText === rightText) {
    return leftText ? [{ kind: "equal", text: leftText }] : []
  }
  const left = segmentWords(leftText, locale)
  const right = segmentWords(rightText, locale)
  if (left.length > MAX_LCS_TOKENS || right.length > MAX_LCS_TOKENS) {
    return boundedGraphemeDiff(leftText, rightText, locale)
  }
  const rows = Array.from(
    { length: left.length + 1 },
    () => new Uint16Array(right.length + 1),
  )
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      rows[leftIndex]![rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? rows[leftIndex + 1]![rightIndex + 1]! + 1
          : Math.max(
              rows[leftIndex + 1]![rightIndex]!,
              rows[leftIndex]![rightIndex + 1]!,
            )
    }
  }

  const operations: DiffOperation[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length || rightIndex < right.length) {
    if (
      leftIndex < left.length &&
      rightIndex < right.length &&
      left[leftIndex] === right[rightIndex]
    ) {
      pushOperation(operations, "equal", left[leftIndex]!)
      leftIndex += 1
      rightIndex += 1
    } else if (
      rightIndex < right.length &&
      (leftIndex === left.length ||
        rows[leftIndex]![rightIndex + 1]! >= rows[leftIndex + 1]![rightIndex]!)
    ) {
      pushOperation(operations, "insert", right[rightIndex]!)
      rightIndex += 1
    } else {
      pushOperation(operations, "delete", left[leftIndex]!)
      leftIndex += 1
    }
  }
  return operations
}

function segmentWords(value: string, locale?: string): string[] {
  try {
    return Array.from(
      new Intl.Segmenter(safeLocale(locale), { granularity: "word" }).segment(
        value,
      ),
      ({ segment }) => segment,
    )
  } catch {
    return segmentGraphemes(value, locale)
  }
}

function segmentGraphemes(value: string, locale?: string): string[] {
  try {
    return Array.from(
      new Intl.Segmenter(safeLocale(locale), {
        granularity: "grapheme",
      }).segment(value),
      ({ segment }) => segment,
    )
  } catch {
    return value ? [value] : []
  }
}

function safeLocale(locale?: string): string | undefined {
  if (!locale) return undefined
  try {
    return Intl.getCanonicalLocales(locale)[0]
  } catch {
    return undefined
  }
}

function boundedGraphemeDiff(
  leftText: string,
  rightText: string,
  locale?: string,
): DiffOperation[] {
  const left = segmentGraphemes(leftText, locale)
  const right = segmentGraphemes(rightText, locale)
  let prefix = 0
  while (prefix < left.length && left[prefix] === right[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const operations: DiffOperation[] = []
  pushOperation(operations, "equal", left.slice(0, prefix).join(""))
  pushOperation(
    operations,
    "delete",
    left.slice(prefix, left.length - suffix).join(""),
  )
  pushOperation(
    operations,
    "insert",
    right.slice(prefix, right.length - suffix).join(""),
  )
  if (suffix > 0) {
    pushOperation(
      operations,
      "equal",
      left.slice(left.length - suffix).join(""),
    )
  }
  return operations
}

function pushOperation(
  operations: DiffOperation[],
  kind: DiffOperation["kind"],
  text: string,
) {
  if (!text) return
  const previous = operations.at(-1)
  if (previous?.kind === kind) previous.text += text
  else operations.push({ kind, text })
}
