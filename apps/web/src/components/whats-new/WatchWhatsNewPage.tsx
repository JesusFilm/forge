import type { CSSProperties } from "react"
import Image from "next/image"
import {
  Compass,
  Globe2,
  Handshake,
  House,
  Info,
  MessagesSquare,
  PlayCircle,
  Projector,
  Search,
  Send,
  Share2,
  Videotape,
  type LucideIcon,
} from "lucide-react"

import { WatchHomeFooter } from "@/components/home/WatchHomeFooter"
import { WhatsNewFeedbackButton } from "@/components/whats-new/WhatsNewFeedbackButton"
import { WhatsNewFaq } from "@/components/whats-new/WhatsNewFaq"
import { WhatsNewFeatureVote } from "@/components/whats-new/WhatsNewFeatureVote"
import { WhatsNewFormatDiagram } from "@/components/whats-new/WhatsNewFormatDiagram"
import { WhatsNewAudienceQuiz } from "@/components/whats-new/WhatsNewAudienceQuiz"
import { WhatsNewIceberg } from "@/components/whats-new/WhatsNewIceberg"
import { WhatsNewLanguageSwitcher } from "@/components/whats-new/WhatsNewLanguageSwitcher"
import {
  WHATS_NEW_AUDIENCES,
  WHATS_NEW_CLOSING,
  WHATS_NEW_CONTENTS,
  WHATS_NEW_DIRECTIONS,
  WHATS_NEW_ERAS,
  WHATS_NEW_FAQ,
  WHATS_NEW_HERO,
  WHATS_NEW_IMPROVEMENTS,
  WHATS_NEW_LANGUAGE_SWITCHER,
  WHATS_NEW_LEDE,
  WHATS_NEW_TEAM,
  type WhatsNewIconKey,
} from "@/components/whats-new/whats-new-content"
import { WatchStructuredData } from "@/components/watch/WatchStructuredData"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import type { WatchLanguageInventorySwitcherLanguage } from "@/lib/watch-language-inventory"

// Watch's editorial type + surface tokens, mirrored from WatchHomePromo and
// the `Text` promotional variant so this page reads as part of the same
// site rather than a bolted-on microsite.
const EYEBROW_CLASS =
  "text-xs font-semibold tracking-[0.3em] text-red-100/70 uppercase sm:text-sm"
const SECTION_HEADING_CLASS =
  "text-3xl leading-[1.1] font-semibold tracking-[-0.025em] text-balance text-white sm:text-4xl lg:text-5xl"
const BODY_CLASS = "text-base leading-8 text-white/76 sm:text-lg sm:leading-9"
// Hairline dash bullets — same treatment as the markdown `ul` in
// `src/components/sections/Text.tsx`.
const HAIRLINE_LIST_CLASS =
  "grid list-none gap-3 text-base leading-7 text-white/78 sm:text-lg [&>li]:relative [&>li]:pl-5 [&>li]:before:absolute [&>li]:before:top-[0.78em] [&>li]:before:left-0 [&>li]:before:h-px [&>li]:before:w-2.5 [&>li]:before:bg-red-100/60"
const SECONDARY_CTA_CLASS =
  "inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/25 bg-white/5 px-7 text-sm font-bold tracking-wider text-white uppercase backdrop-blur-sm transition-colors duration-200 hover:border-white/50 hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-4 sm:px-9"
const HERO_GRADIENT_CLASS =
  "bg-[linear-gradient(135deg,rgba(69,10,29,0.92),rgba(30,15,60,0.72)_45%,rgba(234,88,12,0.18))]"
const ACCENT_GRADIENT_CLASS =
  "bg-[linear-gradient(135deg,rgba(69,10,29,0.6),rgba(88,28,135,0.2),rgba(234,88,12,0.1))]"

const ICONS: Record<WhatsNewIconKey, LucideIcon> = {
  compass: Compass,
  share: Share2,
  handshake: Handshake,
  projector: Projector,
  videotape: Videotape,
  search: Search,
  conversation: MessagesSquare,
  home: House,
  play: PlayCircle,
  globe: Globe2,
  send: Send,
}

