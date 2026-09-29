import { useCallback, useState } from "react"
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { AnimatedChevron, animateLayout } from "../ui/AnimatedChevron"
import { validateActionUrl } from "../../lib/validateUrl"
import { useTypography } from "../../hooks/useTypography"
import {
  useTextDirection,
  type TextDirectionProps,
} from "../../i18n/textDirection"
import { useT } from "../../i18n/useT"
import {
  ACCENT,
  BG_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_BODY,
} from "../../lib/color"
import { layout, text, button } from "../../styles/shared"
import type { AdminBlock } from "../../lib/queries"

type QuestionItem = {
  question: string
  answer: string
}

export interface RelatedQuestionsRendererProps {
  section: AdminBlock
  /** The language of the heading and of the questions (KTD13). Absent on the
   *  Experience and SDUI paths, whose text language is not known. */
  headingLang?: string | null
  questionsLang?: string | null
}

const CHAT_WITH_PERSON_URL =
  "https://chataboutjesus.com/chat/?utm_source=jesusfilm-watch"
const ASK_BIBLE_QUESTION_URL =
  "https://www.everystudent.com/contact.php?utm_source=jesusfilm-watch"

function AnswerFallback() {
  const typography = useTypography()
  const t = useT("StudyQuestions")
  const direction = useTextDirection()

  return (
    <View style={styles.fallbackContainer}>
      <Text style={[styles.fallbackBody, typography.bodySmall, direction.ui]}>
        {t("fallbackBody")}
      </Text>
      <View style={styles.fallbackButtonRow}>
        <Pressable
          style={({ pressed }) => [
            styles.fallbackButton,
            pressed && Platform.OS === "ios" && styles.fallbackButtonPressed,
          ]}
          android_ripple={{ color: "rgba(0, 0, 0, 0.1)" }}
          onPress={() => Linking.openURL(CHAT_WITH_PERSON_URL)}
          accessibilityRole="link"
          accessibilityLabel={t("chatAriaLabel")}
          {...{ "dd-action-name": "study-questions-chat" }}
        >
          <Ionicons
            name="chatbubble-outline"
            size={14}
            color={BG_COLOR}
            style={styles.fallbackButtonIcon}
          />
          <Text style={styles.fallbackButtonText}>{t("chat")}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.fallbackButton,
            pressed && Platform.OS === "ios" && styles.fallbackButtonPressed,
          ]}
          android_ripple={{ color: "rgba(0, 0, 0, 0.1)" }}
          onPress={() => Linking.openURL(ASK_BIBLE_QUESTION_URL)}
          accessibilityRole="link"
          accessibilityLabel={t("askBibleQuestionAriaLabel")}
          {...{ "dd-action-name": "study-questions-ask" }}
        >
          <Ionicons
            name="mail-outline"
            size={14}
            color={BG_COLOR}
            style={styles.fallbackButtonIcon}
          />
          <Text style={styles.fallbackButtonText}>{t("askBibleQuestion")}</Text>
        </Pressable>
      </View>
    </View>
  )
}

function QuestionRow({
  item,
  isExpanded,
  onToggle,
  questionDirection,
}: {
  item: QuestionItem
  isExpanded: boolean
  onToggle: () => void
  questionDirection: TextDirectionProps
}) {
  const typography = useTypography()
  const hasAnswer = item.answer != null && item.answer.trim() !== ""

  return (
    <View style={styles.item}>
      <Pressable
        style={styles.questionRow}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={item.question}
        accessibilityLanguage={questionDirection.accessibilityLanguage}
        accessibilityState={{ expanded: isExpanded }}
      >
        <Text
          style={[
            styles.questionText,
            typography.body,
            questionDirection.style,
          ]}
          numberOfLines={3}
          accessibilityLanguage={questionDirection.accessibilityLanguage}
        >
          {item.question}
        </Text>
        <AnimatedChevron
          isExpanded={isExpanded}
          glyph={"›"}
          style={styles.chevron}
        />
      </Pressable>
      {isExpanded &&
        (hasAnswer ? (
          <Text style={[styles.answerText, typography.bodySmall]}>
            {item.answer}
          </Text>
        ) : (
          <AnswerFallback />
        ))}
    </View>
  )
}

export function RelatedQuestionsRenderer({
  section,
  headingLang,
  questionsLang,
}: RelatedQuestionsRendererProps) {
  const typography = useTypography()
  const t = useT("StudyQuestions")
  const direction = useTextDirection()
  const headingDirection = direction.text(headingLang)
  const questionDirection = direction.text(questionsLang)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  const s = section as Record<string, unknown>
  const heading = s.heading as string | null
  const ctaLabel = s.ctaLabel as string | null
  const ctaLink = s.ctaLink as string | null
  const questions = (s.questions as QuestionItem[] | undefined) ?? []

  const handleToggle = useCallback((index: number) => {
    animateLayout()
    setExpandedIndex((prev) => (prev === index ? null : index))
  }, [])

  const handleCtaPress = useCallback(() => {
    if (ctaLink && validateActionUrl(ctaLink)) {
      Linking.openURL(ctaLink)
    }
  }, [ctaLink])

  return (
    <View style={[layout.sectionOuter, styles.localContainer]}>
      <View style={[layout.headerRow, styles.localHeaderRow]}>
        {heading != null && (
          <Text
            style={[
              text.sectionHeading,
              styles.localHeading,
              typography.titleLarge,
              headingDirection.style,
            ]}
            accessibilityRole="header"
            accessibilityLanguage={headingDirection.accessibilityLanguage}
          >
            {heading}
          </Text>
        )}
        {ctaLink != null && (
          <Pressable
            onPress={handleCtaPress}
            style={[button.iconButton44, styles.localCtaButton]}
            accessibilityRole="link"
            accessibilityLabel={ctaLabel ?? t("askQuestionAriaLabel")}
            {...{ "dd-action-name": "study-questions-cta" }}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={22}
              color={ACCENT}
            />
          </Pressable>
        )}
      </View>
      {questions.map((item, index) => (
        <QuestionRow
          key={`rq-${index}`}
          item={item}
          isExpanded={expandedIndex === index}
          onToggle={() => handleToggle(index)}
          questionDirection={questionDirection}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  localContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  localHeaderRow: {
    marginBottom: 12,
  },
  localHeading: {
    flex: 1,
  },
  localCtaButton: {
    marginLeft: 8,
  },
  item: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.1)",
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    minHeight: 48,
  },
  questionText: {
    flex: 1,
    fontWeight: "600",
    color: TEXT_PRIMARY,
    fontFamily: "System",
    marginRight: 12,
  },
  chevron: {
    fontSize: 22,
    color: TEXT_SECONDARY,
  },
  answerText: {
    color: TEXT_BODY,
    fontFamily: "System",
    paddingBottom: 16,
    paddingLeft: 0,
  },
  fallbackContainer: {
    paddingBottom: 16,
  },
  fallbackBody: {
    color: TEXT_BODY,
    fontFamily: "System",
    marginBottom: 12,
  },
  fallbackButtonRow: {
    flexDirection: "row",
    gap: 8,
  },
  fallbackButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TEXT_PRIMARY,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 40,
  },
  fallbackButtonPressed: {
    opacity: 0.85,
  },
  fallbackButtonIcon: {
    marginRight: 4,
  },
  fallbackButtonText: {
    color: BG_COLOR,
    fontFamily: "System",
    fontWeight: "600",
    fontSize: 14,
  },
})
