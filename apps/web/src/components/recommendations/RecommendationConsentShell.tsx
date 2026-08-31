"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { recommendationJsonWithDeadline } from "@/lib/recommendation-browser"
import {
  RECOMMENDATION_CONSENT_CHANGED_EVENT,
  RECOMMENDATION_CONSENT_CHANNEL,
  RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT,
} from "@/lib/recommendation-consent"
import { RECOMMENDATION_PROFILE_CONTRACT } from "@/lib/recommendation-contracts"
import { RecommendationRuntimeError } from "@/lib/recommendation-errors"
import { RECOMMENDATION_PROFILE_BROWSER_DEADLINE_MS } from "@/lib/recommendation-timeouts"
import {
  clearRecommendationWithdrawalPending,
  isRecommendationWithdrawalPending,
  markRecommendationWithdrawalPending,
} from "@/lib/recommendation-withdrawal-pending"
import { watchPath } from "@/lib/watch-paths"
import { RecommendationCookieBanner } from "./RecommendationCookieBanner"
import { RecommendationCookieSettings } from "./RecommendationCookieSettings"

const PROFILE_ENDPOINT = watchPath("/api/recommendations/profile")
type ConsentChoice = "undecided" | "essential_only" | "personalization"
type ConsentState = Readonly<{
  choice: ConsentChoice
  erasurePending: boolean
}>

function parseConsent(value: unknown): ConsentState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const profile = (value as { profile?: unknown }).profile
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null
  }
  const receipt = profile as Record<string, unknown>
  if (
    receipt.consentContractVersion !== "recommendation-consent-v1" ||
    (receipt.consentChoice !== "undecided" &&
      receipt.consentChoice !== "essential_only" &&
      receipt.consentChoice !== "personalization")
  ) {
    return null
  }
  return {
    choice: receipt.consentChoice,
    erasurePending:
      receipt.erasureState === "pending" || receipt.erasureState === "failed",
  }
}

