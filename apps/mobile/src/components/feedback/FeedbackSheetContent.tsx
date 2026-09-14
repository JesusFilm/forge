import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react"
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  STATUS_DONE_COLOR,
  STATUS_FAILED_COLOR,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  WARNING_COLOR,
} from "../../lib/color"
import { FEEDBACK_FAILURE_MESSAGE } from "../../lib/feedbackCopy"
import {
  getFeedbackPlatform,
  readFeedbackDeviceDetails,
} from "../../lib/feedbackDeviceDetails"
import { FEEDBACK_KINDS } from "../../lib/feedbackQueries"
import {
  createFeedbackSubmission,
  FEEDBACK_EMAIL_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_NAME_MAX_LENGTH,
  type FeedbackSubmissionModel,
} from "../../lib/feedbackSubmission"
import { feedback } from "../../styles/shared"
import {
  createFeedbackFlowState,
  decideFeedbackSend,
  feedbackDisclosureHint,
  feedbackDisclosureRows,
  feedbackFlowReducer,
  feedbackProblemText,
  feedbackStepHeading,
  feedbackTagText,
  FEEDBACK_COMPOSE_HEADING,
  FEEDBACK_KIND_LABEL,
  FEEDBACK_PICK_KIND_HEADING,
  FEEDBACK_STEP_FADE_MS,
  FEEDBACK_SUCCESS_CLOSE_MS,
  FEEDBACK_SUCCESS_MESSAGE,
  type FeedbackSheetContext,
} from "./feedbackFlow"

export type FeedbackSheetContentProps = {
  /** KD5/AE1: the player door supplies the kind and the video tag. */
  context?: FeedbackSheetContext
  onClose: () => void
  /** R19: true while a submission is in flight, so the host can refuse its own
   *  backdrop, gesture and Android back dismissals. */
  onDismissLockedChange?: (locked: boolean) => void
}

/**
 * The two-step feedback form (KTD4): pick a kind, then write. One body serves
 * both doors, so it renders no Modal, owns no route, and imports no navigation
 * — the host supplies the presentation and reads `onDismissLockedChange`.
 *
 * R10: English only. The app is not localized today.
 */
