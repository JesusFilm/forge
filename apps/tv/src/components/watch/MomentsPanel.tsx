// The "moments" section of the in-player menu — the ministry cousin of Prime
// Video's X-Ray. Three stacked blocks, each independently optional:
//
//   This moment  — the transcript span under the playhead (summary + the
//                  scripture the enrichment tied to it), only when the film's
//                  chunks carry genuine timecodes.
//   Scenes       — jump-to-scene rows, same timing requirement.
//   Questions    — the film-level study questions (untimed by nature).
//
// A film with no usable timing degrades to summaries-as-a-list; a film with
// no transcript at all shows questions only. An EMPTY panel is a bug, a
// missing section is not (plan constraint).
//
// PASSIVE, like SubtitleOverlay: this panel reads the playhead on its own
// interval while open and never touches control/auto-hide state. All decision
// rules live in src/lib/moments/* (jest-covered); this file is presentation.

import { useEffect, useMemo, useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { getApolloClient } from "../../lib/apolloClient"
import { scale } from "../../lib/scale"
import {
  findActiveMoment,
  type MomentsClassification,
  type TimedMoment,
} from "../../lib/moments/momentsModel"
import { loadVideoMoments } from "../../lib/moments/momentsSource"
import { parseBibleReferences } from "../../lib/moments/parseBibleReference"
import { useBibleVerses } from "../../hooks/useBibleVerses"
import { formatCitationReference } from "./detailsAdapters"
import { MENU_HEADING_HEIGHT } from "./watchMenuLayout"
import { WatchOptionRow } from "./WatchOptionRow"
import { watchMenuStyles } from "./watchMenuStyles"

/** Playhead poll while the panel is open. Coarser than SubtitleOverlay's
 *  100ms — a moment spans tens of seconds, so 500ms is invisible. */
const PLAYHEAD_POLL_MS = 500

type PanelData =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; classification: MomentsClassification }

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m)
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`
}

export function MomentsPanel({
  getCurrentTime,
  onSeekTo,
}: {
  /** Read the playhead; never causes side effects. */
  getCurrentTime: () => number
  /** Seek via the host's guarded path (seekTargetRef etc.). */
  onSeekTo: (seconds: number) => void
}) {
  const { video } = useWatchSession()
  const slug = video?.slug ?? null

  // ── Data: one bounded fetch per (film, open), served from the source's
  // process-lifetime cache on later opens. ──────────────────────────────────
  const [data, setData] = useState<PanelData>({ kind: "loading" })
  useEffect(() => {
    let cancelled = false
    if (slug == null) {
      setData({ kind: "unavailable" })
      return
    }
    setData({ kind: "loading" })
    void loadVideoMoments({ client: getApolloClient(), slug }).then(
      (result) => {
        if (cancelled) return
        setData(
          result.ok
            ? { kind: "ready", classification: result.classification }
            : { kind: "unavailable" },
        )
      },
      () => {
        if (!cancelled) setData({ kind: "unavailable" })
      },
    )
    return () => {
      cancelled = true
    }
  }, [slug])

  const classification: MomentsClassification =
    data.kind === "ready" ? data.classification : { kind: "empty" }
  const timeline: readonly TimedMoment[] =
    classification.kind === "timed" ? classification.timeline : []

  // ── Playhead follower (panel-open lifetime only). ─────────────────────────
  const [playhead, setPlayhead] = useState(() => getCurrentTime())
  const getCurrentTimeRef = useRef(getCurrentTime)
  getCurrentTimeRef.current = getCurrentTime
  useEffect(() => {
    if (timeline.length === 0) return
    const id = setInterval(() => {
      setPlayhead(getCurrentTimeRef.current())
    }, PLAYHEAD_POLL_MS)
    return () => clearInterval(id)
  }, [timeline.length])

  const activeMoment = useMemo(
    () => findActiveMoment(timeline, playhead),
    [timeline, playhead],
  )

  // ── Scripture for the active moment, via the existing verse fetcher. ──────
  const activeCitations = useMemo(
    () => parseBibleReferences(activeMoment?.bibleVerses ?? []),
    [activeMoment],
  )
  const verseTexts = useBibleVerses(activeCitations)

  const untimedList =
    classification.kind === "untimed" ? classification.list : []
  const studyQuestions = video?.studyQuestions ?? []

  const hasAnything =
    data.kind === "loading" ||
    timeline.length > 0 ||
    untimedList.length > 0 ||
    studyQuestions.length > 0

  return (
    <>
      <View style={styles.headingBox}>
        <Text style={watchMenuStyles.title} accessibilityRole="header">
          Explore
        </Text>
      </View>
      <ScrollView
        style={watchMenuStyles.list}
        contentContainerStyle={watchMenuStyles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {data.kind === "loading" ? (
          <Text style={watchMenuStyles.status}>Loading…</Text>
        ) : null}

        {/* ── This moment (timed films only) ── */}
        {activeMoment != null ? (
          <View style={styles.momentBox}>
            <Text style={styles.momentKicker}>
              This moment · {formatClock(activeMoment.startSeconds)}
            </Text>
            {activeMoment.summary != null ? (
              <Text style={styles.momentSummary}>{activeMoment.summary}</Text>
            ) : null}
            {activeCitations.map((citation) => {
              const text = verseTexts[citation.documentId]
              return (
                <View key={citation.documentId} style={styles.verseBox}>
                  <Text style={styles.verseReference}>
                    {formatCitationReference(citation)}
                  </Text>
                  {text != null ? (
                    <Text style={styles.verseText} numberOfLines={4}>
                      {text}
                    </Text>
                  ) : null}
                </View>
              )
            })}
          </View>
        ) : null}

        {/* ── Scenes: jump rows (timed films only) ── */}
        {timeline.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>Scenes</Text>
            {timeline.map((moment, index) => (
              <WatchOptionRow
                key={`moment-${moment.startSeconds}-${index}`}
                icon="play-outline"
                label={moment.summary ?? formatClock(moment.startSeconds)}
                note={formatClock(moment.startSeconds)}
                selected={moment === activeMoment}
                onPress={() => onSeekTo(moment.startSeconds)}
                accessibilityLabel={`Jump to ${formatClock(moment.startSeconds)}`}
              />
            ))}
          </>
        ) : null}

        {/* ── Untimed fallback: summaries as a plain list ── */}
        {untimedList.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>In this film</Text>
            {untimedList.map((moment, index) =>
              moment.summary != null ? (
                <Text key={`untimed-${index}`} style={styles.untimedRow}>
                  {moment.summary}
                </Text>
              ) : null,
            )}
          </>
        ) : null}

        {/* ── Study questions (film-level; untimed by nature) ── */}
        {studyQuestions.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>Questions to consider</Text>
            {studyQuestions.map((question) => (
              <Text key={question.documentId} style={styles.untimedRow}>
                {question.value}
              </Text>
            ))}
          </>
        ) : null}

        {!hasAnything ? (
          <Text style={watchMenuStyles.status}>
            Nothing to explore for this video yet
          </Text>
        ) : null}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  headingBox: {
    height: MENU_HEADING_HEIGHT,
    justifyContent: "flex-end",
    paddingBottom: scale(12),
    paddingHorizontal: scale(20),
  },
  momentBox: {
    paddingHorizontal: scale(20),
    paddingBottom: scale(12),
  },
  momentKicker: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: "System",
    fontSize: scale(13),
    marginBottom: scale(6),
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  momentSummary: {
    color: "#FFFFFF",
    fontFamily: "System",
    fontSize: scale(17),
    lineHeight: scale(23),
  },
  verseBox: {
    marginTop: scale(10),
  },
  verseReference: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: "System",
    fontSize: scale(14),
    fontWeight: "600",
    marginBottom: scale(3),
  },
  verseText: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: "System",
    fontSize: scale(14),
    lineHeight: scale(19),
    fontStyle: "italic",
  },
  sectionLabel: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: "System",
    fontSize: scale(13),
    marginTop: scale(14),
    marginBottom: scale(6),
    paddingHorizontal: scale(20),
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  untimedRow: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: "System",
    fontSize: scale(15),
    lineHeight: scale(21),
    paddingHorizontal: scale(20),
    paddingVertical: scale(6),
  },
})
