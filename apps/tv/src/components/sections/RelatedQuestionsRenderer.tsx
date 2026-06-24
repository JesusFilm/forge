import { useCallback, useState } from "react"
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import {
  ANSWER_FALLBACK_BODY,
  ASK_BIBLE_QUESTION_URL,
  CHAT_WITH_PERSON_URL,
} from "../../lib/bibleContent"
import type { NormalizedBlock } from "../../lib/normalizer"
import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { validateActionUrl } from "../../lib/validateUrl"
import { FocusableCard } from "../FocusableCard"
import { LinkModal } from "../LinkModal"
import { SECTION_HEADING } from "./sectionHeading"

// ── Enable LayoutAnimation on Android ───────────────────────────────────────

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

// ── Types ───────────────────────────────────────────────────────────────────

type QuestionItem = {
  id: string
  question: string
  /** Nullable in admin's schema (RelatedQuestionItem.answer: String). */
  answer: string | null
}

// ── No-answer fallback ──────────────────────────────────────────────────────
//
// Answer-less expanded rows show the mobile/web fallback: a "private discussion"
// line + two pill CTAs. On TV the links open the QR LinkModal (phone is the
// continuation surface), not Linking.openURL. URLs + copy in lib/bibleContent.

const PILL_ICON_SIZE = Math.round(scale(18))

// Question-row focus ring overhangs the row into the column gutter so the border
// clears edge-to-edge content (the row keeps paddingHorizontal 0). Outset must
// stay <= the surrounding gutter; it does on both the inset=80 and inset=0 mounts.
const RING_OUTSET_H = scale(16)
const RING_OUTSET_V = scale(6)

function FallbackPill({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  label: string
  onPress: () => void
}) {
  // White pill (bg #F5F5F4): the app-wide white focus ring has no contrast here,
  // so opt into the crimson glow — the documented light-surface exception.
  return (
    <FocusableCard
      onPress={onPress}
      accessibilityLabel={label}
      style={styles.fallbackPill}
      focusRing="crimson"
    >
      <Ionicons name={icon} size={PILL_ICON_SIZE} color={COLORS.surface} />
      <Text style={styles.fallbackPillText}>{label}</Text>
    </FocusableCard>
  )
}

function AnswerFallback({ onOpenLink }: { onOpenLink: (url: string) => void }) {
  return (
    <View style={styles.fallbackContainer}>
      <Text style={styles.fallbackBody}>{ANSWER_FALLBACK_BODY}</Text>
      <View style={styles.fallbackButtonRow}>
        <FallbackPill
          icon="chatbubble-outline"
          label="Chat with a person"
          onPress={() => onOpenLink(CHAT_WITH_PERSON_URL)}
        />
        <FallbackPill
          icon="mail-outline"
          label="Ask a Bible question"
          onPress={() => onOpenLink(ASK_BIBLE_QUESTION_URL)}
        />
      </View>
    </View>
  )
}

// ── QuestionRow ─────────────────────────────────────────────────────────────