export function FeedbackSheetContent({
  context,
  onClose,
  onDismissLockedChange,
}: FeedbackSheetContentProps) {
  const typography = useTypography()
  const reduceMotion = useReduceMotion()
  const [state, dispatch] = useReducer(
    feedbackFlowReducer,
    context,
    createFeedbackFlowState,
  )

  // KTD8: one submission id per sheet lifetime, so every Retry files under the
  // id the first attempt used and a duplicate ticket is visible (KD9).
  const modelRef = useRef<FeedbackSubmissionModel | null>(null)
  const model = (modelRef.current ??= createFeedbackSubmission())

  const platform = useMemo(() => getFeedbackPlatform(), [])
  // ONE read feeds both the disclosure and the submission, so the list cannot
  // describe values other than the ones sent (AE4).
  const deviceDetails = useMemo(() => readFeedbackDeviceDetails(), [])
  const disclosureRows = useMemo(
    () => feedbackDisclosureRows(platform, deviceDetails),
    [platform, deviceDetails],
  )

  const inFlight = useRef(false)
  // Setup restores what cleanup clears: StrictMode remounts the SAME instance
  // (setup -> cleanup -> setup), so a flag only ever cleared stays poisoned.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const dismissLocked = state.phase === "sending"
  useEffect(() => {
    onDismissLockedChange?.(dismissLocked)
    // An unmount mid-send detaches the request (R19), so a host that outlives
    // this body must not stay locked.
    return () => onDismissLockedChange?.(false)
  }, [dismissLocked, onDismissLockedChange])

  const heading = feedbackStepHeading(state.phase)
  const announcedHeading = useRef<string | null>(null)
  useEffect(() => {
    if (heading === null) return
    // KTD11: announce the step the person MOVED to, in either direction. The
    // step they opened on is read out by the screen reader already.
    const previous = announcedHeading.current
    announcedHeading.current = heading
    if (previous !== null && previous !== heading) {
      AccessibilityInfo.announceForAccessibility(heading)
    }
  }, [heading])

  useEffect(() => {
    if (state.phase !== "success") return
    AccessibilityInfo.announceForAccessibility(FEEDBACK_SUCCESS_MESSAGE)
    // Reading time, not motion, so reduce-motion leaves this dwell alone.
    const timer = setTimeout(onClose, FEEDBACK_SUCCESS_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [state.phase, onClose])

  const step = state.phase === "pickKind" ? "pickKind" : "compose"
  const stepOpacity = useRef(new Animated.Value(1)).current
  const fadedStep = useRef<string | null>(null)
  useEffect(() => {
    const previous = fadedStep.current
    fadedStep.current = step
    // The host animates the sheet in, so only a step CHANGE fades here.
    if (previous === null || previous === step) return
    stepOpacity.setValue(0)
    Animated.timing(stepOpacity, {
      toValue: 1,
      duration: reduceMotion ? 0 : FEEDBACK_STEP_FADE_MS,
      useNativeDriver: true,
    }).start()
  }, [step, reduceMotion, stepOpacity])

  const handleSend = useCallback(() => {
    // A second tap during the round trip must not file a second ticket.
    if (inFlight.current) return
    const decision = decideFeedbackSend(state)
    if (decision.status === "blocked") {
      dispatch({ type: "sendBlocked", problems: decision.problems })
      return
    }
    inFlight.current = true
    dispatch({ type: "sendStarted" })
    void model
      .send({
        draft: decision.draft,
        platform,
        deviceDetails: state.includeDeviceDetails ? deviceDetails : null,
        video: state.video,
      })
      // U3 contracts send() to resolve on every path, so there is one failure
      // branch here and no rejection handler.
      .then((outcome) => {
        inFlight.current = false
        if (!alive.current) return
        dispatch(
          outcome.status === "accepted"
            ? { type: "sendSucceeded" }
            : { type: "sendFailed" },
        )
      })
  }, [deviceDetails, model, platform, state])

  const handleClose = useCallback(() => {
    if (dismissLocked) return
    onClose()
  }, [dismissLocked, onClose])

  if (state.phase === "success") {
    return (
      <Pressable
        style={styles.successPanel}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Ionicons name="checkmark-circle" size={44} color={STATUS_DONE_COLOR} />
        <Text style={[styles.successText, typography.titleSmall]}>
          {FEEDBACK_SUCCESS_MESSAGE}
        </Text>
      </Pressable>
    )
  }

  const showBack = state.phase === "compose" || state.phase === "sending"
  const shell = (children: ReactNode) => (
    <View style={styles.root}>
      <View style={styles.header}>
        {showBack ? (
          <Pressable
            onPress={() => dispatch({ type: "back" })}
            disabled={dismissLocked}
            style={styles.headerSlot}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color={TEXT_PRIMARY} />
          </Pressable>
        ) : (
          <View style={styles.headerSlot} />
        )}
        <Text style={[styles.headerTitle, typography.titleSmall]}>
          Send feedback
        </Text>
        <Pressable
          onPress={handleClose}
          disabled={dismissLocked}
          style={styles.headerSlot}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={22} color={TEXT_PRIMARY} />
        </Pressable>
      </View>
      <Animated.View style={[styles.step, { opacity: stepOpacity }]}>
        {children}
      </Animated.View>
    </View>
  )

  if (state.phase === "pickKind") {
    return shell(
      <View style={styles.body}>
        <Text style={[styles.heading, typography.titleLarge]}>
          {FEEDBACK_PICK_KIND_HEADING}
        </Text>
        {FEEDBACK_KINDS.map((kind) => (
          <Pressable
            key={kind}
            onPress={() => dispatch({ type: "chooseKind", kind })}
            style={({ pressed }) => [styles.tile, pressed && feedback.pressed]}
            accessibilityRole="button"
            accessibilityLabel={FEEDBACK_KIND_LABEL[kind]}
            accessibilityState={{ selected: state.kind === kind }}
          >
            <Text style={[styles.tileLabel, typography.body]}>
              {FEEDBACK_KIND_LABEL[kind]}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={TEXT_SECONDARY} />
          </Pressable>
        ))}
      </View>,
    )
  }

  if (state.phase === "failed") {
    return shell(
      <View style={styles.body}>
        <View style={styles.noticeRow}>
          <Ionicons name="warning" size={20} color={WARNING_COLOR} />
          {/* R13/KD10: the one message, whatever the refusal was. */}
          <Text style={[styles.noticeText, typography.body]}>
            {FEEDBACK_FAILURE_MESSAGE}
          </Text>
        </View>
        <Pressable
          onPress={handleSend}
          style={({ pressed }) => [
            styles.sendButton,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={styles.sendLabel}>Try again</Text>
        </Pressable>
        <Pressable
          onPress={() => dispatch({ type: "edit" })}
          style={({ pressed }) => [
            styles.quietButton,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Edit your feedback"
        >
          <Text style={styles.quietLabel}>Edit</Text>
        </Pressable>
      </View>,
    )
  }

  const messageLength = state.message.trim().length

  const contactField = (
    field: "name" | "email",
    label: string,
    placeholder: string,
    maxLength: number,
  ) => (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, typography.bodySmall]}>{label}</Text>
      <TextInput
        style={[styles.input, typography.body]}
        value={state[field]}
        onChangeText={(value) => dispatch({ type: "editField", field, value })}
        onBlur={() => dispatch({ type: "validateField", field })}
        editable={!dismissLocked}
        placeholder={placeholder}
        placeholderTextColor={TEXT_SECONDARY}
        autoCapitalize={field === "email" ? "none" : "words"}
        autoCorrect={false}
        keyboardType={field === "email" ? "email-address" : "default"}
        // R18 shows the problem inline; the bound also stops the typing that
        // would produce it.
        maxLength={maxLength}
        accessibilityLabel={label}
      />
      {state.problems[field] ? (
        <Text style={[styles.problemText, typography.caption]}>
          {feedbackProblemText(field, state.problems[field])}
        </Text>
      ) : null}
    </View>
  )

  return shell(
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.heading, typography.titleLarge]}>
        {FEEDBACK_COMPOSE_HEADING}
      </Text>
      <Text style={[styles.kindLine, typography.bodySmall]}>
        {FEEDBACK_KIND_LABEL[state.kind]}
      </Text>

      {state.video ? (
        <View style={styles.tagRow}>
          <Text
            style={[styles.tagText, typography.bodySmall]}
            numberOfLines={2}
          >
            {feedbackTagText(state.video)}
          </Text>
          <Pressable
            onPress={() => dispatch({ type: "removeVideo" })}
            disabled={dismissLocked}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Remove the video from this report"
          >
            <Ionicons name="close-circle" size={20} color={TEXT_SECONDARY} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.field}>
        <TextInput
          style={[styles.input, styles.messageInput, typography.body]}
          value={state.message}
          onChangeText={(value) =>
            dispatch({ type: "editField", field: "message", value })
          }
          editable={!dismissLocked}
          multiline
          textAlignVertical="top"
          placeholder="Tell us what you noticed."
          placeholderTextColor={TEXT_SECONDARY}
          accessibilityLabel="Your message"
        />
        <View style={styles.countRow}>
          {state.problems.message ? (
            <Text style={[styles.problemText, typography.caption]}>
              {feedbackProblemText("message", state.problems.message)}
            </Text>
          ) : (
            <View style={styles.countSpacer} />
          )}
          <Text
            style={[styles.countText, typography.caption]}
            accessibilityLabel={`${messageLength} of ${FEEDBACK_MESSAGE_MAX_LENGTH} characters`}
          >
            {`${messageLength}/${FEEDBACK_MESSAGE_MAX_LENGTH}`}
          </Text>
        </View>
      </View>

      {/* R7/KD4: the person types these. Nothing is read from the account. */}
      {contactField(
        "name",
        "Your name (optional)",
        "Name",
        FEEDBACK_NAME_MAX_LENGTH,
      )}
      {contactField(
        "email",
        "Your email (optional)",
        "Email address",
        FEEDBACK_EMAIL_MAX_LENGTH,
      )}

      <View style={styles.switchRow}>
        <Text style={[styles.switchLabel, typography.body]}>
          Include device details
        </Text>
        <Switch
          value={state.includeDeviceDetails}
          onValueChange={(value) =>
            dispatch({ type: "setIncludeDeviceDetails", value })
          }
          disabled={dismissLocked}
          trackColor={{ false: SURFACE_COLOR, true: ACCENT }}
          thumbColor="#ffffff"
          accessibilityRole="switch"
          accessibilityLabel="Include device details"
          accessibilityHint={feedbackDisclosureHint(disclosureRows)}
        />
      </View>
      <View style={styles.disclosure}>
        <Text style={[styles.disclosureTitle, typography.caption]}>
          What this sends
        </Text>
        {disclosureRows.map((row) => (
          <Text
            key={row.label}
            style={[styles.disclosureRow, typography.caption]}
          >
            {`${row.label}: ${row.value}`}
          </Text>
        ))}
      </View>

      <Pressable
        onPress={handleSend}
        disabled={dismissLocked}
        style={({ pressed }) => [
          styles.sendButton,
          pressed && feedback.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Send feedback"
        accessibilityState={{ disabled: dismissLocked, busy: dismissLocked }}
      >
        <Text style={styles.sendLabel}>
          {dismissLocked ? "Sending…" : "Send"}
        </Text>
      </Pressable>
    </ScrollView>,
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  headerSlot: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
  },
  step: {
    flex: 1,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 12,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 12,
  },
  heading: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
  },
  kindLine: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  tile: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: SURFACE_COLOR,
  },
  tileLabel: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: SURFACE_COLOR,
  },
  tagText: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: SURFACE_COLOR,
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  messageInput: {
    minHeight: 132,
  },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  countSpacer: {
    flex: 1,
  },
  countText: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  problemText: {
    flex: 1,
    color: STATUS_FAILED_COLOR,
    fontFamily: "System",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 4,
  },
  switchLabel: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  disclosure: {
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: SURFACE_COLOR,
  },
  disclosureTitle: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
  },
  disclosureRow: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  noticeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  noticeText: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  sendButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: ACCENT,
  },
  sendLabel: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 16,
    fontWeight: "700",
  },
  quietButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  quietLabel: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "600",
  },
  successPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  successText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
    textAlign: "center",
  },
})
