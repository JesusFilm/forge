"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import Image from "next/image"
import {
  ArrowLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Facebook,
  Globe2,
  HelpCircle,
  Instagram,
  Scissors,
  Send,
  Share2,
  ShieldCheck,
  Youtube,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { reportGoogleAnalyticsEvent } from "@/components/GoogleAnalytics"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { env } from "@/env"
import {
  buildEmbedSnippet,
  buildFbShareUrl,
  buildXShareUrl,
  resolveWatchShareUrl,
} from "@/lib/share"
import { cn } from "@/lib/utils"
import { WatchModalViewportCloseButton } from "./WatchModalViewportCloseButton"

const USAGE_GUIDANCE_URL = "https://www.jesusfilm.org/about/faq/"
const LICENSING_REQUEST_URL =
  "https://form.asana.com/?k=qIsNe5Cu3-v5qriWHzwH8Q&d=657768513276"
const ANALYTICS_SURFACE = "watch_share_modal"

type ShareView =
  | "choose"
  | "social"
  | "facebook"
  | "youtube"
  | "instagram"
  | "direct"
  | "offline"
  | "website"
  | "embed"
  | "production"
type CopyStatus = "idle" | "copied" | "failed"
type LicensingReuseType = "native_social_upload" | "clip_reuse"
type ShareIntent =
  | "social_media"
  | "send_to_people"
  | "offline"
  | "website_or_production"
  | "facebook"
  | "youtube"
  | "instagram"
  | "website_embed"
  | "production_reuse"
type ShareResultView = Exclude<ShareView, "choose">

const PARENT_VIEW_BY_VIEW = {
  social: "choose",
  facebook: "social",
  youtube: "social",
  instagram: "social",
  direct: "choose",
  offline: "choose",
  website: "choose",
  embed: "website",
  production: "website",
} satisfies Record<ShareResultView, ShareView>

function reportLicensingClick(reuseType: LicensingReuseType) {
  reportGoogleAnalyticsEvent("watch_share_licensing_clicked", {
    reuse_type: reuseType,
    surface: ANALYTICS_SURFACE,
  })
}

export type ShareUsageGuidanceScope = "video" | "generic"

export type ShareModalProps = {
  open: boolean
  usageGuidanceScope: ShareUsageGuidanceScope
  videoSlug: string
  currentLanguageSlug: string
  videoTitle?: string | null
  videoDescription?: string | null
  posterUrl?: string | null
  playbackId?: string | null
  /** Opens the page-owned download flow without duplicating its access rules. */
  onDownload?: () => void
  onClose: () => void
}

export function ShareModal({
  open,
  usageGuidanceScope,
  videoSlug,
  currentLanguageSlug,
  videoTitle,
  videoDescription,
  posterUrl,
  playbackId,
  onDownload,
  onClose,
}: ShareModalProps) {
  const t = useTranslations("ShareModal")
  const [view, setView] = useState<ShareView>("choose")
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle")
  const [closePortalContainer, setClosePortalContainer] =
    useState<HTMLSpanElement | null>(null)
  const embedRef = useRef<HTMLTextAreaElement | null>(null)
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const mobileScrollRef = useRef<HTMLDivElement | null>(null)
  const desktopScrollRef = useRef<HTMLDivElement | null>(null)
  const hasReportedView = useRef(false)

  const shareableUrl = resolveWatchShareUrl({
    origin: env.NEXT_PUBLIC_CANONICAL_ORIGIN,
    videoSlug,
    languageSlug: currentLanguageSlug,
  })
  const embedSnippet = buildEmbedSnippet(playbackId)
  const fbHref = shareableUrl ? buildFbShareUrl(shareableUrl) : null
  const xHref = shareableUrl
    ? buildXShareUrl(shareableUrl, videoTitle ?? undefined)
    : null
  const activeView =
    view !== "choose"
      ? view
      : shareableUrl
        ? "choose"
        : embedSnippet
          ? "embed"
          : null

  useLayoutEffect(() => {
    if (!open || closePortalContainer === null) return
    if (activeView !== null) {
      if (mobileScrollRef.current) mobileScrollRef.current.scrollTop = 0
      if (desktopScrollRef.current) desktopScrollRef.current.scrollTop = 0
    }
    ;(activeView === null
      ? closeButtonRef.current
      : stepHeadingRef.current
    )?.focus()
  }, [activeView, closePortalContainer, open])

  useEffect(() => {
    if (!open) {
      hasReportedView.current = false
      return
    }
    if (
      hasReportedView.current ||
      usageGuidanceScope !== "video" ||
      (!shareableUrl && !embedSnippet)
    )
      return

    hasReportedView.current = true
    reportGoogleAnalyticsEvent("watch_share_guidance_viewed", {
      guidance_scope: "video",
      surface: ANALYTICS_SURFACE,
    })
  }, [embedSnippet, open, shareableUrl, usageGuidanceScope])

  useEffect(() => {
    if (copyStatus !== "copied") return
    const timer = window.setTimeout(() => setCopyStatus("idle"), 2000)
    return () => window.clearTimeout(timer)
  }, [copyStatus])

  function handleOpenChange(next: boolean) {
    if (next) return
    setView("choose")
    setCopyStatus("idle")
    onClose()
  }

  function choose(next: ShareView, intent?: ShareIntent) {
    setView(next)
    setCopyStatus("idle")
    if (intent) {
      reportGoogleAnalyticsEvent("watch_share_intent_selected", {
        intent,
        surface: ANALYTICS_SURFACE,
      })
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus("copied")
    } catch {
      setCopyStatus("failed")
    }
  }

  function openDownload() {
    if (!onDownload) return
    handleOpenChange(false)
    onDownload()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="watch-share-modal"
        className="w-full max-w-[min(94vw,1400px)] overflow-hidden rounded-[22px] border border-white/15 bg-[#111211] p-0 text-stone-100 shadow-2xl ring-0"
        overlayClassName="bg-black/90 supports-backdrop-filter:backdrop-blur-md"
        viewportClassName="fixed inset-0 z-50 grid place-items-center overflow-y-auto pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] sm:pt-[max(1.5rem,env(safe-area-inset-top))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pl-[max(1.5rem,env(safe-area-inset-left))]"
        showCloseButton={false}
        initialFocus={false}
      >
        <span ref={setClosePortalContainer} className="contents" />
        <WatchModalViewportCloseButton
          open={open && closePortalContainer !== null}
          onClose={() => handleOpenChange(false)}
          testId="watch-share-modal-close"
          buttonRef={closeButtonRef}
          ariaLabel={t("close")}
          portalContainer={closePortalContainer}
        />
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>

        <div
          ref={mobileScrollRef}
          data-testid="watch-share-modal-scroll"
          className="grid max-h-[92vh] min-h-0 overflow-y-auto lg:h-[min(90vh,850px)] lg:grid-cols-[465px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_auto] lg:overflow-hidden"
        >
          <aside className="relative flex items-start gap-4 border-b border-white/10 px-5 pt-14 pb-5 sm:px-8 lg:row-start-1 lg:block lg:border-b-0 lg:pt-[66px] lg:pr-12 lg:pb-11 lg:pl-[60px] lg:after:absolute lg:after:top-[66px] lg:after:right-0 lg:after:bottom-11 lg:after:w-px lg:after:bg-white/10">
            <div
              data-testid="watch-share-modal-poster"
              className="relative aspect-[3/2] w-28 shrink-0 overflow-hidden rounded-xl bg-stone-800 sm:w-44 lg:aspect-[1.47] lg:w-full lg:rounded-[18px]"
            >
              {posterUrl ? (
                <Image
                  src={posterUrl}
                  alt={videoTitle ?? t("posterAlt")}
                  fill
                  sizes="(min-width: 1024px) 345px, 112px"
                  className="object-cover"
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1 lg:mt-6">
              {videoTitle ? (
                <h2
                  data-testid="watch-share-modal-title"
                  className="text-xl leading-[1.08] font-bold tracking-tight text-white sm:text-2xl lg:text-[44px]"
                >
                  {videoTitle}
                </h2>
              ) : null}
              {videoDescription ? (
                <p
                  data-testid="watch-share-modal-description"
                  className="mt-3 hidden text-sm leading-6 text-stone-300 sm:line-clamp-2 lg:mt-5 lg:block lg:line-clamp-4 lg:text-base lg:leading-7"
                >
                  {videoDescription}
                </p>
              ) : null}
              {usageGuidanceScope === "video" ? (
                <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-stone-300 lg:mt-7 lg:gap-4 lg:text-sm lg:leading-6">
                  <ShieldCheck
                    aria-hidden
                    className="mt-0.5 h-5 w-5 shrink-0 text-stone-400 lg:h-6 lg:w-6"
                  />
                  <span>{t("permissionNote")}</span>
                </div>
              ) : null}
            </div>
          </aside>

          <main className="flex min-h-0 flex-col px-5 pt-5 pb-5 sm:px-8 lg:row-start-1 lg:max-h-[92vh] lg:px-[52px] lg:pt-[104px] lg:pb-9">
            <div
              ref={desktopScrollRef}
              data-testid="watch-share-modal-step-scroll"
              className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-2"
            >
              {activeView === "choose" ? (
                <Chooser
                  usageGuidanceScope={usageGuidanceScope}
                  hasEmbed={Boolean(embedSnippet)}
                  onChoose={choose}
                  headingRef={stepHeadingRef}
                />
              ) : activeView ? (
                <ResultView
                  view={activeView}
                  shareableUrl={shareableUrl}
                  embedSnippet={embedSnippet}
                  fbHref={fbHref}
                  xHref={xHref}
                  copyStatus={copyStatus}
                  usageGuidanceScope={usageGuidanceScope}
                  onBack={
                    view === "choose"
                      ? undefined
                      : () => choose(PARENT_VIEW_BY_VIEW[view])
                  }
                  onChoose={choose}
                  onCopy={copy}
                  onDownload={onDownload ? openDownload : undefined}
                  embedRef={embedRef}
                  headingRef={stepHeadingRef}
                />
              ) : null}
            </div>
          </main>

          {activeView === "choose" ? (
            <div className="border-t border-white/10 px-5 py-3 text-center sm:px-8 lg:col-span-2 lg:row-start-2 lg:mx-[60px] lg:px-0 lg:py-5">
              <a
                href={USAGE_GUIDANCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="watch-share-modal-unsure"
                className="inline-flex min-h-11 items-center gap-3 rounded-md px-3 font-semibold text-brand-red hover:underline focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              >
                <HelpCircle aria-hidden className="h-5 w-5 text-stone-300" />
                {t("unsure")}
                <span className="sr-only"> ({t("opensInNewTab")})</span>
                <ExternalLink aria-hidden className="h-4 w-4" />
              </a>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Chooser({
  usageGuidanceScope,
  hasEmbed,
  onChoose,
  headingRef,
}: {
  usageGuidanceScope: ShareUsageGuidanceScope
  hasEmbed: boolean
  onChoose: (view: ShareView, intent?: ShareIntent) => void
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  const t = useTranslations("ShareModal")
  const rows: Array<{
    view: ShareView
    nextView: ShareView
    intent: ShareIntent
    title: string
    description: string
    icon: LucideIcon
  }> = [
    {
      view: "social" as const,
      nextView: "social" as const,
      intent: "social_media",
      title: t("socialTitle"),
      description: t("socialDescription"),
      icon: Share2,
    },
    {
      view: "direct" as const,
      nextView: "direct" as const,
      intent: "send_to_people",
      title: t("directTitle"),
      description: t("directDescription"),
      icon: Send,
    },
    ...(usageGuidanceScope === "video"
      ? [
          {
            view: "offline" as const,
            nextView: "offline" as const,
            intent: "offline" as const,
            title: t("offlineTitle"),
            description: t("offlineDescription"),
            icon: Download,
          },
          {
            view: "website" as const,
            nextView: "website" as const,
            intent: "website_or_production" as const,
            title: t("websiteTitle"),
            description: hasEmbed
              ? t("websiteDescription")
              : t("productionReuseDescription"),
            icon: Code2,
          },
        ]
      : []),
  ]

  return (
    <section aria-labelledby="share-chooser-heading">
      <h2
        ref={headingRef}
        id="share-chooser-heading"
        tabIndex={-1}
        className="max-w-4xl text-2xl leading-tight font-bold tracking-tight text-white outline-none sm:text-4xl lg:text-[36px]"
      >
        {usageGuidanceScope === "video"
          ? t("chooserHeading")
          : t("genericChooserHeading")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-stone-300 sm:mt-3 sm:text-lg sm:leading-7">
        {t("chooserDescription")}
      </p>
      <div className="mt-5 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.03] sm:mt-7">
        {rows.map(
          (
            { view, nextView, intent, title, description, icon: Icon },
            index,
          ) => (
            <button
              key={view}
              type="button"
              data-testid={`watch-share-modal-choice-${view}`}
              onClick={() => onChoose(nextView, intent)}
              className={cn(
                "group flex min-h-[92px] w-full cursor-pointer items-center gap-3 px-4 text-left transition hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-red focus-visible:outline-none sm:min-h-[118px] sm:gap-5 sm:px-8",
                index > 0 && "border-t border-white/10",
              )}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-stone-100 sm:h-14 sm:w-14">
                <Icon aria-hidden className="h-6 w-6 sm:h-7 sm:w-7" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base leading-5 font-bold text-white sm:text-xl sm:leading-6">
                  {title}
                </span>
                <span className="mt-1 block text-xs leading-4 text-stone-300 sm:text-base sm:leading-5">
                  {description}
                </span>
              </span>
              <ChevronRight
                aria-hidden
                className="h-7 w-7 shrink-0 text-white transition group-hover:translate-x-1"
              />
            </button>
          ),
        )}
      </div>
    </section>
  )
}

function ResultView({
  view,
  shareableUrl,
  embedSnippet,
  fbHref,
  xHref,
  copyStatus,
  usageGuidanceScope,
  onBack,
  onChoose,
  onCopy,
  onDownload,
  embedRef,
  headingRef,
}: {
  view: ShareResultView
  shareableUrl: string | null
  embedSnippet: string
  fbHref: string | null
  xHref: string | null
  copyStatus: CopyStatus
  usageGuidanceScope: ShareUsageGuidanceScope
  onBack?: () => void
  onChoose: (view: ShareView, intent?: ShareIntent) => void
  onCopy: (text: string) => Promise<void>
  onDownload?: () => void
  embedRef: React.RefObject<HTMLTextAreaElement | null>
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  const t = useTranslations("ShareModal")
  const headings = {
    social: t("socialHeading"),
    facebook: t("facebookHeading"),
    youtube: t("youtubeHeading"),
    instagram: t("instagramHeading"),
    direct: t("directHeading"),
    offline: t("offlineHeading"),
    website: t("websiteHeading"),
    embed: t("embedHeading"),
    production: t("productionHeading"),
  } satisfies Record<Exclude<ShareView, "choose">, string>
  const descriptions = {
    social: t("socialDescription"),
    facebook: t("facebookStepDescription"),
    youtube: t("youtubeStepDescription"),
    instagram: t("instagramStepDescription"),
    direct: t("directStepDescription"),
    offline: t("offlineStepDescription"),
    website: t("websiteDescription"),
    embed: t("embedDescription"),
    production: t("productionStepDescription"),
  } satisfies Record<Exclude<ShareView, "choose">, string>

  useLayoutEffect(() => {
    if (view !== "embed") return
    const fit = () => {
      const element = embedRef.current
      if (!element) return
      element.style.height = "auto"
      const height = Math.min(element.scrollHeight, window.innerHeight * 0.28)
      element.style.height = `${height}px`
      element.style.overflowY =
        element.scrollHeight > height ? "auto" : "hidden"
    }
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [embedRef, embedSnippet, view])

  return (
    <section aria-labelledby="share-result-heading" className="pb-2">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          data-testid="watch-share-modal-back"
          className="mb-6 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md pr-3 text-sm font-bold text-stone-300 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        >
          <ArrowLeft aria-hidden className="h-5 w-5" />
          {t("back")}
        </button>
      ) : null}
      <h2
        ref={headingRef}
        id="share-result-heading"
        tabIndex={-1}
        className="text-3xl leading-tight font-bold tracking-tight text-white outline-none sm:text-4xl"
      >
        {headings[view]}
      </h2>
      <p className="mt-3 max-w-3xl text-base leading-7 text-stone-300">
        {descriptions[view]}
      </p>

      {view === "social" && usageGuidanceScope === "video" ? (
        <div className="mt-7 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.03]">
          <PlatformChoice
            icon={Facebook}
            title="Facebook"
            description={t("facebookDescription")}
            testId="facebook"
            onClick={() => onChoose("facebook", "facebook")}
          />
          <PlatformChoice
            icon={Youtube}
            title="YouTube"
            description={t("youtubeDescription")}
            testId="youtube"
            onClick={() => onChoose("youtube", "youtube")}
          />
          <PlatformChoice
            icon={Instagram}
            title="Instagram"
            description={t("youtubeDescription")}
            testId="instagram"
            onClick={() => onChoose("instagram", "instagram")}
          />
        </div>
      ) : null}

      {view === "social" && usageGuidanceScope === "generic" ? (
        <DirectShareActions
          shareableUrl={shareableUrl}
          fbHref={fbHref}
          xHref={xHref}
          copyStatus={copyStatus}
          onCopy={onCopy}
        />
      ) : null}

      {view === "website" ? (
        <div className="mt-7 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.03]">
          {embedSnippet ? (
            <PlatformChoice
              icon={Globe2}
              title={t("embedWebsiteTitle")}
              description={t("embedWebsiteDescription")}
              testId="embed"
              onClick={() => onChoose("embed", "website_embed")}
            />
          ) : null}
          <PlatformChoice
            icon={Scissors}
            title={t("productionReuseTitle")}
            description={t("productionReuseDescription")}
            testId="production"
            onClick={() => onChoose("production", "production_reuse")}
          />
        </div>
      ) : null}

      {view === "facebook" && fbHref ? (
        <div className="mt-7 space-y-5">
          <LinkCopyCard
            value={shareableUrl ?? ""}
            copyStatus={copyStatus}
            onCopy={onCopy}
          />
          <a
            href={fbHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="watch-share-modal-facebook"
            className="inline-flex min-h-12 items-center gap-3 rounded-full bg-[#1877F2] px-6 font-bold text-white transition hover:bg-[#0c63d4] focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            <Facebook aria-hidden className="h-5 w-5 fill-current" />
            {t("shareOnFacebook")}
            <span className="sr-only"> ({t("opensInNewTab")})</span>
            <ExternalLink aria-hidden className="h-4 w-4" />
          </a>
          <LicensingCard reuseType="native_social_upload" />
        </div>
      ) : null}

      {view === "youtube" || view === "instagram" ? (
        <div className="mt-7 space-y-5">
          {shareableUrl ? (
            <LinkCopyCard
              value={shareableUrl}
              copyStatus={copyStatus}
              onCopy={onCopy}
            />
          ) : null}
          <LicensingCard reuseType="native_social_upload" />
        </div>
      ) : null}

      {view === "direct" ? (
        <DirectShareActions
          shareableUrl={shareableUrl}
          fbHref={fbHref}
          xHref={xHref}
          copyStatus={copyStatus}
          onCopy={onCopy}
        />
      ) : null}

      {view === "offline" ? (
        <div className="mt-7 space-y-5">
          {onDownload ? (
            <Button
              variant="pill"
              onClick={onDownload}
              data-testid="watch-share-modal-open-download"
              className="gap-2 px-7 py-4 text-sm"
            >
              <Download aria-hidden className="h-5 w-5" />
              {t("openDownloadOptions")}
            </Button>
          ) : null}
          <GuidanceLink label={t("viewUsageGuidance")} />
        </div>
      ) : null}

      {view === "embed" && embedSnippet ? (
        <div className="mt-7 space-y-4">
          <CopyStatus status={copyStatus} />
          <textarea
            ref={embedRef}
            readOnly
            value={embedSnippet}
            aria-label={t("embedCodeTab")}
            data-testid="watch-share-modal-embed-input"
            onFocus={(event) => event.currentTarget.select()}
            className="w-full resize-none rounded-2xl border border-white/15 bg-white/5 px-5 py-4 font-mono text-xs leading-5 text-stone-100 focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:outline-none"
          />
          <Button
            variant="pill"
            data-testid="watch-share-modal-embed-copy"
            onClick={() => onCopy(embedSnippet)}
            className="gap-2 px-7 py-4 text-sm"
          >
            <Copy aria-hidden className="h-4 w-4" />
            {copyStatus === "copied" ? t("copied") : t("copyCode")}
          </Button>
        </div>
      ) : null}

      {view === "production" ? (
        <div className="mt-7">
          <LicensingCard reuseType="clip_reuse" />
        </div>
      ) : null}
    </section>
  )
}

function DirectShareActions({
  shareableUrl,
  fbHref,
  xHref,
  copyStatus,
  onCopy,
}: {
  shareableUrl: string | null
  fbHref: string | null
  xHref: string | null
  copyStatus: CopyStatus
  onCopy: (text: string) => Promise<void>
}) {
  const t = useTranslations("ShareModal")
  return (
    <div className="mt-7 space-y-5">
      {shareableUrl ? (
        <LinkCopyCard
          value={shareableUrl}
          copyStatus={copyStatus}
          onCopy={onCopy}
        />
      ) : null}
      {fbHref && xHref ? (
        <div className="flex flex-wrap gap-3">
          <a
            href={fbHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="watch-share-modal-direct-facebook"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#1877F2] px-5 font-bold text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            <Facebook aria-hidden className="h-4 w-4 fill-current" />
            Facebook
            <span className="sr-only"> ({t("opensInNewTab")})</span>
          </a>
          <a
            href={xHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="watch-share-modal-x"
            className="inline-flex min-h-11 items-center rounded-full bg-white px-5 font-bold text-black focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            {t("shareOnX")}
            <span className="sr-only"> ({t("opensInNewTab")})</span>
          </a>
        </div>
      ) : null}
    </div>
  )
}

function PlatformChoice({
  icon: Icon,
  title,
  description,
  testId,
  onClick,
}: {
  icon: LucideIcon
  title: string
  description: string
  testId: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={`watch-share-modal-platform-${testId}`}
      onClick={onClick}
      className="group flex min-h-[104px] w-full cursor-pointer items-center gap-5 border-b border-white/10 px-5 text-left transition last:border-b-0 hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-red focus-visible:outline-none sm:px-8"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10">
        <Icon aria-hidden className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold text-white">{title}</span>
        <span className="mt-1 block text-sm leading-5 text-stone-300">
          {description}
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="h-6 w-6 transition group-hover:translate-x-1"
      />
    </button>
  )
}

function CopyStatus({ status }: { status: CopyStatus }) {
  const t = useTranslations("ShareModal")
  return (
    <>
      <p
        aria-live="polite"
        role="status"
        className="sr-only"
        data-testid="watch-share-modal-copy-status"
      >
        {status === "copied"
          ? t("copied")
          : status === "failed"
            ? t("copyFailed")
            : ""}
      </p>
      {status === "failed" ? (
        <p
          className="text-sm font-semibold text-amber-400"
          data-testid="watch-share-modal-link-fallback"
        >
          {t("copyFailed")}
        </p>
      ) : null}
    </>
  )
}

function LinkCopyCard({
  value,
  copyStatus,
  onCopy,
}: {
  value: string
  copyStatus: CopyStatus
  onCopy: (text: string) => Promise<void>
}) {
  const t = useTranslations("ShareModal")
  return (
    <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-4 sm:p-5">
      <CopyStatus status={copyStatus} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          readOnly
          value={value}
          aria-label={t("shareLinkTab")}
          data-testid="watch-share-modal-link-input"
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-4 text-sm font-semibold text-stone-100 focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:outline-none"
        />
        <Button
          variant="pill"
          data-testid="watch-share-modal-link-copy"
          onClick={() => onCopy(value)}
          className="gap-2 px-6 py-4 text-sm"
        >
          <Copy aria-hidden className="h-4 w-4" />
          {copyStatus === "copied" ? t("copied") : t("copyLink")}
        </Button>
      </div>
    </div>
  )
}

function LicensingCard({ reuseType }: { reuseType: LicensingReuseType }) {
  const t = useTranslations("ShareModal")
  const isNative = reuseType === "native_social_upload"
  const label = isNative ? t("nativeSocialUpload") : t("clipReuse")
  return (
    <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-5">
      <div className="flex items-start gap-4">
        <ShieldCheck
          aria-hidden
          className="mt-0.5 h-6 w-6 shrink-0 text-stone-300"
        />
        <div>
          <h3 className="font-bold text-white">{label}</h3>
          <p className="mt-1 text-sm leading-6 text-stone-300">
            {t("licensingFormDescription")}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-5 pl-10">
        <GuidanceLink label={t("viewUsageGuidance")} />
        <a
          href={LICENSING_REQUEST_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={
            isNative
              ? "watch-share-modal-native-upload-guidance"
              : "watch-share-modal-clip-reuse-guidance"
          }
          onClick={() => reportLicensingClick(reuseType)}
          className="inline-flex min-h-11 items-center gap-2 font-bold text-brand-red hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        >
          {t("openLicensingForm")}
          <span className="sr-only"> ({t("opensInNewTab")})</span>
          <ExternalLink aria-hidden className="h-4 w-4" />
        </a>
      </div>
    </div>
  )
}

function GuidanceLink({ label }: { label: string }) {
  const t = useTranslations("ShareModal")
  return (
    <a
      href={USAGE_GUIDANCE_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="watch-share-modal-screening-guidance"
      className="inline-flex min-h-11 items-center gap-2 font-bold text-brand-red hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
    >
      {label}
      <span className="sr-only"> ({t("opensInNewTab")})</span>
      <ExternalLink aria-hidden className="h-4 w-4" />
    </a>
  )
}