function QuestionRow({
  item,
  isExpanded,
  onToggle,
  inset,
  onOpenLink,
}: {
  item: QuestionItem
  isExpanded: boolean
  onToggle: () => void
  inset: number
  onOpenLink: (url: string) => void
}) {
  const [isFocused, setIsFocused] = useState(false)
  // Null-safe: admin's RelatedQuestionItem.answer is a nullable String and the
  // SDUI cast hides it — a null answer must fall back, not crash the screen
  // (mobile's renderer guards the same way).
  const hasAnswer = (item.answer ?? "").trim() !== ""

  return (
    <View style={[styles.item, { marginHorizontal: inset }]}>
      <Pressable
        style={styles.questionRow}
        onPress={onToggle}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        accessibilityRole="button"
        accessibilityLabel={item.question}
        accessibilityState={{ expanded: isExpanded }}
      >
        <Text style={styles.questionText} numberOfLines={3}>
          {item.question}
        </Text>
        <Text style={styles.chevron}>{isExpanded ? "\u2304" : "\u203A"}</Text>
        {/* White focus ring overlay (matches HomeCard) \u2014 no layout shift. */}
        {isFocused ? (
          <View style={styles.questionRowRing} pointerEvents="none" />
        ) : null}
      </Pressable>
      {isExpanded &&
        (hasAnswer ? (
          <Text style={styles.answerText}>{item.answer}</Text>
        ) : (
          <AnswerFallback onOpenLink={onOpenLink} />
        ))}
    </View>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export function RelatedQuestionsRenderer({
  section,
  inset = scale(80),
}: {
  section: NormalizedBlock
  /**
   * Horizontal screen gutter; defaults to the SDUI full-bleed gutter (scale(80)).
   * The watch page passes 0 when the section sits in an already-padded column.
   */
  inset?: number
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState<string | null>(null)

  const heading = section.rqHeading as string | null
  const questions = (section.questions as QuestionItem[] | undefined) ?? []

  const handleToggle = useCallback((id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  if (questions.length === 0) {
    if (heading == null) return null
    return (
      <View style={styles.container}>
        <Text
          style={[styles.heading, { paddingHorizontal: inset }]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {heading != null && (
        <Text
          style={[styles.heading, { paddingHorizontal: inset }]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      )}
      {questions.map((item, index) => (
        <QuestionRow
          key={`rq-${item.id}-${index}`}
          item={item}
          isExpanded={expandedId === item.id}
          onToggle={() => handleToggle(item.id)}
          inset={inset}
          onOpenLink={setLinkUrl}
        />
      ))}
      {linkUrl != null && (
        <LinkModal
          url={linkUrl}
          visible
          onClose={() => setLinkUrl(null)}
          urlValidator={validateActionUrl}
          errorText="Couldn't load the page."
          qrHeading="Scan to continue on your phone"
        />
      )}
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginBottom: scale(32),
  },
  // Horizontal gutters (heading paddingHorizontal / item marginHorizontal)
  // come from the `inset` prop so the section works full-bleed and in-column.
  heading: {
    ...SECTION_HEADING,
    marginBottom: scale(12),
  },
  item: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: scale(20),
    paddingHorizontal: 0,
    borderRadius: scale(8),
  },
  // Extended OUTWARD (negative insets) so the 5px border clears the row's
  // edge-to-edge content (paddingHorizontal 0) instead of overlapping the first
  // glyph + chevron; the overhang sits in the empty column gutter.
  questionRowRing: {
    position: "absolute",
    top: -RING_OUTSET_V,
    bottom: -RING_OUTSET_V,
    left: -RING_OUTSET_H,
    right: -RING_OUTSET_H,
    borderRadius: scale(12),
    borderWidth: scale(5),
    borderColor: "rgba(255,255,255,0.9)",
  },
  questionText: {
    flex: 1,
    fontFamily: "System",
    fontSize: scale(22),
    fontWeight: "600",
    color: COLORS.text,
    marginRight: scale(12),
  },
  chevron: {
    fontFamily: "System",
    fontSize: scale(24),
    color: COLORS.muted,
  },
  fallbackContainer: {
    paddingBottom: scale(24),
  },
  fallbackBody: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    lineHeight: Math.round(scale(28)),
    color: COLORS.muted,
    marginBottom: scale(16),
  },
  fallbackButtonRow: {
    flexDirection: "row",
    gap: scale(16),
  },
  // White pill with dark ink (mobile/web parity); focus comes from
  // FocusableCard's scale + white ring.
  fallbackPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(8),
    backgroundColor: COLORS.text,
    borderRadius: scale(999),
    paddingHorizontal: scale(20),
    paddingVertical: scale(10),
  },
  fallbackPillText: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "600",
    color: COLORS.surface,
  },
  answerText: {
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "400",
    color: COLORS.muted,
    lineHeight: scale(30),
    paddingBottom: scale(20),
  },
})
