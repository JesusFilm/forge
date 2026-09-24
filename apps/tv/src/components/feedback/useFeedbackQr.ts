import Constants from "expo-constants"
import * as SecureStore from "expo-secure-store"
import { useEffect, useMemo, useState } from "react"
import { Platform } from "react-native"
import qrcode from "qrcode-generator"

import { feedbackUrl, type FeedbackContext } from "../../lib/feedbackUrl"
import {
  attestAppleFeedbackGrant,
  attestFeedbackGrant,
} from "../../../modules/tv-feedback-integrity"

const CACHE_KEY = "watch-feedback-verified-qr"

export type VerifiedQr = {
  feedbackUrl: string
  referenceCode: string
  expiresAt: string
  serverTime: string
}

async function requestJson<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`feedback_${response.status}`)
  return response.json() as Promise<T>
}

export function useFeedbackQr(
  enabled: boolean,
  context: Pick<
    FeedbackContext,
    "screen" | "player" | "filmTitle" | "timestamp"
  >,
) {
  const [verified, setVerified] = useState<VerifiedQr | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const base = process.env.EXPO_PUBLIC_TV_FEEDBACK_URL
  const project = process.env.EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER

  useEffect(() => {
    if (!enabled) {
      setVerified(null)
      setLoading(false)
      setError(false)
      return
    }
    if (!base || (Platform.OS === "android" && !project)) {
      setLoading(false)
      setError(true)
      return
    }
    let active = true
    const origin = new URL(base).origin
    const load = async () => {
      setLoading(true)
      setError(false)
      setVerified(null)
      try {
        const cached = await SecureStore.getItemAsync(CACHE_KEY)
        if (cached) {
          const value = JSON.parse(cached) as VerifiedQr
          const secret = new URL(value.feedbackUrl).hash.replace(/^#grant=/, "")
          if (Date.parse(value.expiresAt) > Date.now() && secret) {
            const status = await requestJson<{ active: boolean }>(
              `${origin}/api/feedback/tv/status`,
              { secret },
            )
            if (status.active) {
              if (active) setVerified(value)
              return
            }
          }
        }
        const challenge = await requestJson<{
          challengeId: string
          nonce: string
          utcDay: string
        }>(`${origin}/api/feedback/tv/challenge`, {})
        const attestation =
          Platform.OS === "android"
            ? await attestFeedbackGrant(
                challenge.challengeId,
                challenge.nonce,
                challenge.utcDay,
                project ?? "",
              )
            : await attestAppleFeedbackGrant(
                challenge.challengeId,
                challenge.nonce,
                challenge.utcDay,
              )
        const grant = await requestJson<VerifiedQr>(
          `${origin}/api/feedback/tv/${Platform.OS === "android" ? "grants" : "apple-grants"}`,
          { challengeId: challenge.challengeId, ...attestation },
        )
        await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(grant))
        if (active) setVerified(grant)
      } catch {
        if (active) setError(true)
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [enabled, retry, base, project])

  useEffect(() => {
    if (!enabled || !verified) return
    const remaining = Date.parse(verified.expiresAt) - Date.now()
    const timer = setTimeout(
      () => {
        setVerified(null)
        setRetry((value) => value + 1)
      },
      Math.max(1000, remaining),
    )
    return () => clearTimeout(timer)
  }, [enabled, verified])

  const url = useMemo(() => {
    if (!enabled || !verified || !base) return null
    const contextUrl = feedbackUrl(base, {
      platform: Platform.OS === "ios" ? "apple-tv" : "android-tv",
      appVersion: Constants.expoConfig?.version,
      build:
        Platform.OS === "ios"
          ? Constants.expoConfig?.ios?.buildNumber
          : String(Constants.expoConfig?.android?.versionCode ?? ""),
      ...context,
    })
    if (!contextUrl) return null
    const link = new URL(verified.feedbackUrl)
    link.search = new URL(contextUrl).search
    return link.toString()
  }, [
    verified,
    enabled,
    base,
    context.screen,
    context.player,
    context.filmTitle,
    context.timestamp,
  ])

  const qr = useMemo(() => {
    if (!url) return null
    const code = qrcode(0, "L")
    code.addData(url)
    code.make()
    const modules = code.getModuleCount()
    return {
      rows: Array.from({ length: modules }, (_, row) =>
        Array.from({ length: modules }, (_, col) => code.isDark(row, col)),
      ),
      modules,
    }
  }, [url])

  return {
    verified,
    loading,
    error,
    url,
    qr,
    retry: () => setRetry((value) => value + 1),
  }
}
