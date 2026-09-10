"use client"

import Image from "next/image"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react"
import { useTranslations } from "next-intl"
import { z } from "zod"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { formatDuration } from "@/lib/format-duration"
import { watchPath } from "@/lib/watch-paths"
import { isCanonicalWatchRecommendationHref } from "@/lib/routes"
import {
  randomRecommendationNonce,
  recommendationEventId,
  recommendationJsonWithRetry,
} from "@/lib/recommendation-browser"
import {
  waitForRecommendationConsentBootstrap,
  withRecommendationConsentLock,
} from "@/lib/recommendation-consent-bootstrap"
import {
  RECOMMENDATION_EVIDENCE_CONTRACT,
  RECOMMENDATION_TAB_CORRELATION_KEY,
  parseRecommendationEvidenceReceipts,
} from "@/lib/recommendation-contracts"
import { useEligibleRecommendationImpression } from "./useEligibleRecommendationImpression"

const DELIVERY_COOLDOWN_MS = 5_000
const SURFACE = "watch-for-you-v1"
const Item = z.object({
  id: z.string(),
  position: z.number().int(),
  targetMediaId: z.string(),
  canonicalHref: z.string().refine(isCanonicalWatchRecommendationHref),
  capability: z.string().min(1),
  videoTitle: z.string(),
  imageUrl: z.string().url(),
  durationSeconds: z.number().nullable(),
})
const Envelope = z.object({
  delivery: z.object({
    contractVersion: z.literal("user-recommendation-v1"),
    surfaceVersion: z.literal(SURFACE),
    result: z.string(),
    reason: z.string().nullable(),
    requestId: z.string().nullable(),
    items: z.array(Item).max(6),
  }),
})
type Delivery = z.infer<typeof Envelope>["delivery"]
type Card = z.infer<typeof Item>

