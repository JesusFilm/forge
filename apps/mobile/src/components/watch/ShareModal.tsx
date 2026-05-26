import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image } from "expo-image"
import Ionicons from "@expo/vector-icons/Ionicons"

// expo-clipboard loaded lazily — falls back to Share.share if unavailable
type ClipboardModule = { setStringAsync: (text: string) => Promise<boolean> }
let _clipboard: ClipboardModule | null | undefined
function getClipboard(): ClipboardModule | null {
  if (_clipboard === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _clipboard = require("expo-clipboard") as ClipboardModule
    } catch {
      _clipboard = null
    }
  }
  return _clipboard
}

import { useTypography } from "../../hooks/useTypography"
import { ACCENT, SURFACE_COLOR, TEXT_BODY, TEXT_PRIMARY } from "../../lib/color"
import { feedback, HORIZONTAL_PADDING } from "../../styles/shared"

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildShareUrl(videoSlug: string, languageSlug: string | null): string {
  const base = `https://www.jesusfilm.org/watch/${videoSlug}`
  if (languageSlug) return `${base}/${languageSlug}`
  return base
}

function buildFacebookShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`
}

function buildTwitterShareUrl(url: string, title: string | null): string {
  const text = title ?? "Check out this video"
  return `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
}

// ── ShareModal ────────────────────────────────────────────────────────────────

export type ShareModalProps = {
  visible: boolean
  onClose: () => void
  videoTitle: string | null
  videoDescription: string | null
  posterUrl: string | null
  videoSlug: string
  languageSlug: string | null
}

export function ShareModal({
  visible,
  onClose,
  videoTitle,
  videoDescription,
  posterUrl,
  videoSlug,
  languageSlug,
}: ShareModalProps) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const shareUrl = useMemo(
    () => buildShareUrl(videoSlug, languageSlug),
    [videoSlug, languageSlug],
  )

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  // Reset copied state when modal opens
  useEffect(() => {
    if (visible) {
      setCopied(false)
    }
  }, [visible])

  const handleCopy = useCallback(async () => {
    const clipboard = getClipboard()
    if (clipboard != null) {
      try {
        await clipboard.setStringAsync(shareUrl)
        setCopied(true)
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current)
        }
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false)
          copiedTimerRef.current = null
        }, 2000)
        return
      } catch {
        // fall through to Share
      }
    }
    Share.share({ message: shareUrl })
  }, [shareUrl])

  const handleFacebook = useCallback(() => {
    Linking.openURL(buildFacebookShareUrl(shareUrl))
  }, [shareUrl])

  const handleTwitter = useCallback(() => {
    Linking.openURL(buildTwitterShareUrl(shareUrl, videoTitle))
  }, [shareUrl, videoTitle])

  return (
    <Modal
      visible={visible}
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
            {
              top: Platform.OS === "android" ? insets.top : insets.top + 8,
            },
          ]}
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={styles.closeIcon}>{"✕"}</Text>
        </Pressable>

        <View
          style={[
            styles.content,
            {
              paddingTop:
                Platform.OS === "android" ? insets.top + 64 : insets.top + 72,
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          {/* Preview card */}
          <View style={styles.previewCard}>
            {posterUrl != null && (
              <Image
                source={{ uri: posterUrl }}
                style={styles.previewImage}
                contentFit="cover"
                recyclingKey={`share-poster-${posterUrl}`}
              />
            )}
            {videoTitle != null && (
              <Text
                style={[styles.previewTitle, typography.titleLarge]}
                numberOfLines={2}
              >
                {videoTitle}
              </Text>
            )}
            {videoDescription != null && (
              <Text
                style={[styles.previewDescription, typography.body]}
                numberOfLines={3}
              >
                {videoDescription}
              </Text>
            )}
          </View>

          {/* Social share row */}
          <View style={styles.socialRow}>
            <Pressable
              style={({ pressed }) => [
                styles.socialButton,
                styles.facebookButton,
                pressed && feedback.pressed,
              ]}
              onPress={handleFacebook}
              accessibilityRole="button"
              accessibilityLabel="Share on Facebook"
            >
              <Ionicons name="logo-facebook" size={24} color="#ffffff" />
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.socialButton,
                styles.twitterButton,
                pressed && feedback.pressed,
              ]}
              onPress={handleTwitter}
              accessibilityRole="button"
              accessibilityLabel="Share on X"
            >
              <Ionicons name="logo-twitter" size={24} color="#ffffff" />
            </Pressable>
          </View>

          {/* Shareable URL */}
          <View style={styles.urlSection}>
            <TextInput
              style={[styles.urlInput, typography.bodySmall]}
              value={shareUrl}
              readOnly
              selectTextOnFocus
              selectionColor={ACCENT}
              accessibilityLabel="Shareable URL"
            />
            <Pressable
              style={({ pressed }) => [
                styles.copyButton,
                pressed && feedback.pressed,
              ]}
              onPress={handleCopy}
              accessibilityRole="button"
              accessibilityLabel={copied ? "Link copied" : "Copy link"}
            >
              <Ionicons
                name={copied ? "checkmark-outline" : "copy-outline"}
                size={18}
                color="#ffffff"
              />
              <Text style={[styles.copyButtonText, typography.bodySmall]}>
                {copied ? "Copied!" : "Copy Link"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
    fontFamily: "System",
  },
  content: {
    flex: 1,
    paddingHorizontal: HORIZONTAL_PADDING,
  },

  // Preview card
  previewCard: {
    marginBottom: 32,
  },
  previewImage: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 12,
    marginBottom: 16,
  },
  previewTitle: {
    color: TEXT_PRIMARY,
    fontWeight: "700",
    fontFamily: "System",
    marginBottom: 8,
  },
  previewDescription: {
    color: TEXT_BODY,
    fontFamily: "System",
  },

  // Social buttons
  socialRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 32,
  },
  socialButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  facebookButton: {
    backgroundColor: "#1877F2",
  },
  twitterButton: {
    backgroundColor: "#000000",
  },

  // URL section
  urlSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  urlInput: {
    flex: 1,
    backgroundColor: SURFACE_COLOR,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    minHeight: 48,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: ACCENT,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
  },
  copyButtonText: {
    color: "#ffffff",
    fontWeight: "600",
    fontFamily: "System",
  },
})