export function RecommendationConsentShell() {
  const t = useTranslations("RecommendationConsent")
  const copy = {
    settings: t("settings"),
    loadError: t("loadError"),
    grantError: t("grantError"),
    saveError: t("saveError"),
  }
  const [state, setState] = useState<ConsentState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPersonalization, setSettingsPersonalization] = useState(true)
  const busyRef = useRef(false)
  const operationGenerationRef = useRef(0)
  const deferredRefreshRef = useRef(false)
  const withdrawalPendingRef = useRef(false)
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)
  const settingsWasOpenRef = useRef(false)
  const channelRef = useRef<BroadcastChannel | null>(null)

  const request = useCallback(
    async (action: "status" | "grant" | "withdraw") => {
      const value = await recommendationJsonWithDeadline(
        PROFILE_ENDPOINT,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contractVersion: RECOMMENDATION_PROFILE_CONTRACT,
            action,
          }),
        },
        RECOMMENDATION_PROFILE_BROWSER_DEADLINE_MS,
      )
      const parsed = parseConsent(value)
      if (!parsed) throw new RecommendationRuntimeError("profile_unavailable")
      return parsed
    },
    [],
  )

  const refresh = useCallback(async (): Promise<ConsentState | null> => {
    if (busyRef.current) {
      deferredRefreshRef.current = true
      return null
    }
    const generation = ++operationGenerationRef.current
    try {
      const observed = await request("status")
      if (generation !== operationGenerationRef.current || busyRef.current) {
        return null
      }
      withdrawalPendingRef.current =
        withdrawalPendingRef.current || isRecommendationWithdrawalPending()
      if (
        withdrawalPendingRef.current &&
        (observed.choice !== "essential_only" || observed.erasurePending)
      ) {
        // A failed or ambiguous withdrawal never re-enables personalized
        // serving merely because the last committed server receipt is still
        // visible. Keep the viewer locally closed while Save choices remains
        // available to retry the durable transition.
        setState({
          choice: "essential_only",
          erasurePending: true,
        })
        setSettingsPersonalization(false)
        return null
      }
      if (withdrawalPendingRef.current) {
        clearRecommendationWithdrawalPending()
      }
      withdrawalPendingRef.current = false
      setState(observed)
      setSettingsPersonalization(observed.choice !== "essential_only")
      setError(null)
      return observed
    } catch {
      if (generation === operationGenerationRef.current && !busyRef.current) {
        if (!withdrawalPendingRef.current) {
          setState({
            choice: "undecided",
            erasurePending: false,
          })
          setSettingsPersonalization(true)
        }
        setError(copy.loadError)
      }
      return null
    }
  }, [copy.loadError, request])

  useEffect(() => {
    withdrawalPendingRef.current = isRecommendationWithdrawalPending()
    if (withdrawalPendingRef.current) {
      setState({ choice: "essential_only", erasurePending: true })
      setSettingsPersonalization(false)
    }
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(RECOMMENDATION_CONSENT_CHANNEL)
    channelRef.current = channel
    channel.onmessage = (event) => {
      const data = event?.data
      const message =
        data && typeof data === "object" ? (data as { type?: unknown }) : null
      if (message?.type === "withdrawal_pending") {
        markRecommendationWithdrawalPending()
        withdrawalPendingRef.current = true
        operationGenerationRef.current += 1
        setState({ choice: "essential_only", erasurePending: true })
        setSettingsPersonalization(false)
        window.dispatchEvent(new Event(RECOMMENDATION_CONSENT_CHANGED_EVENT))
        window.dispatchEvent(new Event("forge:recommendation-profile-changed"))
      } else if (
        message?.type === "choice_changed" &&
        !isRecommendationWithdrawalPending()
      ) {
        // Another tab clears the shared marker only after a completed erasure
        // or confirmed fresh grant. Let the authoritative status refresh apply
        // that reduced-or-newly-granted state in this tab as well.
        withdrawalPendingRef.current = false
      }
      if (busyRef.current) {
        deferredRefreshRef.current = true
        return
      }
      void refresh().then((observed) => {
        if (!observed) return
        window.dispatchEvent(new Event(RECOMMENDATION_CONSENT_CHANGED_EVENT))
        window.dispatchEvent(new Event("forge:recommendation-profile-changed"))
      })
    }
    return () => {
      channelRef.current = null
      channel.close()
    }
  }, [refresh])

  const openSettings = useCallback(
    (trigger: HTMLButtonElement | null) => {
      returnFocusRef.current = trigger
      setSettingsPersonalization(state?.choice !== "essential_only")
      setError(null)
      setSettingsOpen(true)
    },
    [state?.choice],
  )

  useEffect(() => {
    const listener = (event: Event) =>
      openSettings(
        event instanceof CustomEvent &&
          event.detail instanceof HTMLButtonElement
          ? event.detail
          : null,
      )
    window.addEventListener(RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT, listener)
    return () =>
      window.removeEventListener(
        RECOMMENDATION_COOKIE_SETTINGS_OPEN_EVENT,
        listener,
      )
  }, [openSettings])

  const closeSettings = useCallback(() => {
    if (busy) return
    setSettingsOpen(false)
  }, [busy])

  useEffect(() => {
    if (settingsWasOpenRef.current && !settingsOpen) {
      returnFocusRef.current?.focus()
    }
    settingsWasOpenRef.current = settingsOpen
  }, [settingsOpen])

  const commit = useCallback(
    async (choice: Exclude<ConsentChoice, "undecided">) => {
      if (busyRef.current) return
      const withdrawing = choice === "essential_only"
      if (withdrawing) {
        markRecommendationWithdrawalPending()
        withdrawalPendingRef.current = true
        setState({ choice: "essential_only", erasurePending: true })
        setSettingsPersonalization(false)
        window.dispatchEvent(new Event(RECOMMENDATION_CONSENT_CHANGED_EVENT))
        window.dispatchEvent(new Event("forge:recommendation-profile-changed"))
        channelRef.current?.postMessage({
          type: "withdrawal_pending",
          choice: "essential_only",
        })
      }
      busyRef.current = true
      const generation = ++operationGenerationRef.current
      setBusy(true)
      setError(null)
      try {
        const next = await request(
          choice === "personalization" ? "grant" : "withdraw",
        )
        if (generation !== operationGenerationRef.current) return null
        if (
          !withdrawing &&
          (next.choice !== "personalization" || next.erasurePending)
        ) {
          throw new RecommendationRuntimeError("profile_unavailable")
        }
        const withdrawalStillPending =
          withdrawing &&
          (next.choice !== "essential_only" || next.erasurePending)
        if (withdrawalStillPending) {
          withdrawalPendingRef.current = true
          setState({ choice: "essential_only", erasurePending: true })
          setSettingsPersonalization(false)
        } else {
          clearRecommendationWithdrawalPending()
          withdrawalPendingRef.current = false
          setState(next)
          setSettingsPersonalization(next.choice !== "essential_only")
        }
        setSettingsOpen(false)
        window.dispatchEvent(new Event(RECOMMENDATION_CONSENT_CHANGED_EVENT))
        window.dispatchEvent(new Event("forge:recommendation-profile-changed"))
        channelRef.current?.postMessage(
          withdrawalStillPending
            ? { type: "withdrawal_pending", choice: "essential_only" }
            : { type: "choice_changed", choice: next.choice },
        )
        return next
      } catch {
        if (generation !== operationGenerationRef.current) return null
        if (choice === "personalization") {
          setError(copy.grantError)
        } else {
          // A network failure cannot prove whether the server committed the
          // erasure. Do not claim that it did. The visible surface still fails
          // closed immediately, and the pending state keeps a bounded retry
          // available through Save choices.
          setError(copy.saveError)
        }
        return null
      } finally {
        busyRef.current = false
        setBusy(false)
        if (deferredRefreshRef.current) {
          deferredRefreshRef.current = false
          void refresh()
        }
      }
    },
    [copy.grantError, copy.saveError, refresh, request],
  )

  const choice = state?.choice ?? "undecided"
  return (
    <>
      {state && choice === "undecided" && (
        <RecommendationCookieBanner
          busy={busy}
          error={error}
          onAcceptAll={() => void commit("personalization")}
          onEssentialOnly={() => void commit("essential_only")}
          onManage={openSettings}
        />
      )}
      <button
        type="button"
        onClick={(event) => openSettings(event.currentTarget)}
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] left-[calc(1rem+env(safe-area-inset-left,0px))] z-[45] rounded-full border border-stone-600 bg-stone-950/90 px-4 py-2 text-xs font-semibold text-stone-200 shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {copy.settings}
      </button>
      <RecommendationCookieSettings
        open={settingsOpen}
        personalization={settingsPersonalization}
        busy={busy}
        error={error}
        erasurePending={state?.erasurePending ?? false}
        onPersonalizationChange={setSettingsPersonalization}
        onSave={() =>
          void commit(
            settingsPersonalization ? "personalization" : "essential_only",
          )
        }
        onClose={closeSettings}
      />
    </>
  )
}