/**
 * Repeating grain used across Watch's promotional surfaces. Already shipped
 * and cached site-wide, so it costs no new request here.
 */
/**
 * Scroll ranges for one era, as CSS custom properties.
 *
 * Emitted per-index rather than computed in CSS: `animation-range` accepts
 * a custom property substituted as whole tokens, which is far more robust
 * than `calc()` inside a range, and it keeps the slice arithmetic in one
 * readable place.
 *
 * `recede` for the last era starts past the end of the stage, so the final
 * card never dims — it is what the reader is left looking at. The last
 * beat's range likewise runs past 100% so its fade-out never plays.
 */
/**
 * Share of the stage's scroll given to the opening zoom, before the first
 * era's own slice begins. The lead photograph fills the viewport for this
 * long and then pulls back into its card.
 */
const ERA_INTRO_SHARE = 16
const ERA_INTRO_RANGE = `contain 0% contain ${ERA_INTRO_SHARE.toFixed(2)}%`

function eraRanges(index: number) {
  const count = WHATS_NEW_ERAS.length
  const slice = (100 - ERA_INTRO_SHARE) / count
  const start = ERA_INTRO_SHARE + index * slice
  const settled = start + slice * 0.55
  const isLast = index === count - 1

  const depth = count - 1 - index

  return {
    card: {
      "--layer": index + 1,
      // Resting place in the pile: cards that receded earlier sit further
      // back, so their top edges stay visible above the front card.
      //
      // The lift has to out-run the shrink. Scaling down from the centre
      // pushes a card's top edge DOWN by roughly half the height it loses
      // (~15px per depth step here), so a 1.15rem lift left only a 4px
      // peek. 1.9rem nets ~15px of visible edge per card in the pile.
      "--sink-y": `${(depth * -1.9).toFixed(2)}rem`,
      "--sink-scale": (1 - depth * 0.045).toFixed(3),
      "--enter-range": `contain ${start.toFixed(2)}% contain ${settled.toFixed(2)}%`,
      // Each card keeps sinking for the rest of the stage rather than
      // snapping to its final depth the moment the next one lands — that
      // is what makes the pile look like it is forming.
      "--recede-range": isLast
        ? "contain 120% contain 130%"
        : `contain ${settled.toFixed(2)}% contain 100%`,
    } as CSSProperties,
    beat: {
      "--beat-range": `contain ${start.toFixed(2)}% contain ${(isLast ? 100 + slice : start + slice).toFixed(2)}%`,
    } as CSSProperties,
    year: {
      "--year-range": `contain ${Math.max(0, start - slice * 0.15).toFixed(2)}% contain ${(start + slice * 0.3).toFixed(2)}%`,
    } as CSSProperties,
  }
}

function NoiseOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-[url(/watch/images/overlay.svg)] bg-repeat opacity-45 mix-blend-multiply"
    />
  )
}

