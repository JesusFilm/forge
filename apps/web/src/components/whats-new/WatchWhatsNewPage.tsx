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
import { WhatsNewAiTrafficChart } from "@/components/whats-new/WhatsNewAiTrafficChart"
import { WhatsNewAssistantPhone } from "@/components/whats-new/WhatsNewAssistantPhone"
import { WhatsNewFeedbackButton } from "@/components/whats-new/WhatsNewFeedbackButton"
import { WhatsNewFaq } from "@/components/whats-new/WhatsNewFaq"
import { WhatsNewFeatureVote } from "@/components/whats-new/WhatsNewFeatureVote"
import { WhatsNewFormatDiagram } from "@/components/whats-new/WhatsNewFormatDiagram"
import { WhatsNewAudienceQuiz } from "@/components/whats-new/WhatsNewAudienceQuiz"
import { WhatsNewIceberg } from "@/components/whats-new/WhatsNewIceberg"
import { WhatsNewNoteBoard } from "@/components/whats-new/WhatsNewNoteBoard"
import { WhatsNewShot } from "@/components/whats-new/WhatsNewShot"
import { WhatsNewLanguageSwitcher } from "@/components/whats-new/WhatsNewLanguageSwitcher"
import { WhatsNewSelfId } from "@/components/whats-new/WhatsNewSelfId"
import {
  WHATS_NEW_ASSISTANTS,
  WHATS_NEW_AUDIENCES,
  WHATS_NEW_CLOSING,
  WHATS_NEW_DELIVERY,
  WHATS_NEW_DIRECTIONS,
  WHATS_NEW_ERAS,
  WHATS_NEW_FAQ,
  WHATS_NEW_HERO,
  WHATS_NEW_IMPROVEMENTS,
  WHATS_NEW_LANGUAGE_SWITCHER,
  WHATS_NEW_LEDE,
  WHATS_NEW_PARTNER_LETTER,
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
/**
 * Card copy runs one step below the page's body scale. Five cards of
 * long-form copy set at full section size crowds the cell and competes with
 * the screenshot above it.
 *
 * Written out in full rather than appended to BODY_CLASS / HAIRLINE_LIST_CLASS:
 * two conflicting `text-*` utilities in one class string are resolved by
 * stylesheet order, not by which one appears last in the attribute.
 */
const CARD_BODY_CLASS =
  "text-sm leading-7 text-white/76 sm:text-base sm:leading-8"
const CARD_LIST_CLASS =
  "grid list-none gap-2.5 text-sm leading-6 text-white/78 sm:text-base sm:leading-7 [&>li]:relative [&>li]:pl-5 [&>li]:before:absolute [&>li]:before:top-[0.78em] [&>li]:before:left-0 [&>li]:before:h-px [&>li]:before:w-2.5 [&>li]:before:bg-red-100/60"
/* Solid brand fill, matching the Watch footer's own primary button
   (`bg-[#d33a43]` / `hover:bg-[#b62d35]`) rather than inventing a red. Used
   where feedback is the action being asked for; the outlined variant below
   stays for the places where it sits beside other links. */
const PRIMARY_CTA_CLASS =
  "inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#d33a43] px-7 text-sm font-bold tracking-wider text-white uppercase transition-colors duration-200 hover:bg-[#b62d35] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:px-9"
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

/** Resolved once: the delivery band renders exactly one icon. */
const DeliveryIcon = ICONS[WHATS_NEW_DELIVERY.icon]

/**
 * Where each improvement sits on the two-column grid.
 *
 * A featured card takes a whole row, so it both closes the row it lands on
 * and starts the next one — index parity would put the divider on the wrong
 * cards. `column` drives the vertical rule; `row` lets the final row drop
 * its own bottom rule and hand the foot of the frame back to the container,
 * which is what keeps the rounded corners unbroken.
 */
const IMPROVEMENT_PLACEMENTS = WHATS_NEW_IMPROVEMENTS.reduce<
  { column: number; row: number }[]
>((placed, item) => {
  const previous = placed.at(-1)
  const after = previous
    ? previous.column === 1 ||
      WHATS_NEW_IMPROVEMENTS[placed.length - 1].featured
      ? { column: 0, row: previous.row + 1 }
      : { column: previous.column + 1, row: previous.row }
    : { column: 0, row: 0 }

  // A featured card cannot share a row, so it drops to the next one.
  return [
    ...placed,
    item.featured && after.column !== 0
      ? { column: 0, row: after.row + 1 }
      : after,
  ]
}, [])
const IMPROVEMENT_LAST_ROW = IMPROVEMENT_PLACEMENTS.at(-1)?.row ?? 0

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
    <div className="min-w-0 space-y-4">
      {item.paragraphs.map((paragraph) => (
        <p key={paragraph} className={CARD_BODY_CLASS}>
          {paragraph}
        </p>
      ))}
      {item.points.length > 0 && (
        <ul className={`pt-1 ${CARD_LIST_CLASS}`}>
          {item.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
      {"closing" in item && item.closing ? (
        <p className={`pt-1 ${CARD_BODY_CLASS}`}>{item.closing}</p>
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
            {/* `items-end`, not `items-center`: the switcher carries a label
                above its control, so centring the row puts the button
                halfway up that stack. Aligned to the bottom, and with the
                control set to the button's own height, the two read as one
                row. */}
            <div className="mt-10 flex flex-col items-start gap-6 sm:flex-row sm:items-end sm:gap-8">
              {languageSwitcher}
              <WhatsNewFeedbackButton
                label={WHATS_NEW_HERO.feedbackCta}
                className={PRIMARY_CTA_CLASS}
              />
            </div>
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
                  // Only one era carries a bolded opening sentence, so the
                  // field is read the same guarded way `image` is.
                  const beatLead = "beatLead" in era ? era.beatLead : undefined
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
                          it needs a layer above the card, which otherwise
                          paints over it as the later positioned sibling.
                          Weight and shadow are what make it legible against
                          dusk sky rather than the black page, and both are
                          animated rather than classes — see the keyframes,
                          which also carry why the weight stops at 500. */}
                      <p
                        data-testid="whats-new-era-beat"
                        style={ranges.beat}
                        className={`watch-scroll-beatbox max-w-5xl shrink-0 text-base leading-relaxed font-light text-balance text-white/85 sm:text-xl sm:leading-[1.5] md:h-48 md:text-lg md:leading-[1.55] lg:h-40 lg:text-[1.375rem] lg:leading-[1.45] ${
                          lead
                            ? "watch-scroll-beatbox-lead relative z-10 text-white"
                            : ""
                        }`}
                      >
                        {beatLead ? (
                          <strong className="font-semibold text-white">
                            {beatLead}
                          </strong>
                        ) : null}
                        {beatLead ? " " : null}
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
                            /* The outline is what separates one card from the
                               next once they stack, so every card keeps it.

                               The lead card fades its own in over the opening
                               zoom instead: while the card is scaled wider
                               than the screen, its top edge draws a hairline
                               straight across the viewport above the
                               photograph. That is the only frame where the
                               border is wrong, so it is the only frame that
                               loses it. */
                            className={`absolute inset-0 overflow-hidden rounded-3xl border bg-stone-950 ${
                              era.current
                                ? "border-red-100/25"
                                : "border-white/12"
                            } ${lead ? "watch-scroll-intro-edge" : "watch-scroll-era-in"}`}
                          >
                            {image ? (
                              <Image
                                src={image.src}
                                alt={image.alt}
                                width={image.width}
                                height={image.height}
                                /* The lead photograph is rendered at the
                                   full viewport width during the opening
                                   zoom, not at the card's 60vw, so it has
                                   to be REQUESTED at that width or it
                                   arrives upscaled and soft. */
                                sizes={
                                  lead
                                    ? "100vw"
                                    : "(min-width: 1024px) 60vw, 100vw"
                                }
                                style={
                                  lead
                                    ? ({
                                        // The opening fit divides by this to
                                        // hold the picture's own shape. Read
                                        // from the picture rather than
                                        // hard-coded in the stylesheet, so
                                        // swapping the photograph cannot
                                        // leave the two disagreeing.
                                        "--photo-aspect":
                                          image.width / image.height,
                                      } as CSSProperties)
                                    : undefined
                                }
                                className={`absolute inset-0 h-full w-full object-cover ${
                                  lead ? "watch-scroll-intro-photo" : ""
                                }`}
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

        {/* The AI shift — the chart, the argument, the research */}
        <section
          id="assistants"
          aria-labelledby="whats-new-assistants-heading"
          className="relative border-t border-white/10 bg-stone-950 scroll-mt-24 md:scroll-mt-32"
        >
          <div
            className={`${WATCH_PAGE_CONTENT_CLASSES} py-16 sm:py-20 lg:py-24`}
          >
            <header className="max-w-3xl">
              <p className={EYEBROW_CLASS}>{WHATS_NEW_ASSISTANTS.eyebrow}</p>
              <h2
                id="whats-new-assistants-heading"
                className={`mt-4 ${SECTION_HEADING_CLASS}`}
              >
                {WHATS_NEW_ASSISTANTS.heading}
              </h2>
              <div className="mt-6 space-y-5">
                {WHATS_NEW_ASSISTANTS.intro.map((paragraph) => (
                  <p key={paragraph} className={BODY_CLASS}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </header>

            <WhatsNewAiTrafficChart />

            {/* Why the traffic is worth having */}
            <div className="mt-20 max-w-3xl lg:mt-28">
              <p className={EYEBROW_CLASS}>
                {WHATS_NEW_ASSISTANTS.valueEyebrow}
              </p>
              <h3 className={`mt-4 ${SECTION_HEADING_CLASS}`}>
                {WHATS_NEW_ASSISTANTS.valueHeading}
              </h3>
            </div>

            {/* The three reasons stack in a column beside a mocked-up
                phone: they each describe one facet of the same moment, so
                the illustration shows that moment once rather than having
                the reader assemble it from three abstractions.

                The phone column is `auto` — sized by the device, not by a
                fraction of the row — so the cards take whatever is left
                and the mockup never stretches. It sticks, because the
                cards are the taller column. Below `lg` the phone drops
                underneath the cards it illustrates. */}
            <div className="watch-scroll-chat-stage mt-10 grid items-start gap-10 lg:mt-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
              <ul className="grid gap-6 lg:gap-8">
                {WHATS_NEW_ASSISTANTS.reasons.map((reason) => {
                  const Icon = ICONS[reason.icon]

                  return (
                    <li
                      key={reason.title}
                      data-testid="whats-new-assistant-reason"
                      style={{ "--tint": reason.tint } as CSSProperties}
                      className="relative isolate overflow-hidden rounded-3xl border border-[color-mix(in_srgb,var(--tint)_38%,transparent)] bg-[color-mix(in_srgb,var(--tint)_7%,transparent)] p-7 sm:p-8"
                    >
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -top-24 -left-16 -z-10 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--tint)_34%,transparent),transparent_72%)] blur-2xl"
                      />
                      {/* Full-opacity colour on the icon itself: a
                          fractional `text-*` alpha would light up every
                          stroke crossing inside the glyph (see the
                          icon-alpha rule above). */}
                      <span className="grid size-12 place-items-center rounded-full border border-[color-mix(in_srgb,var(--tint)_55%,transparent)] bg-stone-950 text-[var(--tint)]">
                        <Icon
                          aria-hidden
                          className="size-5"
                          strokeWidth={1.75}
                        />
                      </span>
                      <h4 className="mt-6 text-lg font-semibold text-balance text-white sm:text-xl">
                        {reason.title}
                      </h4>
                      <p className="mt-3 text-base leading-7 text-white/76">
                        {reason.body}
                      </p>
                    </li>
                  )
                })}
              </ul>

              <div className="justify-self-center lg:sticky lg:top-28">
                <WhatsNewAssistantPhone />
              </div>
            </div>

            {/* The research */}
            <div className="mt-20 max-w-3xl lg:mt-28">
              <p className={EYEBROW_CLASS}>
                {WHATS_NEW_ASSISTANTS.researchEyebrow}
              </p>
              <h3 className={`mt-4 ${SECTION_HEADING_CLASS}`}>
                {WHATS_NEW_ASSISTANTS.researchHeading}
              </h3>
              <div className="mt-6 space-y-5">
                {WHATS_NEW_ASSISTANTS.researchIntro.map((paragraph) => (
                  <p key={paragraph} className={BODY_CLASS}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>

            {/* The argument and its evidence sit side by side: the closing
                copy opens with "put those findings next to each other",
                and on a wide screen they literally are. The copy sticks
                while the studies scroll past it.

                DOM order is studies-then-copy so the single-column phone
                layout still reads in argument order — the grid only swaps
                them once there are two columns to swap. */}
            <div className="mt-20 grid items-start gap-12 lg:mt-28 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:gap-16">
              {/* Every claim is a link. A statistic on a public page that a
                  reader cannot check is worth less than no statistic. */}
              <ol className="grid gap-px overflow-hidden rounded-3xl border border-white/12 bg-white/12 lg:order-2">
                {WHATS_NEW_ASSISTANTS.sources.map((source) => (
                  <li
                    key={source.id}
                    data-testid="whats-new-assistant-source"
                    className="flex flex-col gap-4 bg-stone-950 p-7 sm:p-8"
                  >
                    <blockquote className="border-l-2 border-red-100/50 pl-5 text-base leading-7 font-medium text-balance text-white sm:text-lg sm:leading-8">
                      <p>&ldquo;{source.quote}&rdquo;</p>
                      <footer className="mt-2 text-sm leading-6 font-normal text-white/50">
                        — {source.quoteNote}
                      </footer>
                    </blockquote>

                    <p className="text-base leading-7 text-white/76">
                      {source.finding}
                    </p>

                    <p className="mt-auto text-sm leading-6 text-white/50">
                      <a
                        href={source.href}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-4"
                      >
                        {source.publication}
                      </a>
                      <span className="mx-2 text-white/25">·</span>
                      {source.attribution}
                      <span className="mx-2 text-white/25">·</span>
                      <span className="tabular-nums">{source.date}</span>
                    </p>
                  </li>
                ))}
              </ol>

              {/* The turn: what the research obliges us to do. */}
              <div className="lg:sticky lg:top-28 lg:order-1">
                <p className={EYEBROW_CLASS}>
                  {WHATS_NEW_ASSISTANTS.closingEyebrow}
                </p>
                <h3 className={`mt-4 ${SECTION_HEADING_CLASS}`}>
                  {WHATS_NEW_ASSISTANTS.closingHeading}
                </h3>
                <div className="mt-6 space-y-5">
                  {WHATS_NEW_ASSISTANTS.closing.map((paragraph) => (
                    <p key={paragraph} className={BODY_CLASS}>
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
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

            {/* `watch-scroll-fan-hand` grows the gathered hand as one piece.
                Per-card growth cannot be paid for by the rem gather below:
                its cost scales with card width, so the headings behind get
                covered on a wide viewport. */}
            <ul
              data-testid="whats-new-audience-fan"
              className="watch-scroll-fan-hand mt-12 grid gap-6 isolate md:grid-cols-3 lg:mt-16 lg:gap-8"
            >
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

            {/* Extra room from `md` up, where the fan exists and grows: the
                gathered hand ends 12% larger than its slot, so its lowest
                rotated corner reaches ~20px past the list box and would
                otherwise sit on this paragraph's first line. Measured
                clearance at `mt-10` after growth: -13px at 820, -21px at
                1920. */}
            <p
              data-testid="whats-new-audience-closing"
              className={`mt-10 max-w-3xl md:mt-16 ${BODY_CLASS}`}
            >
              {WHATS_NEW_AUDIENCES.closing}
            </p>

            {/* The section has told the reader who Watch is for; the last
                move is to let them say which of the three they are, so it
                closes on their situation rather than on our numbers. */}
            <WhatsNewSelfId />
          </div>
        </section>

        {/* A letter to missionaries and field partners.
            Placed straight after the audiences section: the reader has
            just been asked which of the three they are, so the one
            audience with the hardest conditions gets addressed directly
            before the page moves on to what is next. */}
        <section
          id="partners"
          aria-labelledby="whats-new-partners-heading"
          className="relative border-t border-white/10 bg-stone-950 scroll-mt-24 md:scroll-mt-32"
        >
          <div
            className={`${WATCH_PAGE_CONTENT_CLASSES} py-16 sm:py-20 lg:py-24`}
          >
            <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
              <header className="max-w-xl">
                <p className={EYEBROW_CLASS}>
                  {WHATS_NEW_PARTNER_LETTER.eyebrow}
                </p>
                <h2
                  id="whats-new-partners-heading"
                  className={`mt-4 ${SECTION_HEADING_CLASS}`}
                >
                  {WHATS_NEW_PARTNER_LETTER.heading}
                </h2>
              </header>

              <div data-testid="whats-new-letter" className="max-w-2xl">
                <p className={BODY_CLASS}>
                  {WHATS_NEW_PARTNER_LETTER.greeting}
                </p>
                {WHATS_NEW_PARTNER_LETTER.beforeFigure.map((paragraph) => (
                  <p key={paragraph} className={`mt-6 ${BODY_CLASS}`}>
                    {paragraph}
                  </p>
                ))}

                {/* The letter's one job, set as a figure rather than left
                    inside a paragraph: a reader who skims the letter still
                    cannot skim past the number. The share is interpolated
                    from the quiz, so the page cannot print two of them.

                    Number and claim sit side by side on the first line's
                    baseline, so the figure reads as one sentence rather
                    than a heading over a paragraph — stacking below `sm`,
                    where a 60px number and a caption cannot share a
                    line. */}
                <figure
                  data-testid="whats-new-letter-figure"
                  className="mt-10 flex flex-col gap-y-4 border-l-2 border-brand-red pl-6 sm:flex-row sm:items-center sm:gap-x-7 sm:pl-8"
                >
                  <p
                    data-testid="whats-new-letter-figure-value"
                    className="text-5xl leading-none font-semibold tracking-[-0.03em] text-white sm:shrink-0 sm:text-[4rem]"
                  >
                    {WHATS_NEW_PARTNER_LETTER.figure.value}
                  </p>
                  <figcaption className="text-lg leading-8 text-white">
                    {WHATS_NEW_PARTNER_LETTER.figure.claim}
                  </figcaption>
                </figure>

                {WHATS_NEW_PARTNER_LETTER.afterFigure.map((paragraph) => (
                  <p key={paragraph} className={`mt-6 ${BODY_CLASS}`}>
                    {paragraph}
                  </p>
                ))}
                <p className={`mt-6 ${BODY_CLASS}`}>
                  {WHATS_NEW_PARTNER_LETTER.ask}
                </p>

                {/* Typed name, not a drawn signature: a rendered
                    handwriting graphic of a real person's name would be a
                    forgery of the one mark that is theirs. */}
                <div
                  data-testid="whats-new-letter-signature"
                  className="mt-10 border-t border-white/12 pt-7"
                >
                  <p className="text-base font-semibold text-white">
                    {WHATS_NEW_PARTNER_LETTER.signature.name}
                  </p>
                  <p className="mt-1 text-sm text-white/55">
                    {WHATS_NEW_PARTNER_LETTER.signature.role}
                  </p>
                  <WhatsNewFeedbackButton
                    label={WHATS_NEW_PARTNER_LETTER.feedbackCta}
                    className={`mt-7 ${SECONDARY_CTA_CLASS}`}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

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
                same as the DOM order.

                The container draws the whole rounded frame; cells draw only
                the rules between them, so the last row skips its bottom rule
                rather than laying a straight line across the curve.

                `overflow-hidden` is load-bearing now that each cell paints a
                gradient to its own edges — without it the corner cells fill
                their square corners and the rounded border floats over the
                colour. It is only safe because the last row has no bottom
                rule for the clip to eat. */}
            <div className="mt-12 grid overflow-hidden rounded-2xl border border-white/10 lg:mt-16 lg:grid-cols-2">
              {WHATS_NEW_IMPROVEMENTS.map((item, index) => {
                const { column, row } = IMPROVEMENT_PLACEMENTS[index]

                return (
                  <article
                    key={item.title}
                    data-testid="whats-new-improvement-card"
                    data-featured={item.featured ? "" : undefined}
                    // The tint is declared on the CELL so the band below can
                    // inherit it, but the band is what paints — see there for
                    // why it is not simply this element's background.
                    style={
                      {
                        "--tint-from": item.tint.from,
                        "--tint-to": item.tint.to,
                      } as CSSProperties
                    }
                    className={`watch-scroll-card relative flex flex-col border-white/10 px-6 py-10 sm:px-8 lg:px-12 lg:py-14 ${
                      item.featured ? "lg:col-span-2" : ""
                    } ${row === IMPROVEMENT_LAST_ROW ? "" : "border-b"} ${
                      column === 1 ? "lg:border-l lg:border-l-white/10" : ""
                    }`}
                  >
                    <div className="relative">
                      {/* The colour band, sized off the SHOT rather than the
                          cell: negative insets cancel the cell's padding so
                          it still bleeds to three cell edges, but it stops
                          just below the clip instead of running the full
                          height. Each inset mirrors a padding step above —
                          change one and the band stops reaching that edge.

                          The layered radials and the slanted foot mask are
                          in globals.css under `.whats-new-tint-band`; only
                          the two stops are set here, on the cell, so they
                          inherit. */}
                      <div
                        aria-hidden
                        data-testid="whats-new-tint-band"
                        // `isolate` is what keeps the grain honest: the
                        // overlay blends with `mix-blend-multiply`, and
                        // without a stacking context here it would multiply
                        // against the page behind the band rather than
                        // against the band's own colour.
                        //
                        // A div rather than a span because it now has a
                        // block child; the mask above applies to children
                        // too, so the grain fades out with the colour.
                        className="whats-new-tint-band pointer-events-none absolute isolate -top-10 -right-6 -bottom-4 -left-6 sm:-right-8 sm:-left-8 lg:-top-14 lg:-right-12 lg:-bottom-5 lg:-left-12"
                      >
                        <NoiseOverlay />
                      </div>
                      <WhatsNewShot
                        shot={item.shot}
                        clip={item.clip}
                        featured={item.featured}
                      />
                    </div>

                    <h3 className="mt-8 text-lg leading-snug font-semibold tracking-[-0.01em] text-balance text-white sm:text-xl">
                      {item.title}
                    </h3>

                    <div className="mt-4 max-w-2xl">
                      <ImprovementBody item={item} />
                    </div>
                  </article>
                )
              })}
            </div>

            {/* The section heading promises "the work underneath". This is
                the piece of that work partners feel most, so it closes the
                section as one band rather than a sixth screenshot card —
                there is nothing to screenshot about a platform move. */}
            <div
              data-testid="whats-new-delivery"
              className={`mt-14 overflow-hidden rounded-3xl border border-white/12 ${ACCENT_GRADIENT_CLASS} p-6 sm:p-9 lg:mt-20 lg:p-12`}
            >
              <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
                <div>
                  <div className="flex items-center gap-4">
                    <DeliveryIcon
                      aria-hidden
                      className="size-5 shrink-0 text-white opacity-45"
                    />
                    <p className={EYEBROW_CLASS}>
                      {WHATS_NEW_DELIVERY.eyebrow}
                    </p>
                  </div>
                  <h3 className="mt-5 text-2xl leading-snug font-semibold tracking-[-0.015em] text-balance text-white sm:text-3xl">
                    {WHATS_NEW_DELIVERY.heading}
                  </h3>
                  {WHATS_NEW_DELIVERY.paragraphs.map((paragraph) => (
                    <p key={paragraph} className={`mt-5 ${BODY_CLASS}`}>
                      {paragraph}
                    </p>
                  ))}
                  <ul className={`mt-7 ${HAIRLINE_LIST_CLASS}`}>
                    {WHATS_NEW_DELIVERY.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-xl leading-snug font-semibold tracking-[-0.01em] text-balance text-white sm:text-2xl">
                    {WHATS_NEW_DELIVERY.downloads.heading}
                  </h4>
                  {WHATS_NEW_DELIVERY.downloads.paragraphs.map((paragraph) => (
                    <p key={paragraph} className={`mt-5 ${BODY_CLASS}`}>
                      {paragraph}
                    </p>
                  ))}

                  {/* Two numbers doing one comparison: a KPI pair, not a
                      chart. Reading order is label then value, so the
                      figure never arrives without its window; the visual
                      order is reversed because the number is the headline.
                      Proportional figures — `tabular-nums` only belongs in
                      a column of numbers that must align. */}
                  <p className="mt-9 border-t border-white/12 pt-8 text-[0.6875rem] font-semibold tracking-[0.28em] text-red-100/70 uppercase">
                    {WHATS_NEW_DELIVERY.statsHeading}
                  </p>
                  <dl
                    data-testid="whats-new-delivery-stats"
                    className="mt-6 grid gap-5 sm:grid-cols-2"
                  >
                    {WHATS_NEW_DELIVERY.stats.map((stat) => (
                      <div
                        key={stat.label}
                        data-testid="whats-new-delivery-stat"
                        className="flex flex-col-reverse"
                      >
                        <dt className="mt-3 text-sm leading-6 text-white/70">
                          {stat.label}
                          <span className="mt-1 block text-xs text-white/45">
                            {stat.detail}
                          </span>
                        </dt>
                        <dd className="text-5xl leading-none font-semibold tracking-[-0.02em] text-white">
                          {stat.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-6 text-xs leading-6 text-white/45">
                    {WHATS_NEW_DELIVERY.note}
                  </p>
                </div>
              </div>

              <p className={`mt-12 max-w-3xl ${BODY_CLASS}`}>
                {WHATS_NEW_DELIVERY.closing}
              </p>
            </div>
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
                className={PRIMARY_CTA_CLASS}
              />
            </div>
          </div>
        </section>
        {/* The three blocks that ask the reader for something close the
            page. The cork band steps the page from the dark sections down
            to the white shelf the vote and the FAQ share, which hands off
            to the white footer instead of ending on another dark section. */}
        <WhatsNewNoteBoard contentClass={WATCH_PAGE_CONTENT_CLASSES} />
        <WhatsNewFeatureVote contentClass={WATCH_PAGE_CONTENT_CLASSES} />
        <WhatsNewFaq contentClass={WATCH_PAGE_CONTENT_CLASSES} />
      </main>
      <WatchHomeFooter />
    </>
  )
}
