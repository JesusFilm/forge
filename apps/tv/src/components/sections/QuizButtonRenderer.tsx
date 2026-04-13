import { useCallback, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { LinearGradient } from "expo-linear-gradient"

import { FocusableCard } from "../FocusableCard"
import { COLORS } from "../../lib/colors"
import type { NormalizedBlock } from "../../lib/normalizer"

// ── Platform detection ─────────────────────────────────────────────────────

const isTvOS = Platform.isTV && Platform.OS === "ios"

// ── WebView (Android TV only) ──────────────────────────────────────────────
// Static import is fine — the module exists in node_modules for both platforms.
// We only *mount* the component on Android TV.
import { WebView } from "react-native-webview"

// ── QR code (tvOS only) ────────────────────────────────────────────────────
import qrcode from "qrcode-generator"

// ── Quiz gradient (from mobile-v2 src/lib/color.ts) ───────────────────────

const QUIZ_GRADIENT: readonly [string, string] = ["#E8891C", "#CB333B"]

// ── URL Validation ─────────────────────────────────────────────────────────

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

// ── QR Matrix Component (tvOS) ─────────────────────────────────────────────

function QrMatrix({ url }: { url: string }) {
  const matrix = useMemo(() => {
    const qr = qrcode(0, "L")
    qr.addData(url)
    qr.make()
    const n = qr.getModuleCount()
    // 8 = 4 cells quiet-zone on each side
    const cellSize = Math.round(480 / (n + 8))
    const quietZone = 4 * cellSize
    const gridSize = n * cellSize
    const totalSize = gridSize + quietZone * 2

    const rows: boolean[][] = []
    for (let r = 0; r < n; r++) {
      const row: boolean[] = []
      for (let c = 0; c < n; c++) {
        row.push(qr.isDark(r, c))
      }
      rows.push(row)
    }

    return { rows, n, cellSize, quietZone, totalSize }
  }, [url])

  return (
    <View
      style={[
        styles.qrOuter,
        {
          width: matrix.totalSize,
          height: matrix.totalSize,
          padding: matrix.quietZone,
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
        },
      ]}
    >
      {matrix.rows.map((row, r) => (
        <View key={`qr-row-${r}`} style={styles.qrRow}>
          {row.map((isDark, c) => (
            <View
              key={`qr-${r}-${c}`}
              style={{
                width: matrix.cellSize,
                height: matrix.cellSize,
                backgroundColor: isDark ? "#000000" : "#FFFFFF",
              }}
            />
          ))}
        </View>
      ))}
    </View>
  )
}

// ── Android TV WebView Modal Content ───────────────────────────────────────

type WebViewState = "loading" | "loaded" | "errored"

function AndroidTvWebViewContent({ url }: { url: string }) {
  const [state, setState] = useState<WebViewState>("loading")

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

  if (state === "errored") {
    return (
      <View style={styles.centeredContent}>
        <Text style={styles.errorText}>Couldn't load the quiz.</Text>
      </View>
    )
  }

  return (
    <View style={styles.webViewContainer}>
      {state === "loading" && (
        <View style={styles.centeredOverlay}>
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
  )
}

// ── tvOS QR Modal Content ──────────────────────────────────────────────────

function TvOSQrContent({ url }: { url: string }) {
  return (
    <View style={styles.centeredContent}>
      <View style={styles.qrCard}>
        <Text style={styles.qrHeading}>Scan to continue on your phone</Text>
        <QrMatrix url={url} />
        <Text style={styles.qrUrlText} numberOfLines={1} ellipsizeMode="middle">
          {url}
        </Text>
      </View>
    </View>
  )
}

// ── QuizButtonRenderer ─────────────────────────────────────────────────────

export function QuizButtonRenderer({ section }: { section: NormalizedBlock }) {
  const [modalVisible, setModalVisible] = useState(false)

  const buttonText = section.buttonText as string | null
  const iframeSrc = section.iframeSrc as string | null

  // Silent drop if URL is invalid or missing
  if (!iframeSrc || !isAllowedQuizUrl(iframeSrc)) return null

  const openModal = () => setModalVisible(true)
  const closeModal = () => setModalVisible(false)

  return (
    <>
      <View style={styles.sectionOuter}>
        <FocusableCard onPress={openModal} style={styles.cardOverride}>
          <LinearGradient
            colors={[...QUIZ_GRADIENT]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.buttonGradient}
          >
            <View style={styles.buttonContent}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>QUIZ</Text>
              </View>
              <Text style={styles.buttonLabel} numberOfLines={2}>
                {buttonText ?? "Take the quiz"}
              </Text>
              <Text style={styles.arrow}>{"\u2192"}</Text>
            </View>
          </LinearGradient>
        </FocusableCard>
      </View>

      <Modal
        visible={modalVisible}
        animationType="fade"
        transparent
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          {/* Close button — receives initial focus */}
          <FocusableCard
            onPress={closeModal}
            hasTVPreferredFocus
            style={styles.closeButton}
          >
            <Text style={styles.closeIcon}>{"\u2715"}</Text>
          </FocusableCard>

          {isTvOS ? (
            <TvOSQrContent url={iframeSrc} />
          ) : (
            <AndroidTvWebViewContent url={iframeSrc} />
          )}
        </View>
      </Modal>
    </>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sectionOuter: {
    paddingHorizontal: 80,
    paddingVertical: 12,
  },
  cardOverride: {
    backgroundColor: "transparent",
    borderRadius: 16,
    overflow: "hidden",
  },
  buttonGradient: {
    borderRadius: 16,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  badge: {
    borderWidth: 2,
    borderColor: "#ffffff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 16,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: Platform.OS === "android" ? Math.round(14) : 14,
    fontWeight: "800",
    fontFamily: "System",
    letterSpacing: 1.5,
  },
  buttonLabel: {
    flex: 1,
    color: "#ffffff",
    fontSize: Platform.OS === "android" ? Math.round(22) : 22,
    fontWeight: "700",
    fontFamily: "System",
    textAlign: "center",
  },
  arrow: {
    color: "#ffffff",
    fontSize: Platform.OS === "android" ? Math.round(28) : 28,
    marginLeft: 16,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
  },
  closeButton: {
    position: "absolute",
    top: 40,
    right: 40,
    zIndex: 10,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    color: "#ffffff",
    fontSize: 22,
    fontFamily: "System",
  },
  // Android TV WebView
  webViewContainer: {
    flex: 1,
    marginTop: 100,
  },
  webView: {
    flex: 1,
    backgroundColor: "transparent",
  },
  webViewHidden: {
    opacity: 0,
  },
  centeredOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  // tvOS QR
  centeredContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  qrCard: {
    backgroundColor: COLORS.surfaceContainerHigh,
    borderRadius: 24,
    padding: 48,
    alignItems: "center",
  },
  qrHeading: {
    color: COLORS.text,
    fontSize: 32,
    fontWeight: "700",
    fontFamily: "System",
    marginBottom: 32,
  },
  qrOuter: {
    alignItems: "center",
    justifyContent: "center",
  },
  qrRow: {
    flexDirection: "row",
  },
  qrUrlText: {
    color: COLORS.muted,
    fontSize: 18,
    fontFamily: "System",
    marginTop: 24,
    maxWidth: 400,
  },
  errorText: {
    color: COLORS.muted,
    fontSize: 24,
    fontFamily: "System",
  },
})
