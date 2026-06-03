"use client"

import type { KeyboardEvent, ReactNode } from "react"
import type { Route } from "next"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import { ExternalLink, X } from "lucide-react"
import { cx } from "@/components/admin-ui"
import type {
  VideoLibraryDetail,
  VideoLibraryDetailField,
  VideoLibraryDetailSection,
} from "../live-data"

type VideoDetailModalProps = {
  closeHref: Route
  detail: VideoLibraryDetail
  labels: {
    close: string
    count: string
    eyebrow: string
    openVisitor: string
  }
}

function countLabel(template: string, count: number) {
  return template.replace("{count}", count.toLocaleString("en"))
}

function FieldGrid({ fields }: { fields: VideoLibraryDetailField[] }) {
  if (fields.length === 0) return null

  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {fields.map((field) => (
        <div
          key={`${field.label}-${field.value}`}
          className="min-w-0 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2"
        >
          <dt className="label-text text-[10px]">{field.label}</dt>
          <dd className="mt-1 break-words font-mono text-[11px] text-[var(--color-text-secondary)]">
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function DetailPanel({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <section className="min-w-0 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)]">
      <div className="border-b border-[var(--color-hairline)] px-4 py-3">
        <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          {title}
        </h3>
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}

function DetailList({
  labels,
  section,
}: {
  labels: VideoDetailModalProps["labels"]
  section: VideoLibraryDetailSection
}) {
  return (
    <DetailPanel title={section.title}>
      <div className="mb-3 font-mono text-[11px] text-[var(--color-text-muted)]">
        {countLabel(labels.count, section.count ?? section.items.length)}
      </div>
      {section.items.length > 0 ? (
        <ul className="divide-y divide-[var(--color-hairline)]">
          {section.items.map((item) => (
            <li key={item.key} className="py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 text-[13px] font-semibold text-[var(--color-text-primary)]">
                {item.title}
              </div>
              {item.meta ? (
                <div className="mt-1 break-words font-mono text-[11px] text-[var(--color-text-muted)]">
                  {item.meta}
                </div>
              ) : null}
              {item.detail ? (
                <div className="mt-2 break-words text-[12px] leading-5 text-[var(--color-text-secondary)]">
                  {item.detail}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-[12px] text-[var(--color-text-muted)]">
          {section.empty}
        </div>
      )}
    </DetailPanel>
  )
}

export function VideoDetailModal({
  closeHref,
  detail,
  labels,
}: VideoDetailModalProps) {
  const router = useRouter()
  const closeRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.setTimeout(() => closeRef.current?.focus(), 0)

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  function closeModal() {
    router.push(closeHref)
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      closeModal()
      return
    }

    if (event.key !== "Tab") return

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute("disabled"))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-3 backdrop-blur-sm sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-detail-title"
        className="flex max-h-[min(920px,calc(100vh-2rem))] w-full max-w-6xl flex-col overflow-hidden rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-bg)] shadow-2xl"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-hairline)] px-4 py-4 sm:px-5">
          <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
            <div className="relative aspect-video overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]">
              {detail.previewImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={detail.previewImageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center font-mono text-[11px] text-[var(--color-text-muted)]">
                  {detail.duration}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="label-text mb-1">{labels.eyebrow}</div>
              <h2
                id="video-detail-title"
                className="truncate text-xl font-semibold text-[var(--color-text-primary)]"
              >
                {detail.title}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-[var(--color-text-muted)]">
                <span>{detail.label}</span>
                <span aria-hidden="true">/</span>
                <span>{detail.source}</span>
                <span aria-hidden="true">/</span>
                <span>{detail.duration}</span>
              </div>
              {detail.description ? (
                <p className="mt-3 max-w-3xl text-[13px] leading-5 text-[var(--color-text-secondary)]">
                  {detail.description}
                </p>
              ) : null}
              {detail.visitorUrl ? (
                <a
                  href={detail.visitorUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex h-8 items-center gap-2 rounded-sm border border-[var(--color-hairline)] px-3 font-mono text-[11px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {labels.openVisitor}
                </a>
              ) : null}
            </div>
          </div>

          <Link
            ref={closeRef}
            href={closeHref}
            aria-label={labels.close}
            title={labels.close}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </Link>
        </header>

        <div
          className={cx(
            "min-h-0 overflow-y-auto px-4 py-4 sm:px-5",
            "[scrollbar-width:thin]",
          )}
          tabIndex={0}
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <DetailPanel title="Identity">
                <FieldGrid fields={detail.identity} />
              </DetailPanel>
              <DetailPanel title="Status">
                <FieldGrid fields={detail.status} />
              </DetailPanel>
              <DetailPanel title="Timestamps">
                <FieldGrid fields={detail.timestamps} />
              </DetailPanel>
              <DetailList labels={labels} section={detail.parents} />
              <DetailList labels={labels} section={detail.children} />
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <DetailList labels={labels} section={detail.localizedContent} />
              <DetailList labels={labels} section={detail.dubs} />
              <DetailList labels={labels} section={detail.images} />
              <DetailList labels={labels} section={detail.subtitles} />
              <DetailList labels={labels} section={detail.studyQuestions} />
              <DetailList labels={labels} section={detail.bibleCitations} />
              <DetailList labels={labels} section={detail.keywords} />
              <DetailList labels={labels} section={detail.technical} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
