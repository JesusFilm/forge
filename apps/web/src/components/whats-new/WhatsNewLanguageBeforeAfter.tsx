import Image from "next/image"
import Link from "next/link"
import { ArrowUpRight, MousePointer2 } from "lucide-react"

import { ENGLISH_ASSIST_COPY } from "@/components/watch-language-inventory/english-assist"
import {
  WHATS_NEW_BEFORE_AFTER,
  type WhatsNewBeforeAfterLink,
} from "@/components/whats-new/whats-new-content"
import {
  asContentSlug,
  asLocaleSlug,
  languageInventoryPath,
  watchVideoPath,
} from "@/lib/routes"

const ARABIC = asLocaleSlug("arabic-modern-standard")
const JESUS = asContentSlug("jesus")

const LINK_CLASS =
  "inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-white/70 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white hover:decoration-white/70 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-4"

/**
 * The two on-site destinations resolve through `src/lib/routes.ts` rather
 * than being written out as strings in the copy, so a change to the watch
 * URL shape moves them with everything else. Only the Internet Archive
 * link is a literal — it is off-site and pinned to one capture.
 */
function SectionLink({ link }: { link: WhatsNewBeforeAfterLink }) {
  const body = (
    <>
      {link.label}
      <ArrowUpRight aria-hidden className="size-3.5" />
    </>
  )

  if (link.kind === "archive") {
    return (
      <a
        href={link.href}
        data-testid="whats-new-before-after-link"
        className={LINK_CLASS}
        rel="noreferrer"
        target="_blank"
      >
        {body}
      </a>
    )
  }

  // Kept inside this branch rather than hoisted above the archive case:
  // typed routes reject a `string` widened out of a ternary that also
  // holds the off-site URL.
  const href =
    link.kind === "video"
      ? watchVideoPath(JESUS, ARABIC)
      : languageInventoryPath(ARABIC)

  return (
    <Link
      href={href}
      data-testid="whats-new-before-after-link"
      className={LINK_CLASS}
    >
      {body}
    </Link>
  )
}

/**
 * One panel of the comparison: a real screenshot of the page, its badge,
 * and the caption arguing from it.
 *
 * The screenshot is the evidence, so it is never recoloured — no
 * desaturation on the 2016 panel, no accent tint on the current one. The
 * only thing distinguishing them at a glance is the badge, and the shots
 * themselves (a white 2016 layout against a dark current one).
 */