function ImprovementBody({
  item,
}: {
  item: (typeof WHATS_NEW_IMPROVEMENTS)[number]
}) {
  return (
    <div className="min-w-0 space-y-5">
      {item.paragraphs.map((paragraph) => (
        <p key={paragraph} className={BODY_CLASS}>
          {paragraph}
        </p>
      ))}
      {item.points.length > 0 && (
        <ul className={`pt-1 ${HAIRLINE_LIST_CLASS}`}>
          {item.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
      {"closing" in item && item.closing ? (
        <p className={`pt-1 ${BODY_CLASS}`}>{item.closing}</p>
      ) : null}
    </div>
  )
}

export function WatchWhatsNewPage({
  languageSlug,
  languages,
}: {
  languageSlug: string
  languages: WatchLanguageInventorySwitcherLanguage[]
}) {
  const languageSwitcher = (
    <WhatsNewLanguageSwitcher
      allLanguagesLabel={WHATS_NEW_LANGUAGE_SWITCHER.allLanguages}
      currentSlug={languageSlug}
      label={WHATS_NEW_LANGUAGE_SWITCHER.label}
      languages={languages}
    />
  )

  const faqJsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: WHATS_NEW_FAQ.items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  })

  return (
    <>
      <WatchStructuredData json={faqJsonLd} />
      <main className="relative bg-black font-sans text-white">
        {/* Hero */}
        <section
          aria-labelledby="whats-new-title"
          className={`relative isolate overflow-hidden ${HERO_GRADIENT_CLASS}`}
        >
          <NoiseOverlay />
          {/* Merge the wash into the black page body. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-black"
          />
          <div
            className={`${WATCH_PAGE_CONTENT_CLASSES} relative pt-[calc(8rem+env(safe-area-inset-top,0px))] pb-20 md:pt-[calc(11rem+env(safe-area-inset-top,0px))] md:pb-28`}
          >
            <p className={EYEBROW_CLASS}>{WHATS_NEW_HERO.eyebrow}</p>
            <h1
              id="whats-new-title"
              className="mt-5 max-w-[22ch] text-4xl leading-[1.04] font-semibold tracking-[-0.03em] text-balance text-white sm:text-5xl lg:text-6xl xl:text-7xl"
            >
              {WHATS_NEW_HERO.title}
            </h1>
            <p className="mt-6 max-w-[54ch] text-lg leading-8 text-white/82 sm:text-xl sm:leading-9">
              {WHATS_NEW_HERO.deck}
            </p>
            <div className="mt-10 flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:gap-8">
              {languageSwitcher}
              <WhatsNewFeedbackButton
                label={WHATS_NEW_HERO.feedbackCta}
                className={SECONDARY_CTA_CLASS}
              />
            </div>
            <nav
              aria-label="On this page"
              className="mt-12 border-t border-white/12 pt-6"
            >
              <ul className="flex flex-wrap gap-x-6 gap-y-3">
                {WHATS_NEW_CONTENTS.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={`#${entry.id}`}
                      className="text-xs font-semibold tracking-[0.16em] text-white/60 uppercase underline decoration-white/20 underline-offset-[6px] transition-colors hover:text-white hover:decoration-white/70 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                    >
                      {entry.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </section>

        {/* The shift — editorial lede */}
        <section
          aria-labelledby="whats-new-lede-heading"
          className={`${WATCH_PAGE_CONTENT_CLASSES} py-16 sm:py-20 lg:py-24`}
        >
          {/* Header only. The opening paragraph now lives inside the stage
              as the first era's beat, directly above the card it
              describes. */}
          <header className="max-w-4xl">
            <p className={EYEBROW_CLASS}>{WHATS_NEW_LEDE.eyebrow}</p>
            <h2
              id="whats-new-lede-heading"
              className={`mt-4 ${SECTION_HEADING_CLASS}`}
            >
              {WHATS_NEW_LEDE.heading}
            </h2>
          </header>

          {/* Delivery-era stage.

              A tall section with a sticky pin inside it: the card stack
              holds still while the page scrolls past, cards slide up and
              stack on top of each other, the beat below cross-fades with
              them, and the year rail tracks progress. When the stage runs
              out, the pin releases and the page scrolls on normally.

              All of it is CSS scroll-driven (`animation-timeline`) reading
              one named timeline off the stage — see the guarded block in
              globals.css. Without support, or under prefers-reduced-motion,
              the cards never leave the flow: the whole thing renders as a
              plain vertical list of card-then-beat, fully visible. */}
          <section
            aria-label="Delivery eras"
            data-testid="whats-new-eras"
            /* `md:mt-44` is load-bearing, not rhythm: before the pin
               engages, the opening card reaches a measured 143px above the
               stage's own top edge — the pin's 104px sticky offset plus the
               overshoot the zoom's lift is deliberately given. This margin
               is the only thing keeping it off the heading above; tighten it
               and the photograph crosses the heading on the way in. */
            className="watch-scroll-stage relative mt-16 md:mt-44"
            style={
              {
                "--era-count": WHATS_NEW_ERAS.length,
                "--intro-range": ERA_INTRO_RANGE,
              } as CSSProperties
            }
          >
            <div className="watch-scroll-pin relative isolate flex flex-col gap-5 sm:gap-8 lg:gap-10">
              {/* Year milestones, replacing the old bullet nodes. */}
              <ol
                data-testid="whats-new-year-rail"
                className="watch-scroll-intro-veil relative z-10 flex items-center justify-between gap-2 border-t border-white/10 pt-4"
              >
                <span
                  aria-hidden
                  className="watch-scroll-year-fill absolute -top-px left-0 h-px w-full bg-gradient-to-r from-white/50 to-red-100/80"
                />
                {WHATS_NEW_ERAS.map((era, index) => (
                  <li
                    key={era.year}
                    data-testid="whats-new-year"
                    className="watch-scroll-year text-xs font-semibold tracking-[0.2em] text-white uppercase tabular-nums sm:text-sm"
                    style={eraRanges(index).year}
                  >
                    {era.year}
                  </li>
                ))}
              </ol>

              {/* The stack: one absolutely-positioned layer per era,
                  each holding its card and the beat that belongs to it.
                  Nesting them together is what lets the un-stacked
                  fallback render as an interleaved card-then-beat list. */}
              <div className="relative z-10 min-h-[27rem] flex-1 sm:min-h-[26rem] lg:min-h-[30rem]">
                {WHATS_NEW_ERAS.map((era, index) => {
                  const Icon = ICONS[era.icon]
                  const image = "image" in era ? era.image : undefined
                  const ranges = eraRanges(index)
                  // The first era opens the section full-screen and zooms
                  // back into its card, so it skips the slide-in and owns
                  // the intro choreography instead.
                  const lead = index === 0

                  return (
                    <div
                      key={era.title}
                      data-testid="whats-new-era"
                      style={ranges.card}
                      className={`watch-scroll-era relative mb-10 flex flex-col gap-5 last:mb-0 md:mb-0 ${
                        lead ? "watch-scroll-intro-front" : ""
                      }`}
                    >
                      <span
                        aria-hidden
                        data-testid="whats-new-era-glow"
                        style={
                          {
                            ...ranges.beat,
                            "--glow": era.glow,
                          } as CSSProperties
                        }
                        className="watch-ambient watch-ambient-cycle"
                      />

                      {/* The narrative beat introduces the card beneath it, and
                          swaps with it. Above rather than below: pinned, a beat
                          under the stack lands at the foot of the viewport and
                          gets cut off. */}
                      {/* The lead beat is part of the opening frame: it sits
                          over the full-screen photograph from the start, so
                          it needs a layer above the card (which otherwise
                          paints over it, being the later positioned sibling)
                          and a shadow to stay legible against dusk sky
                          rather than the black page. Both are inert once the
                          card has landed below it. */}
                      <p
                        data-testid="whats-new-era-beat"
                        style={ranges.beat}
                        className={`watch-scroll-beatbox max-w-5xl shrink-0 text-base leading-relaxed font-light text-balance text-white/85 sm:text-xl sm:leading-[1.5] md:h-48 md:text-lg md:leading-[1.55] lg:h-40 lg:text-[1.375rem] lg:leading-[1.45] ${
                          lead
                            ? "watch-scroll-beatbox-lead relative z-10 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7),0_4px_28px_rgba(0,0,0,0.85)]"
                            : ""
                        }`}
                      >
                        {era.beat}
                      </p>

                      {/* Clip box. Holds the era's footprint, carries the
                          sink into the pile, and hides the incoming card
                          below its bottom edge so the card never has to
                          fade in.

                          It deliberately carries NO border: an outline on
                          this stationary box reads as a fixed frame with
                          the picture sliding around inside it. Every piece
                          of card chrome lives on the card, so what the
                          reader sees moving is a whole card. */}
                      {/* Zoom frame. Exists only to give the opening
                          full-screen zoom an element of its own: the clip
                          box below already animates `scale` and `translate`
                          as it sinks into the pile, and a second animation
                          on the same standalone properties would clobber it
                          for as long as either fill is active. Nested
                          transforms multiply, so the two compose.

                          `contents` below the pinned breakpoint so the
                          un-stacked fallback lays out exactly as it did
                          before this element existed. */}
                      <div
                        data-testid="whats-new-era-zoom"
                        className={`contents md:flex md:min-h-0 md:flex-1 md:flex-col ${
                          lead ? "watch-scroll-intro" : ""
                        }`}
                      >
                        <div
                          data-testid="whats-new-era-clip"
                          style={ranges.card}
                          className="watch-scroll-sink relative isolate aspect-[4/5] flex-1 overflow-hidden rounded-3xl shadow-2xl shadow-black/60 sm:aspect-[16/10] md:aspect-auto"
                        >
                          <article
                            data-testid="whats-new-era-card"
                            data-current={era.current ? "" : undefined}
                            style={ranges.card}
                            className={`absolute inset-0 overflow-hidden rounded-3xl border bg-stone-950 ${
                              era.current
                                ? "border-red-100/25"
                                : "border-white/12"
                            } ${lead ? "" : "watch-scroll-era-in"}`}
                          >
                            {image ? (
                              <Image
                                src={image.src}
                                alt={image.alt}
                                width={image.width}
                                height={image.height}
                                sizes="(min-width: 1024px) 60vw, 100vw"
                                className="absolute inset-0 h-full w-full object-cover"
                              />
                            ) : (
                              // No photograph exists for an era that has not
                              // happened yet, so it is rendered rather than
                              // shot — deliberately the odd one out.
                              <span
                                className={`absolute inset-0 grid place-items-center ${ACCENT_GRADIENT_CLASS}`}
                              >
                                <Icon
                                  aria-hidden
                                  className="size-32 text-white opacity-20 md:size-44"
                                />
                              </span>
                            )}

                            {/* Old-film grain, two layers at different rates. */}
                            <span aria-hidden className="watch-grain" />
                            <span aria-hidden className="watch-grain-fine" />

                            {/* The caption plate: frosted footer plus the
                                words it exists for, grouped so the opening
                                zoom can hold the whole thing back. Left
                                behind, the frost alone covers the bottom
                                half of a full-screen photograph in blur and
                                black for a caption nobody can see yet.

                                The wrapper is `inset-0` so the two spans
                                keep measuring `h-1/2` against the card. */}
                            <div
                              className={`absolute inset-0 ${
                                lead ? "watch-scroll-intro-caption" : ""
                              }`}
                            >
                              {/* Frosted footer: the blur is masked so it
                                  fades out upward instead of ending on a hard
                                  line, and the tint underneath carries the
                                  contrast. */}
                              <span
                                aria-hidden
                                className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 [mask-image:linear-gradient(to_top,black_35%,transparent)] backdrop-blur-xl"
                              />
                              <span
                                aria-hidden
                                className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/55 to-transparent"
                              />

                              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7 lg:p-10">
                                <p className="text-[0.6875rem] font-semibold tracking-[0.24em] text-red-100/80 uppercase">
                                  {era.year} · {era.kicker}
                                </p>
                                <h3 className="mt-2.5 max-w-[20ch] text-xl leading-tight font-semibold tracking-[-0.02em] text-balance text-white drop-shadow-lg sm:text-2xl lg:text-4xl">
                                  {era.title}
                                </h3>
                                <p className="mt-2.5 max-w-[52ch] text-[0.9375rem] leading-6 text-white/85 sm:mt-3 sm:text-base sm:leading-7 lg:text-lg lg:leading-8">
                                  {era.body}
                                </p>
                              </div>
                            </div>

                            {/* Dims this card once the next one covers it. */}
                            <span
                              aria-hidden
                              style={ranges.card}
                              className="watch-scroll-scrim pointer-events-none absolute inset-0 bg-black"
                            />
                          </article>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
          <p
            data-testid="whats-new-lede-closing"
            className={`mt-14 max-w-4xl lg:mt-20 ${BODY_CLASS}`}
          >
            {WHATS_NEW_LEDE.closing}
          </p>
        </section>

        {/* One story, every format — the whole arc as a single diagram */}
        <WhatsNewFormatDiagram
          eyebrowClass={EYEBROW_CLASS}
          headingClass={SECTION_HEADING_CLASS}
          bodyClass={BODY_CLASS}
          contentClass={WATCH_PAGE_CONTENT_CLASSES}
        />

        {/* What is improving */}
        <section
          id="improving"
          aria-labelledby="whats-new-improving-heading"
          className="relative border-t border-white/10 bg-stone-950 scroll-mt-24 md:scroll-mt-32"
        >
          <div
            className={`${WATCH_PAGE_CONTENT_CLASSES} py-16 sm:py-20 lg:py-24`}
          >
            <p className={EYEBROW_CLASS}>What is improving</p>
            <h2
              id="whats-new-improving-heading"
              className={`mt-4 max-w-3xl ${SECTION_HEADING_CLASS}`}
            >
              Five changes people will notice — and the work underneath them
            </h2>

            {/* Quadrant grid: screenshot on top, copy at the foot, thin
                rules between cells. The language card spans the full row
                because it is the one the redesign turns on — and unlike a
                masonry column flow, this keeps the visual order 01→05 the
                same as the DOM order. */}
            <div className="mt-12 grid border-t border-white/10 lg:mt-16 lg:grid-cols-2">
              {WHATS_NEW_IMPROVEMENTS.map((item, index) => {
                const Icon = ICONS[item.icon]
                const ordinal = String(index + 1).padStart(2, "0")
                // Full-width cells reset the column walk, so the vertical
                // divider lands on right-hand cells only.
                const column = WHATS_NEW_IMPROVEMENTS.slice(0, index).reduce(
                  (at, previous) => (previous.featured ? 0 : (at + 1) % 2),
                  0,
                )

                return (
                  <article
                    key={item.title}
                    data-testid="whats-new-improvement-card"
                    data-featured={item.featured ? "" : undefined}
                    className={`watch-scroll-card relative flex flex-col border-b border-white/10 py-10 lg:py-14 ${
                      item.featured ? "lg:col-span-2" : ""
                    } ${
                      column === 1
                        ? "lg:border-l lg:border-l-white/10 lg:pl-14"
                        : "lg:pr-14"
                    }`}
                  >
                    <div
                      className={`relative overflow-hidden rounded-xl border border-white/10 bg-stone-950 ${
                        item.featured ? "aspect-[21/7]" : "aspect-[16/9]"
                      }`}
                    >
                      <Image
                        src={item.shot.src}
                        alt={item.shot.alt}
                        width={2880}
                        height={1514}
                        quality={94}
                        sizes={
                          item.featured
                            ? "(min-width: 1024px) 76vw, 92vw"
                            : "(min-width: 1024px) 38vw, 92vw"
                        }
                        className="absolute inset-0 h-full w-full object-cover object-top"
                      />
                      {/* Settles the shot into the cell rather than ending
                          on a hard crop line. */}
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-stone-950 to-transparent"
                      />
                    </div>

                    <div className="mt-8 flex items-center gap-4">
                      <span className="text-[0.6875rem] font-semibold tracking-[0.28em] text-red-100/60 tabular-nums">
                        {ordinal}
                      </span>
                      <span aria-hidden className="h-px flex-1 bg-white/12" />
                      <Icon
                        aria-hidden
                        className="size-5 text-white opacity-45"
                      />
                    </div>

                    <h3 className="mt-5 text-xl leading-snug font-semibold tracking-[-0.01em] text-balance text-white sm:text-2xl">
                      {item.title}
                    </h3>

                    <div className="mt-4 max-w-2xl">
                      <ImprovementBody item={item} />
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        {/* Why these changes matter */}
        <section
          id="why"
          aria-labelledby="whats-new-audiences-heading"
          className="relative border-t border-white/10 scroll-mt-24 md:scroll-mt-32"
        >
          <div
            className={`${WATCH_PAGE_CONTENT_CLASSES} py-16 sm:py-20 lg:py-24`}
          >
            <div className="max-w-3xl">
              <p className={EYEBROW_CLASS}>{WHATS_NEW_AUDIENCES.eyebrow}</p>
              <h2
                id="whats-new-audiences-heading"
                className={`mt-4 ${SECTION_HEADING_CLASS}`}
              >
                {WHATS_NEW_AUDIENCES.heading}
              </h2>
            </div>

            {/* The surprise comes before the three cards: it is the reason
                the audiences are weighted the way they are. */}
            <WhatsNewAudienceQuiz />

            <ul className="mt-12 grid gap-6 isolate md:grid-cols-3 lg:mt-16 lg:gap-8">
              {WHATS_NEW_AUDIENCES.cards.map((card, index) => {
                const Icon = ICONS[card.icon]
                // Outer cards swing out and drop; the middle one stays
                // upright and highest, which is what reads as a fan.
                const offset = index - 1

                return (
                  <li
                    key={card.title}
                    data-testid="whats-new-audience-card"
                    style={
                      {
                        "--tint": card.tint,
                        "--fan-rotate": `${offset * 5}deg`,
                        "--fan-drop": `${Math.abs(offset) * 0.9}rem`,
                        // Direction only. The DISTANCE lives in CSS in
                        // absolute units, because the space the overlap
                        // must not eat is the card's fixed padding — a
                        // percentage of card width closes that gap to
                        // nothing on a wide viewport.
                        "--fan-dir": offset,
                        // Left card on top so every card covers only the
                        // RIGHT edge of the one behind it.
                        "--fan-layer": WHATS_NEW_AUDIENCES.cards.length - index,
                      } as CSSProperties
                    }
                    className="watch-scroll-fan group relative overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--tint)_62%,transparent)] bg-[linear-gradient(150deg,color-mix(in_oklab,var(--tint)_52%,#0a0910),color-mix(in_oklab,var(--tint)_26%,#08070c))] p-6 mix-blend-screen transition-colors duration-300 hover:border-[color-mix(in_oklab,var(--tint)_85%,transparent)] lg:p-8"
                  >
                    {/* Tint wash, strongest behind the icon. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_60%_at_0%_0%,rgba(255,255,255,0.16),transparent_60%)]"
                    />

                    <div className="relative">
                      <span
                        className="grid size-12 place-items-center rounded-xl border border-[color-mix(in_oklab,var(--tint)_50%,transparent)] bg-[color-mix(in_oklab,var(--tint)_22%,transparent)] text-[var(--tint)]"
                        style={{ color: card.tint }}
                      >
                        <Icon aria-hidden className="size-6" />
                      </span>

                      <span className="mt-6 block text-[0.6875rem] font-semibold tracking-[0.28em] tabular-nums text-[var(--tint)]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3 className="mt-3 text-lg font-semibold text-white">
                        {card.title}
                      </h3>
                      <p className="mt-3 text-sm leading-relaxed text-white/88">
                        {card.body}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>

            <p className={`mt-10 max-w-3xl ${BODY_CLASS}`}>
              {WHATS_NEW_AUDIENCES.closing}
            </p>
          </div>
        </section>

        {/* Where Watch is going next */}
        <section
          id="next"
          aria-labelledby="whats-new-directions-heading"
          className="relative border-t border-white/10 bg-stone-950 scroll-mt-24 md:scroll-mt-32"
        >
          <div
            className={`${WATCH_PAGE_CONTENT_CLASSES} py-16 sm:py-20 lg:py-24`}
          >
            <div className="grid gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] xl:gap-x-24 xl:gap-y-0">
              <header className="max-w-2xl">
                <p className={EYEBROW_CLASS}>{WHATS_NEW_DIRECTIONS.eyebrow}</p>
                <h2
                  id="whats-new-directions-heading"
                  className={`mt-4 ${SECTION_HEADING_CLASS}`}
                >
                  {WHATS_NEW_DIRECTIONS.heading}
                </h2>
              </header>
              <div className="max-w-3xl">
                <p className={BODY_CLASS}>{WHATS_NEW_DIRECTIONS.intro}</p>
                <ul
                  className={`mt-6 sm:grid-cols-2 sm:gap-x-10 ${HAIRLINE_LIST_CLASS}`}
                >
                  {WHATS_NEW_DIRECTIONS.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <aside className="mt-12 flex max-w-4xl gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm lg:mt-14 lg:p-8">
              <Info
                aria-hidden
                className="mt-1 size-5 shrink-0 text-white opacity-45"
              />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold tracking-wide text-white uppercase">
                  {WHATS_NEW_DIRECTIONS.noteTitle}
                </h3>
                <div className="mt-3 space-y-3">
                  {WHATS_NEW_DIRECTIONS.notes.map((note) => (
                    <p
                      key={note}
                      className="text-sm leading-relaxed text-white/70 sm:text-base sm:leading-7"
                    >
                      {note}
                    </p>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </section>

        {/* Built by a broad team */}
        <section
          id="team"
          aria-labelledby="whats-new-team-heading"
          className="relative border-t border-white/10 scroll-mt-24 md:scroll-mt-32"
        >
          <div
            className={`${WATCH_PAGE_CONTENT_CLASSES} py-16 sm:py-20 lg:py-24`}
          >
            <div className="grid items-center gap-x-10 gap-y-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-x-20 lg:gap-y-0">
              <div className="order-2 space-y-5 lg:order-1">
                <p className={EYEBROW_CLASS}>{WHATS_NEW_TEAM.eyebrow}</p>
                <h2
                  id="whats-new-team-heading"
                  className={`mt-4 ${SECTION_HEADING_CLASS}`}
                >
                  {WHATS_NEW_TEAM.heading}
                </h2>
                {WHATS_NEW_TEAM.paragraphs.map((paragraph) => (
                  <p key={paragraph} className={BODY_CLASS}>
                    {paragraph}
                  </p>
                ))}
                <div className="pt-3">
                  <p className="text-xs font-semibold tracking-[0.22em] text-white/55 uppercase">
                    {WHATS_NEW_TEAM.contributionsLabel}
                  </p>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {WHATS_NEW_TEAM.contributions.map((contribution) => (
                      <li
                        key={contribution}
                        className="rounded-full border border-white/12 bg-white/5 px-3.5 py-1.5 text-xs tracking-wide text-white/70"
                      >
                        {contribution}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="order-1 lg:order-2">
                <WhatsNewIceberg />
              </div>
            </div>
          </div>
        </section>

        {/* Help us improve Watch */}
        <section
          aria-labelledby="whats-new-closing-heading"
          className={`relative isolate overflow-hidden border-t border-white/10 ${ACCENT_GRADIENT_CLASS}`}
        >
          <NoiseOverlay />
          <div
            className={`${WATCH_PAGE_CONTENT_CLASSES} relative py-20 text-center sm:py-24`}
          >
            <p className={EYEBROW_CLASS}>{WHATS_NEW_CLOSING.eyebrow}</p>
            <h2
              id="whats-new-closing-heading"
              className={`mx-auto mt-4 max-w-3xl ${SECTION_HEADING_CLASS}`}
            >
              {WHATS_NEW_CLOSING.heading}
            </h2>
            <div className="mx-auto mt-6 max-w-2xl space-y-4">
              {WHATS_NEW_CLOSING.paragraphs.map((paragraph) => (
                <p
                  key={paragraph}
                  className="text-base leading-8 text-white/80 sm:text-lg"
                >
                  {paragraph}
                </p>
              ))}
            </div>
            <div className="mt-10 flex flex-col items-center gap-6">
              <div className="w-full max-w-md">{languageSwitcher}</div>
              <WhatsNewFeedbackButton
                label={WHATS_NEW_HERO.feedbackCta}
                className={SECONDARY_CTA_CLASS}
              />
            </div>
          </div>
        </section>
        {/* The two blocks that ask the reader for something close the page,
            on one white shelf that hands off to the white footer instead of
            ending on another dark section. */}
        <WhatsNewFeatureVote contentClass={WATCH_PAGE_CONTENT_CLASSES} />
        <WhatsNewFaq contentClass={WATCH_PAGE_CONTENT_CLASSES} />
      </main>
      <WatchHomeFooter />
    </>
  )
}
