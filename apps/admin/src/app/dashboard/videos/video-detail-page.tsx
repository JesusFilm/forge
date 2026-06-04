import type { ReactNode } from "react"
import type { Route } from "next"
import Link from "next/link"
import { ArrowLeft, ExternalLink } from "lucide-react"
import type {
  VideoLibraryDetail,
  VideoLibraryDetailField,
  VideoLibraryDetailSection,
} from "../live-data"

type VideoDetailPageProps = {
  backHref: Route
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
        <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
          {title}
        </h2>
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}

function DetailList({
  labels,
  section,
}: {
  labels: VideoDetailPageProps["labels"]
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
              <div className="min-w-0 text-[14px] font-semibold text-[var(--color-text-primary)]">
                {item.title}
              </div>
              {item.meta ? (
                <div className="mt-1 break-words font-mono text-[12px] text-[var(--color-text-muted)]">
                  {item.meta}
                </div>
              ) : null}
              {item.detail ? (
                <div className="mt-2 break-words text-[13px] leading-5 text-[var(--color-text-secondary)]">
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

export function VideoDetailPage({
  backHref,
  detail,
  labels,
}: VideoDetailPageProps) {
  return (
    <article className="flex min-w-0 flex-col gap-5">
      <header className="grid min-w-0 gap-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="label-text mb-1">{labels.eyebrow}</div>
            <h1
              id="video-detail-title"
              className="text-3xl font-semibold leading-tight text-[var(--color-text-primary)]"
            >
              {detail.title}
            </h1>
          </div>
          <Link
            href={backHref}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 self-start rounded-sm border border-[var(--color-hairline)] px-3 font-mono text-[11px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            {labels.close}
          </Link>
        </div>

        <div className="relative aspect-video w-full overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          {detail.previewImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={detail.previewImageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-[13px] text-[var(--color-text-muted)]">
              {detail.duration}
            </div>
          )}
        </div>

        <div className="min-w-0 border-b border-[var(--color-hairline)] pb-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[13px] text-[var(--color-text-muted)]">
            <span>{detail.label}</span>
            <span aria-hidden="true">/</span>
            <span>{detail.source}</span>
            <span aria-hidden="true">/</span>
            <span>{detail.duration}</span>
          </div>
          {detail.description ? (
            <p className="mt-3 max-w-5xl text-[15px] leading-6 text-[var(--color-text-secondary)]">
              {detail.description}
            </p>
          ) : null}
          {detail.visitorUrl ? (
            <a
              href={detail.visitorUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-sm border border-[var(--color-hairline)] px-3 font-mono text-[11px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
              {labels.openVisitor}
            </a>
          ) : null}
        </div>
      </header>

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
    </article>
  )
}