function Panel({
  panel,
  bodyClass,
}: {
  panel: (typeof WHATS_NEW_BEFORE_AFTER.panels)[number]
  bodyClass: string
}) {
  const isAfter = panel.id === "after"

  return (
    <figure
      data-testid="whats-new-before-after-panel"
      data-panel={panel.id}
      className="flex min-w-0 flex-col"
    >
      <figcaption className="order-2 mt-6 space-y-4">
        <p className={bodyClass}>{panel.note}</p>
        <SectionLink link={panel.link} />
      </figcaption>

      <div className="order-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className={`rounded-full border px-3 py-1 text-[0.6875rem] font-semibold tracking-[0.2em] uppercase tabular-nums ${
              isAfter
                ? "border-red-100/40 bg-red-100/10 text-red-100"
                : "border-white/15 bg-white/5 text-white/55"
            }`}
          >
            {panel.badge}
          </span>
          <span className="text-[0.6875rem] tracking-[0.18em] text-white/40 uppercase">
            {panel.badgeNote}
          </span>
        </div>
        <h3 className="mt-4 text-lg font-semibold tracking-[-0.01em] text-balance text-white sm:text-xl">
          {panel.title}
        </h3>

        {/* Both shots are the same pixel size, so the two panels line up
            without an aspect box cropping either of them. */}
        <div
          data-testid="whats-new-before-after-shot"
          className="mt-5 overflow-hidden rounded-2xl border border-white/12 bg-stone-950"
        >
          <Image
            src={panel.shot.src}
            alt={panel.shot.alt}
            width={panel.shot.width}
            height={panel.shot.height}
            quality={94}
            sizes="(min-width: 1024px) 46vw, 92vw"
            className="h-auto w-full"
          />
        </div>
      </div>
    </figure>
  )
}

/**
 * Live demonstration of the shipped English-assist tooltip.
 *
 * These are REAL `title` attributes and the English text is imported from
 * `ENGLISH_ASSIST_COPY` — the same constant the language inventory
 * renders — so this cannot describe a tooltip the product no longer has.
 *
 * A native `title` is not announced on keyboard focus in most browsers,
 * so the English is also carried in a visually hidden span. That is not
 * cheating the demonstration: the pairing IS the point, and a reader who
 * cannot hover should still receive it.
 */
function AssistChips() {
  const { dir, lang, rows } = WHATS_NEW_BEFORE_AFTER.missionaries

  return (
    <ul
      data-testid="whats-new-assist-chips"
      className="mt-6 flex flex-wrap gap-2.5"
    >
      {rows.map((row) => (
        <li key={row.token}>
          <span
            data-testid="whats-new-assist-chip"
            title={ENGLISH_ASSIST_COPY[row.token]}
            className="inline-flex cursor-help rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm text-white/85 underline decoration-dotted decoration-white/40 underline-offset-4 transition-colors hover:border-white/35 hover:bg-white/10 hover:text-white hover:decoration-white/80"
          >
            {/* `dir` as well as `lang`: an Arabic label dropped into this
                left-to-right page without it reorders its own digits and
                punctuation, which would be an unfortunate thing to get
                wrong in the paragraph arguing that direction matters. */}
            <span dir={dir} lang={lang}>
              {row.label}
            </span>
            <span className="sr-only"> — {ENGLISH_ASSIST_COPY[row.token]}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * "Before and after" — the language argument made with one real page.
 *
 * Server-rendered with no client component and no images: the page it
 * lives on already carries five screenshots and a scroll-driven stage, so
 * this section is deliberately built from markup and a native `title`
 * attribute rather than adding hydration or bytes to it.
 */
export function WhatsNewLanguageBeforeAfter({
  bodyClass,
  contentClass,
  eyebrowClass,
  headingClass,
  listClass,
}: {
  bodyClass: string
  contentClass: string
  eyebrowClass: string
  headingClass: string
  listClass: string
}) {
  const { dualLanguage, missionaries, seekers } = WHATS_NEW_BEFORE_AFTER

  return (
    <section
      id="language"
      aria-labelledby="whats-new-before-after-heading"
      data-testid="whats-new-before-after"
      className="relative border-t border-white/10 scroll-mt-24 md:scroll-mt-32"
    >
      <div className={`${contentClass} py-16 sm:py-20 lg:py-24`}>
        <header className="max-w-3xl">
          <p className={eyebrowClass}>{WHATS_NEW_BEFORE_AFTER.eyebrow}</p>
          <h2
            id="whats-new-before-after-heading"
            className={`mt-4 ${headingClass}`}
          >
            {WHATS_NEW_BEFORE_AFTER.heading}
          </h2>
          <div className="mt-6 space-y-5">
            {WHATS_NEW_BEFORE_AFTER.intro.map((paragraph) => (
              <p key={paragraph} className={bodyClass}>
                {paragraph}
              </p>
            ))}
          </div>
        </header>

        {/* The address both panels share, stated once above them — it is
            the part of the comparison that did NOT change. */}
        <p
          data-testid="whats-new-before-after-address"
          className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 lg:mt-12"
        >
          <span className="text-[0.6875rem] font-semibold tracking-[0.22em] text-white/45 uppercase">
            {WHATS_NEW_BEFORE_AFTER.addressLabel}
          </span>
          <span className="min-w-0 rounded-full border border-white/12 bg-white/5 px-4 py-1.5 font-mono text-xs break-all text-white/75">
            {WHATS_NEW_BEFORE_AFTER.address}
          </span>
        </p>

        <div
          aria-label={WHATS_NEW_BEFORE_AFTER.mockLabel}
          role="group"
          className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-14"
        >
          {WHATS_NEW_BEFORE_AFTER.panels.map((panel) => (
            <Panel key={panel.id} panel={panel} bodyClass={bodyClass} />
          ))}
        </div>

        {/* Why the change is better for the 98% */}
        <div className="mt-16 max-w-3xl lg:mt-24">
          <p className={eyebrowClass}>{seekers.eyebrow}</p>
          <h3 className="mt-4 text-2xl leading-tight font-semibold tracking-[-0.02em] text-balance text-white sm:text-3xl">
            {seekers.heading}
          </h3>
          <div className="mt-6 space-y-5">
            {seekers.paragraphs.map((paragraph) => (
              <p key={paragraph} className={bodyClass}>
                {paragraph}
              </p>
            ))}
          </div>
          <ul className={`mt-6 ${listClass}`}>
            {seekers.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <p className={`mt-6 ${bodyClass}`}>{seekers.closing}</p>
        </div>

        {/* ...and the 2% */}
        <aside
          data-testid="whats-new-assist"
          className="mt-14 rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm lg:mt-20 lg:p-10"
        >
          <div className="max-w-3xl">
            <p className={eyebrowClass}>{missionaries.eyebrow}</p>
            <h3 className="mt-4 text-2xl leading-tight font-semibold tracking-[-0.02em] text-balance text-white sm:text-3xl">
              {missionaries.heading}
            </h3>
            <div className="mt-6 space-y-5">
              {missionaries.paragraphs.map((paragraph) => (
                <p key={paragraph} className={bodyClass}>
                  {paragraph}
                </p>
              ))}
            </div>
          </div>

          <p className="mt-8 flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.22em] text-red-100/70 uppercase">
            <MousePointer2 aria-hidden className="size-3.5" />
            {missionaries.hint}
          </p>
          <AssistChips />

          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-white/65 sm:text-base sm:leading-7">
            {missionaries.footnote}
          </p>
          <div className="mt-5">
            <SectionLink link={missionaries.link} />
          </div>

          {/* Direction, kept visually subordinate to the shipped tooltip
              above it so the two are not read as one promise. */}
          <div
            data-testid="whats-new-dual-language"
            className="mt-8 border-t border-white/10 pt-8"
          >
            <p className="text-[0.6875rem] font-semibold tracking-[0.22em] text-white/45 uppercase">
              {dualLanguage.eyebrow}
            </p>
            <h4 className="mt-3 text-lg font-semibold text-white sm:text-xl">
              {dualLanguage.heading}
            </h4>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/70 sm:text-base sm:leading-7">
              {dualLanguage.body}
            </p>
          </div>
        </aside>
      </div>
    </section>
  )
}
