import { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { WebView } from "react-native-webview"
import { LinearGradient } from "expo-linear-gradient"

import { useTypography } from "../../hooks/useTypography"
import { QUIZ_GRADIENT } from "../../lib/color"
import { layout, feedback } from "../../styles/shared"
import type { AdminBlock } from "../../lib/queries"

// ── URL Validation ──────────────────────────────────────────────────────────

function isAllowedQuizUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false
    if (
      parsed.hostname !== "nextstep.is" &&
      !parsed.hostname.endsWith(".nextstep.is")
    )
      return false
    if (parsed.username || parsed.password) return false
    return true
  } catch {
    return false
  }
}

// ── QuizModal ───────────────────────────────────────────────────────────────

type QuizModalState = "loading" | "loaded" | "errored"

function QuizModal({ url, onClose }: { url: string; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const [state, setState] = useState<QuizModalState>("loading")

  const handleLoadEnd = useCallback(() => {
    setState((prev) => (prev === "loading" ? "loaded" : prev))
  }, [])

  const handleError = useCallback(() => {
    setState("errored")
  }, [])

  const handleNavigationRequest = useCallback(
    (request: { url: string }) => isAllowedQuizUrl(request.url),
    [],
  )

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.modalOverlay}>
        <Pressable
          style={[
            styles.closeButton,
            { top: Platform.OS === "android" ? insets.top : insets.top + 8 },
          ]}
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={styles.closeIcon}>{"\u2715"}</Text>
        </Pressable>

        {state === "loading" && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        )}

        <WebView
          source={{ uri: url }}
          originWhitelist={["https://*"]}
          onShouldStartLoadWithRequest={handleNavigationRequest}
          style={[styles.webView, state === "loading" && styles.webViewHidden]}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          javaScriptCanOpenWindowsAutomatically={false}
          mixedContentMode="never"
          thirdPartyCookiesEnabled={false}
          mediaPlaybackRequiresUserAction
          onLoadEnd={handleLoadEnd}
          onError={handleError}
        />
      </View>
    </Modal>
  )
}

// ── QuizButtonRenderer ──────────────────────────────────────────────────────

export interface QuizButtonRendererProps {
  section: AdminBlock
}

export function QuizButtonRenderer({ section }: QuizButtonRendererProps) {
  const typography = useTypography()
  const [modalVisible, setModalVisible] = useState(false)

  const s = section as Record<string, unknown>
  const buttonText = s.buttonText as string | null
  const iframeSrc = s.iframeSrc as string | null

  // Silent drop if URL is invalid or missing
  if (!iframeSrc || !isAllowedQuizUrl(iframeSrc)) return null

  return (
    <>
      <View style={[layout.sectionOuter, styles.localContainer]}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && feedback.pressed]}
          onPress={() => setModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Open faith quiz"
        >
          <LinearGradient
            colors={[...QUIZ_GRADIENT]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.buttonGradient}
          >
            <View style={styles.buttonContent}>
              <View
                style={styles.badge}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Text style={styles.badgeText}>QUIZ</Text>
              </View>
              <Text
                style={[styles.buttonLabel, typography.body]}
                numberOfLines={2}
              >
                {buttonText ?? "Take the quiz"}
              </Text>
              <Text
                style={styles.arrow}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {"\u2192"}
              </Text>
            </View>
          </LinearGradient>
        </Pressable>
      </View>

      {modalVisible && (
        <QuizModal url={iframeSrc} onClose={() => setModalVisible(false)} />
      )}
    </>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  localContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  button: {
    borderRadius: 12,
    overflow: "hidden",
    minHeight: 48,
  },
  buttonGradient: {
    flex: 1,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  badge: {
    borderWidth: 2,
    borderColor: "#ffffff",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 12,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
    fontFamily: "System",
    letterSpacing: 1,
  },
  buttonLabel: {
    flex: 1,
    color: "#ffffff",
    fontWeight: "600",
    fontFamily: "System",
    textAlign: "center",
  },
  arrow: {
    color: "#ffffff",
    fontSize: 20,
    marginLeft: 12,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
  },
  closeButton: {
    position: "absolute",
    right: 16,
    zIndex: 10,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    color: "#ffffff",
    fontSize: 18,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  webView: {
    flex: 1,
    backgroundColor: "transparent",
    marginTop: 60,
  },
  webViewHidden: {
    opacity: 0,
  },
})
