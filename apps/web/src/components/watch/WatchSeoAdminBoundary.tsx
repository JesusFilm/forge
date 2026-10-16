"use client"

import dynamic from "next/dynamic"
import { useEffect, useId, useState } from "react"

import type {
  SeoPanelState,
  WatchSeoMarketingData,
} from "@/components/watch/seo/types"
import { WatchSeoTab } from "@/components/watch/seo/WatchSeoTab"
import { subscribeToWatchAccountSession } from "@/lib/watch-account-session-signal"

const SeoMarketingPanel = dynamic(
  () =>
    import("@/components/watch/seo/SeoMarketingPanel").then((module) => ({
      default: module.SeoMarketingPanel,
    })),
  { ssr: false },
)

const CAPABILITY_CACHE_KEY = "watch-seo-capability-v1"
const CAPABILITY_CACHE_TTL_MS = 30_000

function readCapabilityCache(): boolean | null {
  try {
    const raw = sessionStorage.getItem(CAPABILITY_CACHE_KEY)
    if (!raw) return null
    const entry = JSON.parse(raw) as { allowed?: unknown; expiresAt?: unknown }
    if (
      typeof entry.allowed !== "boolean" ||
      typeof entry.expiresAt !== "number" ||
      entry.expiresAt <= Date.now()
    ) {
      sessionStorage.removeItem(CAPABILITY_CACHE_KEY)
      return null
    }
    return entry.allowed
  } catch {
    return null
  }
}

function writeCapabilityCache(allowed: boolean): void {
  try {
    sessionStorage.setItem(
      CAPABILITY_CACHE_KEY,
      JSON.stringify({
        allowed,
        expiresAt: Date.now() + CAPABILITY_CACHE_TTL_MS,
      }),
    )
  } catch {
    // Storage can be unavailable; authorization remains correct without it.
  }
}

type EvidenceEnvelope = {
  data: WatchSeoMarketingData
  adminOrigin: string
  adminConfirmationUrl: string
}

export function WatchSeoAdminBoundary({
  videoSlug,
  locale,
  languageSlug,
  contextualParentSlug,
}: {
  videoSlug: string
  locale: string
  languageSlug: string
  contextualParentSlug?: string | null
}) {
  const generatedId = useId().replaceAll(":", "")
  const tabId = `watch-seo-tab-${generatedId}`
  const panelId = `watch-seo-panel-${generatedId}`
  const [authorized, setAuthorized] = useState(false)
  const [selected, setSelected] = useState(false)
  const [panelState, setPanelState] = useState<SeoPanelState>({
    status: "loading",
  })
  const [envelope, setEnvelope] = useState<EvidenceEnvelope | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let controller: AbortController | null = null
    let settled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const probeCapability = async (): Promise<void> => {
      controller?.abort()
      controller = new AbortController()
      try {
        const response = await fetch("/watch/api/watch-seo/capability", {
          credentials: "same-origin",
          headers: { accept: "application/json" },
          signal: controller.signal,
        })
        if (response.status === 429) {
          setAuthorized(false)
          const retryAfter = Number(response.headers.get("retry-after"))
          const delaySeconds = Number.isFinite(retryAfter)
            ? Math.max(1, retryAfter)
            : 60
          retryTimer = setTimeout(
            () => void probeCapability(),
            delaySeconds * 1000,
          )
          return
        }
        const body = response.ok
          ? ((await response.json()) as { canViewWatchSeo?: unknown })
          : null
        const allowed = body?.canViewWatchSeo === true
        writeCapabilityCache(allowed)
        setAuthorized(allowed)
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return
        setAuthorized(false)
      }
    }

    const unsubscribe = subscribeToWatchAccountSession((signal) => {
      if (signal.status !== "authenticated") {
        settled = false
        setAuthorized(false)
        if (retryTimer) clearTimeout(retryTimer)
        try {
          sessionStorage.removeItem(CAPABILITY_CACHE_KEY)
        } catch {
          // Ignore unavailable storage.
        }
        return
      }
      if (settled) return
      settled = true
      const cached = readCapabilityCache()
      if (cached !== null) {
        setAuthorized(cached)
        return
      }
      void probeCapability()
    })
    return () => {
      unsubscribe()
      controller?.abort()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [contextualParentSlug, languageSlug, locale, videoSlug])

  useEffect(() => {
    if (!authorized || !selected) return
    const controller = new AbortController()
    const params = new URLSearchParams({ videoSlug, locale, languageSlug })
    if (contextualParentSlug) {
      params.set("contextualParentSlug", contextualParentSlug)
    }
    void fetch(`/watch/api/watch-seo/page?${params}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Watch SEO evidence unavailable")
        return (await response.json()) as EvidenceEnvelope
      })
      .then((nextEnvelope) => {
        if (
          !nextEnvelope?.data ||
          nextEnvelope.data.schemaVersion !== "watch-seo-marketing-v1" ||
          !nextEnvelope.adminOrigin ||
          !nextEnvelope.adminConfirmationUrl
        ) {
          throw new Error("Invalid Watch SEO evidence")
        }
        setEnvelope(nextEnvelope)
        setPanelState({ status: "ready", data: nextEnvelope.data })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setEnvelope(null)
        setPanelState({ status: "error" })
      })
    return () => controller.abort()
  }, [
    attempt,
    authorized,
    contextualParentSlug,
    languageSlug,
    locale,
    selected,
    videoSlug,
  ])

  if (!authorized) return null

  const selectTab = () => {
    if (selected) return
    setEnvelope(null)
    setPanelState({ status: "loading" })
    setSelected(true)
  }

  const retry = () => {
    setEnvelope(null)
    setPanelState({ status: "loading" })
    setAttempt((value) => value + 1)
  }

  return (
    <section data-testid="watch-seo-admin-boundary" className="min-w-0">
      <div role="tablist" aria-label="Admin page tools">
        <WatchSeoTab
          id={tabId}
          panelId={panelId}
          selected={selected}
          onSelect={selectTab}
        />
      </div>
      {selected ? (
        <div className="mt-4">
          <SeoMarketingPanel
            id={panelId}
            labelledBy={tabId}
            state={panelState}
            adminOrigin={envelope?.adminOrigin ?? ""}
            adminConfirmationUrl={envelope?.adminConfirmationUrl ?? ""}
            onRetry={retry}
          />
        </div>
      ) : null}
    </section>
  )
}