export function WatchForYouRecommendations({
  locale,
  audioLanguageSlug,
  title,
  sectionKey,
  navigate = (href: string) => window.location.assign(href),
}: {
  locale: string
  audioLanguageSlug: string
  title?: string | null
  sectionKey?: string | null
  navigate?: (href: string) => void
}) {
  const t = useTranslations("WatchHome")
  const errors = useTranslations("ExperienceError")
  const root = useRef<HTMLElement>(null)
  const [near, setNear] = useState(false)
  const [revision, setRevision] = useState(0)
  const key = `${locale}:${audioLanguageSlug}:${revision}`
  const [state, setState] = useState<{
    key: string
    delivery?: Delivery
    failed?: boolean
    disabled?: boolean
  }>({ key })
  const current = state.key === key ? state : { key }
  const delivery = current.delivery
  const selection = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const navigating = useRef(false)
  const ledger = useRef(new Set<string>())

  useEffect(() => {
    alive.current = true
    if (!root.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: "300px" },
    )
    observer.observe(root.current)
    return () => {
      alive.current = false
      observer.disconnect()
      selection.current?.abort()
    }
  }, [])
  useEffect(() => {
    const refresh = () => {
      selection.current?.abort()
      selection.current = null
      navigating.current = false
      setRevision((value) => value + 1)
    }
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) refresh()
    }
    const leave = () => selection.current?.abort()
    window.addEventListener("pagehide", leave)
    window.addEventListener("pageshow", restore)
    window.addEventListener("forge:recommendation-profile-changed", refresh)
    return () => {
      window.removeEventListener("pagehide", leave)
      window.removeEventListener("pageshow", restore)
      window.removeEventListener(
        "forge:recommendation-profile-changed",
        refresh,
      )
    }
  }, [])
  useEffect(() => {
    if (!near) return
    const controller = new AbortController()
    selection.current?.abort()
    selection.current = null
    navigating.current = false
    ledger.current.clear()
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const load = async (retryAdmission: boolean) => {
      await waitForRecommendationConsentBootstrap()
      if (controller.signal.aborted) return
      const value = await withRecommendationConsentLock(() =>
        recommendationJsonWithRetry(
          watchPath("/api/recommendations/for-you"),
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ locale, audioLanguageSlug }),
          },
          2200,
        ),
      )
      if (controller.signal.aborted) return
      const parsed = Envelope.safeParse(value)
      if (!parsed.success) {
        setState({ key, failed: true })
        return
      }
      const result = parsed.data.delivery
      if (
        retryAdmission &&
        result.result === "unavailable" &&
        (result.reason === "cooldown" || result.reason === "in_flight")
      ) {
        retryTimer = setTimeout(() => {
          void load(false).catch(failed)
        }, DELIVERY_COOLDOWN_MS)
        return
      }
      if (result.reason === "environment_disabled") {
        setState({ key, disabled: true })
        return
      }
      if (
        result.result !== "served" ||
        result.items.length !== 6 ||
        !result.requestId ||
        new Set(result.items.map((item) => item.targetMediaId)).size !== 6 ||
        result.items.some((item, index) => item.position !== index)
      ) {
        setState({ key, failed: true })
        return
      }
      setState({ key, delivery: result })
    }
    const failed = () => {
      if (!controller.signal.aborted) setState({ key, failed: true })
    }
    void load(true).catch(failed)
    return () => {
      controller.abort()
      clearTimeout(retryTimer)
    }
  }, [near, key, locale, audioLanguageSlug])

  const evidence = useCallback(
    (item: Card, kind: "render" | "impression") => {
      if (!delivery?.requestId) return
      const ledgerKey = `${delivery.requestId}:${item.id}:${kind}`
      if (ledger.current.has(ledgerKey)) return
      ledger.current.add(ledgerKey)
      const eventId = recommendationEventId(kind, item.id)
      void recommendationJsonWithRetry(
        watchPath("/api/recommendations/evidence"),
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contractVersion: RECOMMENDATION_EVIDENCE_CONTRACT,
            requestId: delivery.requestId,
            itemId: item.id,
            capability: item.capability,
            events: [
              {
                eventId,
                kind,
                occurredAt: new Date().toISOString(),
                payload:
                  kind === "impression"
                    ? { visibilityPolicy: SURFACE }
                    : { surfacePolicy: SURFACE },
              },
            ],
          }),
        },
        5000,
        {
          accept: (value) =>
            parseRecommendationEvidenceReceipts(value, new Set([eventId]))?.[0]
              ?.status !== undefined,
        },
      ).catch(() => undefined)
    },
    [delivery],
  )
  useEffect(() => {
    delivery?.items.forEach((item) => evidence(item, "render"))
  }, [delivery, evidence])
  const eligible = useCallback(
    (id: string) => {
      const item = delivery?.items.find((item) => item.id === id)
      if (item) evidence(item, "impression")
    },
    [delivery, evidence],
  )
  const cardRef = useEligibleRecommendationImpression({
    envelopeKey: delivery?.requestId ?? key,
    onEligible: eligible,
  })

  function select(item: Card, event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    event.preventDefault()
    if (selection.current || navigating.current || !delivery?.requestId) return
    const controller = new AbortController()
    selection.current = controller
    const claimNonce = randomRecommendationNonce()
    try {
      sessionStorage.setItem(RECOMMENDATION_TAB_CORRELATION_KEY, claimNonce)
    } catch {
      /* Playback still opens without tab storage. */
    }
    void recommendationJsonWithRetry(
      watchPath("/api/recommendations/select"),
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractVersion: RECOMMENDATION_EVIDENCE_CONTRACT,
          requestId: delivery.requestId,
          itemId: item.id,
          capability: item.capability,
          eventId: recommendationEventId("selection", item.id),
          occurredAt: new Date().toISOString(),
          tabNonce: claimNonce,
          claimNonce,
        }),
      },
      800,
    )
      .catch(() => undefined)
      .then(() => {
        if (
          !alive.current ||
          controller.signal.aborted ||
          selection.current !== controller ||
          navigating.current
        )
          return
        navigating.current = true
        navigate(item.canonicalHref)
      })
  }
  if (current.disabled) return null
  return (
    <section
      ref={root}
      data-block-type="HomepageRecommendations"
      data-section-key={sectionKey ?? undefined}
      data-state={
        delivery ? "ready" : current.failed ? "unavailable" : "loading"
      }
      aria-labelledby="watch-for-you-heading"
      aria-busy={!delivery && !current.failed}
      className={`${WATCH_PAGE_CONTENT_CLASSES} relative py-12 text-white`}
    >
      <h2
        id="watch-for-you-heading"
        className="mb-6 text-2xl font-bold tracking-tight md:text-3xl"
      >
        {title?.trim() || t("forYou")}
      </h2>
      {current.failed ? (
        <div
          role="status"
          className="flex min-h-48 flex-col items-start justify-center gap-4"
        >
          <p className="text-white/70">{errors("pageLoadFailed")}</p>
          <button
            onClick={() => setRevision((value) => value + 1)}
            className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            {errors("tryAgain")}
          </button>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-3 md:grid md:grid-cols-3 xl:grid-cols-6">
          {delivery
            ? delivery.items.map((item) => (
                <a
                  key={item.id}
                  ref={(node) => cardRef(item.id, node)}
                  href={item.canonicalHref}
                  onClick={(event) => select(item, event)}
                  className="group block w-64 shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white md:w-auto"
                >
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-white/10">
                    <Image
                      src={item.imageUrl}
                      alt=""
                      fill
                      sizes="(min-width:1280px) 16vw, (min-width:768px) 30vw, 256px"
                      loading="lazy"
                      className="object-cover transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none"
                    />
                    {item.durationSeconds != null && (
                      <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs tabular-nums">
                        {formatDuration(item.durationSeconds)}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 line-clamp-2 min-h-12 text-base font-semibold leading-6">
                    {item.videoTitle}
                  </h3>
                </a>
              ))
            : Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  aria-hidden
                  className="w-64 shrink-0 md:w-auto"
                >
                  <div className="aspect-video rounded-lg bg-white/10" />
                  <div className="mt-3 h-12 rounded bg-white/5" />
                </div>
              ))}
        </div>
      )}
    </section>
  )
}
