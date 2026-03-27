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
import { LinearGradient } from "expo-linear-gradient"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { WebView } from "react-native-webview"

import { useTypography } from "../../hooks/useTypography"
import type { QuizButtonSection } from "../../lib/sectionModels"

// -- Constants ----------------------------------------------------------------

const GRADIENT_COLORS = ["#F59E0B", "#F97316", "#EF4444", "#B91C1C"] as const
const GRADIENT_LOCATIONS = [0, 0.35, 0.7, 1] as const

// -- URL validation -----------------------------------------------------------

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

// -- QuizModal (child) --------------------------------------------------------

type QuizModalState = "loading" | "loaded" | "errored"

interface QuizModalProps {
  url: string
  onClose: () => void
}

function QuizModal({ url, onClose }: QuizModalProps) {
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
        {/* Close button */}
        <Pressable
          style={[
            styles.closeButton,
            { top: Platform.OS === "android" ? insets.top : insets.top + 8 },
            Platform.OS === "android" && { right: 16 },
          ]}
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={styles.closeIcon}>{"\u2715"}</Text>
        </Pressable>

        {/* Loading indicator */}
        {state === "loading" && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        )}

        {/* WebView */}
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

// -- QuizButtonRenderer (parent) ----------------------------------------------

export interface QuizButtonRendererProps {
  section: QuizButtonSection
}

export function QuizButtonRenderer({ section }: QuizButtonRendererProps) {
  const { buttonText, iframeSrc } = section
  const [modalVisible, setModalVisible] = useState(false)
  const typography = useTypography()

  // Client-side URL validation — silent drop if invalid
  if (!isAllowedQuizUrl(iframeSrc)) return null

  return (
    <>
      <View style={styles.container}>
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            styles.button,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => setModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Open faith quiz"
        >
          <LinearGradient
            colors={[...GRADIENT_COLORS]}
            locations={[...GRADIENT_LOCATIONS]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.gradient}
          >
            <View style={styles.buttonContent}>
              {/* QUIZ badge — decorative */}
              <View
                style={styles.badge}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Text style={styles.badgeText}>QUIZ</Text>
              </View>

              {/* Button text */}
              <Text
                style={[styles.buttonLabel, typography.body]}
                numberOfLines={2}
              >
                {buttonText}
              </Text>

              {/* Arrow icon */}
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

// -- Styles -------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  button: {
    borderRadius: 12,
    overflow: "hidden",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  gradient: {
    borderRadius: 12,
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
    letterSpacing: 1,
  },
  buttonLabel: {
    flex: 1,
    color: "#ffffff",
    fontWeight: "600",
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
    right: 56,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    color: "#ffffff",
    fontSize: 18,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
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
