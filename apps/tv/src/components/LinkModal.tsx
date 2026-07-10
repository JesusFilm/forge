import { useCallback, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { FocusableCard } from "./FocusableCard"
import { COLORS, hexToRgba } from "../lib/colors"
import { scale } from "../lib/scale"

// ── Platform detection ─────────────────────────────────────────────────────

const isTvOS = Platform.isTV && Platform.OS === "ios"

// ── WebView (Android TV only) ──────────────────────────────────────────────
// Dynamic require: tvOS ships no WebKit, so a static `import` would trigger
// TurboModule registration at load and redbox before any component mounts.
// The conditional require skips evaluation entirely on tvOS.
type WebViewComponent = typeof import("react-native-webview").WebView
const WebView: WebViewComponent | null =
  Platform.OS === "android"
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- Deliberate platform-conditional require. A static import would fail at module load on tvOS (see comment above).
      (require("react-native-webview") as typeof import("react-native-webview"))
        .WebView
    : null

// ── QR code (tvOS only) ────────────────────────────────────────────────────
import qrcode from "qrcode-generator"

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

function AndroidTvWebViewContent({
  url,
  urlValidator,
  errorText,
}: {
  url: string
  urlValidator: (url: string) => boolean
  errorText: string
}) {
  const [state, setState] = useState<WebViewState>("loading")

  const handleLoadEnd = useCallback(() => {
    setState((prev) => (prev === "loading" ? "loaded" : prev))
  }, [])

  const handleError = useCallback(() => {
    setState("errored")
  }, [])

  const handleNavigationRequest = useCallback(
    (request: { url: string }) => urlValidator(request.url),
    [urlValidator],
  )

  if (state === "errored" || WebView == null) {
    return (
      <View style={styles.centeredContent}>
        <Text style={styles.errorText}>{errorText}</Text>
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

function TvOSQrContent({ url, qrHeading }: { url: string; qrHeading: string }) {
  return (
    <View style={styles.centeredContent}>
      <View style={styles.qrCard}>
        <Text style={styles.qrHeading}>{qrHeading}</Text>
        <QrMatrix url={url} />
        <Text style={styles.qrUrlText} numberOfLines={1} ellipsizeMode="middle">
          {url}
        </Text>
      </View>
    </View>
  )
}

// ── LinkModal ──────────────────────────────────────────────────────────────

type LinkModalProps = {
  url: string
  visible: boolean
  onClose: () => void
  urlValidator: (url: string) => boolean
  errorText?: string
  qrHeading?: string
}

export function LinkModal({
  url,
  visible,
  onClose,
  urlValidator,
  errorText = "Couldn't load the page.",
  qrHeading = "Scan to continue on your phone",
}: LinkModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        {/* Close button in normal flow so tvOS focus engine can reach it */}
        <View style={styles.closeRow}>
          <FocusableCard
            onPress={onClose}
            hasTVPreferredFocus
            style={styles.closeButton}
            accessibilityLabel="Close"
          >
            <Text style={styles.closeIcon}>{"\u2715"}</Text>
          </FocusableCard>
        </View>

        {isTvOS ? (
          <TvOSQrContent url={url} qrHeading={qrHeading} />
        ) : (
          <AndroidTvWebViewContent
            url={url}
            urlValidator={urlValidator}
            errorText={errorText}
          />
        )}
      </View>
    </Modal>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
  },
  closeRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: scale(40),
    paddingRight: scale(40),
  },
  closeButton: {
    width: scale(56),
    height: scale(56),
    borderRadius: scale(28),
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    color: "#ffffff",
    fontSize: scale(22),
    fontFamily: "System",
  },
  // Android TV WebView
  webViewContainer: {
    flex: 1,
    marginTop: scale(100),
  },
  webView: {
    flex: 1,
    backgroundColor: hexToRgba(COLORS.surface, 0),
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
    borderRadius: scale(24),
    padding: scale(48),
    alignItems: "center",
  },
  qrHeading: {
    color: COLORS.text,
    fontSize: scale(32),
    fontWeight: "700",
    fontFamily: "System",
    marginBottom: scale(32),
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
    fontSize: scale(18),
    fontFamily: "System",
    marginTop: scale(24),
    maxWidth: scale(400),
  },
  errorText: {
    color: COLORS.muted,
    fontSize: scale(24),
    fontFamily: "System",
  },
})
