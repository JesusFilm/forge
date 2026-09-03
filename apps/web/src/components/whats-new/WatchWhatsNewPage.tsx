import type { CSSProperties } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  Compass,
  Globe2,
  Handshake,
  House,
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
import { WhatsNewNoteBoard } from "@/components/whats-new/WhatsNewNoteBoard"
import { WhatsNewShot } from "@/components/whats-new/WhatsNewShot"
import { WhatsNewLanguageSwitcher } from "@/components/whats-new/WhatsNewLanguageSwitcher"
import {
  WHATS_NEW_ASSISTANTS,
  WHATS_NEW_AUDIENCES,
  WHATS_NEW_CLOSING,
  WHATS_NEW_DELIVERY,
  WHATS_NEW_ERAS,
  WHATS_NEW_FAQ,
  WHATS_NEW_HERO,
  WHATS_NEW_IMPROVEMENTS,
  WHATS_NEW_LANGUAGE_SWITCHER,
  WHATS_NEW_LEDE,
  WHATS_NEW_PARTNER_LETTER,
  type WhatsNewIconKey,
} from "@/components/whats-new/whats-new-content"
import { WatchStructuredData } from "@/components/watch/WatchStructuredData"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import {
  languageVideosIndexPath,
  languagesIndexPath,
  tryAsLocaleSlug,
} from "@/lib/routes"
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
const HERO_GRADIENT_CLASS =
  "bg-[linear-gradient(135deg,rgba(69,10,29,0.92),rgba(30,15,60,0.72)_45%,rgba(234,88,12,0.18))]"
const ACCENT_GRADIENT_CLASS =
  "bg-[linear-gradient(135deg,rgba(69,10,29,0.6),rgba(88,28,135,0.2),rgba(234,88,12,0.1))]"

/**
 * The audience card's box: border, tint gradient, blend mode, padding.
 *
 * One string, two callers — the fan's `<li>` in the audiences section and
 * the estimate stage's card below it. The stage exists so the reader
 * recognises the card that just slid past, which only works while the two
 * boxes are identical, and only stays true if there is one of them.
 */
const AUDIENCE_CARD_CHROME_CLASS =
  "relative overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--tint)_62%,transparent)] bg-[linear-gradient(150deg,color-mix(in_oklab,var(--tint)_52%,#0a0910),color-mix(in_oklab,var(--tint)_26%,#08070c))] p-6 mix-blend-screen lg:p-8"

/**
 * Which audience card travels: ministry partners.
 *
 * Resolved by `icon` rather than by index, because the question it slides
 * over to is specifically about people doing ministry work, and a card
 * reordering would otherwise silently change the subject of the question
 * without touching a line of it. Falls back to the first card so a renamed
 * icon degrades to a card that travels the wrong distance rather than to a
 * crash.
 *
 * Its index is also the travel DISTANCE in columns — card 3 has two
 * columns to cross to reach the first — which is why the fallback is 0
 * (travel nowhere) rather than the last card.
 */
const TRAVELLING_CARD_INDEX = Math.max(
  0,
  WHATS_NEW_AUDIENCES.cards.findIndex((card) => card.icon === "handshake"),
)
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
  /**
   * The reader's own language slug, for the per-language link in the
   * letter. `tryAsLocaleSlug` rather than `asLocaleSlug`: the throwing
   * constructor would take down a whole statically-rendered page over one
   * decorative link, so a slug that fails the shape check drops the link
   * and leaves the sentence standing.
   */
  const linkableLanguageSlug = tryAsLocaleSlug(languageSlug)

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
            {/* Dated, in the hero rather than the footer: a reader deciding
                whether this page is worth their next five minutes is asking
                "is this current?", and a leadership reader checks the date
                before the copy. A `<time>` element so it is machine-readable
                too — both halves of the date live in content, and a content
                test holds them to the same day. */}
            <p
              data-testid="whats-new-last-updated"
              className="mt-6 text-sm text-white/45"
            >
              {WHATS_NEW_HERO.lastUpdatedLabel}{" "}
              <time dateTime={WHATS_NEW_HERO.lastUpdatedIso}>
                {WHATS_NEW_HERO.lastUpdated}
              </time>
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

        {/* The shift — editorial lede. Second section on the page, by
            decision: straight after the hero and ahead of the audiences.

            It has been on both sides of the letter. It opened the page
            originally, was moved below the letter on the argument that a
            partner whose work broke should hear the acknowledgement before
            a history of film distribution, and is now back at the top —
            the arc is the strongest opening the page has, and it frames
            everything after it.

            Nothing in the stage's scroll geometry depends on where it sits
            in the document — the ranges are `contain`-relative to the
            stage's own pin, not to the page. */}
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
            {/* The audiences stage: the fan gathers, then ONE of its cards
                travels.

                Three cards fan in as before. Then, on the stage's own
                scroll timeline, the first two fade away and the THIRD card
                — the one this section's question is about — slides from the
                right-hand column into the left, straightening up as it
                goes, while the guess question fades in over the space the
                other two just vacated.

                It is genuinely one card, not a redrawn copy. An earlier
                attempt drew a second ministry-partners card lower down the
                page and slid that into place, which put both on screen at
                once and read exactly like what it was. The travel and the
                fan transform therefore live on DIFFERENT elements — the
                `<li>` grid cell carries the travel, the card `<div>` inside
                it carries the fan's own rotate/translate/scale — because
                two animations cannot both own `translate` on one element,
                and the cell is the only box that knows where the columns
                are.

                Everything here degrades to the plain fanned row plus a
                question below it, fully visible and un-animated, on
                narrow viewports and for a reader who asked for less
                motion. */}
            <div
              data-testid="whats-new-audience-stage"
              className="watch-audience-stage"
            >
              <div className="watch-audience-pin">
                {/* The section's heading is INSIDE the pin, so it holds
                    still with the cards it introduces instead of scrolling
                    away and leaving three cards and a question with nothing
                    naming them. It leaves with those cards too — see
                    `watch-audience-heading`. */}
                <div className="watch-audience-heading max-w-3xl">
                  <p className={EYEBROW_CLASS}>{WHATS_NEW_AUDIENCES.eyebrow}</p>
                  <h2
                    id="whats-new-audiences-heading"
                    className={`mt-4 ${SECTION_HEADING_CLASS}`}
                  >
                    {WHATS_NEW_AUDIENCES.heading}
                  </h2>
                </div>
                {/* One grid cell holds BOTH the card row and the question
                    from `lg` up, so the cell's height is the taller of the
                    two and the pin can centre the pair as one group. The
                    question used to be absolutely positioned, which took it
                    out of the flow — the cell was then only as tall as the
                    cards and centring left the group sitting low, 318px of
                    slack above it and 127px below. */}
                <div className="mt-6 grid lg:mt-8">
                  {/* `watch-scroll-fan-hand` grows the gathered hand as one
                      piece. Per-card growth cannot be paid for by the rem
                      gather below: its cost scales with card width, so the
                      headings behind get covered on a wide viewport. */}
                  <ul
                    data-testid="whats-new-audience-fan"
                    /* `self-center`, not the grid's default `stretch`: the
                       cell is as tall as the question beside it, and a
                       stretched row made each card grow to match — a card
                       of four lines with 150px of empty space under it.
                       Natural height, centred against the question. */
                    className="watch-scroll-fan-hand grid gap-6 isolate md:grid-cols-3 lg:col-start-1 lg:row-start-1 lg:gap-8 lg:self-center"
                  >
                    {WHATS_NEW_AUDIENCES.cards.map((card, index) => {
                      const Icon = ICONS[card.icon]
                      // Outer cards swing out and drop; the middle one stays
                      // upright and highest, which is what reads as a fan.
                      const offset = index - 1
                      const travels = index === TRAVELLING_CARD_INDEX

                      return (
                        <li
                          key={card.title}
                          data-testid="whats-new-audience-cell"
                          data-travels={travels || undefined}
                          style={
                            {
                              "--fan-rotate": `${offset * 5}deg`,
                              "--fan-drop": `${Math.abs(offset) * 0.9}rem`,
                              // How far this cell has to go to reach the
                              // first column, in columns. Only the
                              // travelling card gets a non-zero value; the
                              // CSS turns it into `-N x (card width + gap)`
                              // plus the corrections for the two fan
                              // transforms already acting on the card.
                              "--travel-columns": travels ? index : 0,
                              // A card that is ALREADY in the first column
                              // has nothing to cross, and the corrections
                              // that place a crossing card would drag it
                              // out of the gutter — measured 60px past it.
                              // So it gets no horizontal travel at all and
                              // the animation is a pure straighten: the
                              // rotate and drop the fan gave it come off,
                              // and it stays exactly where it was laid out.
                              ...(travels && index === 0
                                ? { "--travel-x": "0px" }
                                : {}),
                              // Which way the card's own gather pushed it,
                              // so the travel can cancel that push.
                              "--fan-dir": offset,
                            } as CSSProperties
                          }
                          className={`min-w-0 ${
                            travels
                              ? "watch-audience-travel"
                              : "watch-audience-fade"
                          }`}
                        >
                          <div
                            data-testid="whats-new-audience-card"
                            style={
                              {
                                "--tint": card.tint,
                                "--fan-rotate": `${offset * 5}deg`,
                                "--fan-drop": `${Math.abs(offset) * 0.9}rem`,
                                // Direction only. The DISTANCE lives in CSS
                                // in absolute units, because the space the
                                // overlap must not eat is the card's fixed
                                // padding — a percentage of card width
                                // closes that gap to nothing on a wide
                                // viewport.
                                "--fan-dir": offset,
                                // Left card on top so every card covers only
                                // the RIGHT edge of the one behind it.
                                "--fan-layer":
                                  WHATS_NEW_AUDIENCES.cards.length - index,
                              } as CSSProperties
                            }
                            className={`watch-scroll-fan group h-full transition-colors duration-300 hover:border-[color-mix(in_oklab,var(--tint)_85%,transparent)] ${AUDIENCE_CARD_CHROME_CLASS}`}
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
                          </div>
                        </li>
                      )
                    })}
                  </ul>

                  {/* The question, over the ground the first two cards
                      vacate. Absolutely placed from `lg` up so it can share
                      the cards' row; below that it is an ordinary block
                      under them. */}
                  {/* Right half from `lg` up, in the same cell as the cards
                      — not columns two and three. The card that stays in
                      column one is still inside the hand's growth, so it is
                      12% wider than its column and its right edge crosses
                      that line; at half, it cannot. Below `lg` this is an
                      ordinary block under the cards. */}
                  <div
                    data-testid="whats-new-estimate-panel"
                    className="watch-audience-quiz mt-8 lg:col-start-1 lg:row-start-1 lg:mt-0 lg:w-1/2 lg:justify-self-end"
                  >
                    <WhatsNewAudienceQuiz className="" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* A letter to missionaries and field partners.
            Placed straight after the audiences section: the reader has
            just been asked which of the three they are, so the one
            audience with the hardest conditions gets addressed directly
            before the page moves on to what is next.

            The history stage now runs AHEAD of it, so a reader reaching
            this letter has already seen the arc it argues from; the format
            diagram and the AI-shift case still follow. */}
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
                {/* The turn from explanation to loyalty: what is already in
                    their hands, then what is being built, then the ask.

                    Two lists rather than one, and labelled, because the
                    difference between shipped and intended is the whole
                    credibility of the paragraph. Links resolve through the
                    route builders — the app has a `/watch` basePath, so a
                    hand-written href would leave the app, and the
                    per-language page needs the slug the reader arrived
                    under. */}
                <div data-testid="whats-new-letter-future">
                  <p className={`mt-6 ${BODY_CLASS}`}>
                    {WHATS_NEW_PARTNER_LETTER.future.loyalty}
                  </p>

                  <p className="mt-8 text-[0.6875rem] font-semibold tracking-[0.28em] text-red-100/70 uppercase">
                    {WHATS_NEW_PARTNER_LETTER.future.shippedLead}
                  </p>
                  <ul className={`mt-4 ${HAIRLINE_LIST_CLASS}`}>
                    {WHATS_NEW_PARTNER_LETTER.future.shipped.map((item) => (
                      <li key={item.text}>
                        {item.text}
                        {"link" in item &&
                        item.link &&
                        (item.link.to === "languages" ||
                          linkableLanguageSlug !== null) ? (
                          <>
                            {" "}
                            <Link
                              href={
                                item.link.to === "languages"
                                  ? languagesIndexPath()
                                  : languageVideosIndexPath(
                                      linkableLanguageSlug!,
                                    )
                              }
                              data-testid="whats-new-letter-future-link"
                              className="font-semibold whitespace-nowrap text-white underline decoration-white/40 underline-offset-4 transition-colors hover:decoration-white focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-4"
                            >
                              {item.link.label}
                            </Link>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>

                  <p className="mt-8 text-[0.6875rem] font-semibold tracking-[0.28em] text-red-100/70 uppercase">
                    {WHATS_NEW_PARTNER_LETTER.future.comingLead}
                  </p>
                  <ul className={`mt-4 ${HAIRLINE_LIST_CLASS}`}>
                    {WHATS_NEW_PARTNER_LETTER.future.coming.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>

                  <p className={`mt-8 ${BODY_CLASS}`}>
                    {WHATS_NEW_PARTNER_LETTER.future.pledge}
                  </p>
                </div>

                <p className={`mt-6 ${BODY_CLASS}`}>
                  {WHATS_NEW_PARTNER_LETTER.ask}
                </p>

                {/* Typed name, not a drawn signature: a rendered
                    handwriting graphic of a real person's name would be a
                    forgery of the one mark that is theirs. */}
                <div
                  data-testid="whats-new-letter-signature"
                  /* Name on the left, the ask on the right of it — the two
                     read as one line of the letter's foot rather than the
                     button hanging below the signature. Wraps to stacked
                     when the column is too narrow to seat both. */
                  className="mt-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-6 border-t border-white/12 pt-7"
                >
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-white">
                      {WHATS_NEW_PARTNER_LETTER.signature.name}
                    </p>
                    <p className="mt-1 text-sm text-white/55">
                      {WHATS_NEW_PARTNER_LETTER.signature.role}
                    </p>
                  </div>
                  {/* Brand fill, the same one the header and the hero use.
                      It was outlined on the theory that the ask is a
                      footnote to the letter; it is not — the letter's whole
                      last paragraph is a request for a reply, so the reply
                      button carries the same weight as the page's other
                      asks. */}
                  <WhatsNewFeedbackButton
                    label={WHATS_NEW_PARTNER_LETTER.feedbackCta}
                    className={PRIMARY_CTA_CLASS}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* One story, every format — the whole arc as a single diagram.

            The era stage's closing paragraph is handed in as the header's
            second column. It used to trail the stage, two screens up, where
            it read as an orphan under a pinned section that had already let
            go; level with this heading it is what it always was — the
            conclusion of the arc this diagram then draws. */}
        <WhatsNewFormatDiagram
          eyebrowClass={EYEBROW_CLASS}
          headingClass={SECTION_HEADING_CLASS}
          bodyClass={BODY_CLASS}
          contentClass={WATCH_PAGE_CONTENT_CLASSES}
          aside={
            <p data-testid="whats-new-lede-closing" className={BODY_CLASS}>
              {WHATS_NEW_LEDE.closing}
            </p>
          }
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
            {/* Two columns from `lg` up: the heading on the left, the intro
                beside it. Stacked, this heading runs to three lines of
                display type and the intro starts most of a screen down —
                the section opened on a wall of large text with its
                explanation out of sight. `items-end` aligns the two
                columns on their LAST lines, so they read as one block
                rather than two ragged ones. Below `lg` it is one column in
                DOM order: heading, then intro. */}
            <header className="grid items-end gap-8 lg:grid-cols-2 lg:gap-16">
              <div className="max-w-3xl">
                <p className={EYEBROW_CLASS}>{WHATS_NEW_ASSISTANTS.eyebrow}</p>
                <h2
                  id="whats-new-assistants-heading"
                  className={`mt-4 ${SECTION_HEADING_CLASS}`}
                >
                  {WHATS_NEW_ASSISTANTS.heading}
                </h2>
              </div>
              <div
                data-testid="whats-new-assistants-intro"
                className="space-y-5"
              >
                {WHATS_NEW_ASSISTANTS.intro.map((paragraph) => (
                  <p key={paragraph} className={BODY_CLASS}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </header>

            <WhatsNewAiTrafficChart />

            {/* The phone as a sticky right-hand column beside the research
                and the argument that turns on it. The device stays put
                beside all of it and only lets go at the end of the section.

                It used to have a third companion: a "why this traffic
                matters" heading and three reason cards in row one. Both are
                gone — the phone shows the moment those cards described, and
                showing it once beat asserting it three times.

                Placement is EXPLICIT rather than by DOM order, because the
                two breakpoints need different orders and there is only one
                DOM. Source order is phone, research, closing — the reading
                order on a phone, where each part follows the one it belongs
                to. Above `lg` the phone is lifted into column two spanning
                the rows, so the text runs down the left with the device
                alongside.

                The phone column is `auto` — sized by the device, not a
                fraction of the row — so the text takes whatever is left and
                the mockup never stretches. */}
            <div className="mt-10 grid items-start gap-10 lg:mt-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-16 lg:gap-y-0">
              {/* Pin stage: the box the phone is held still inside. Its
                  height IS the dwell, so the phone stays put until the
                  reader reaches the end of it and then releases into the
                  next block.

                  `min-h`, NOT padding. A sticky element is constrained to
                  its parent's CONTENT box, and padding sits outside that —
                  so `pb-[88svh]` made the stage visibly 88svh taller while
                  leaving the sticky range at exactly zero, and the phone
                  scrolled away like any other element. Nothing about the
                  rendered height reveals the difference; only the pin
                  failing to pin does.

                  Below `lg` the stage carries its own height, and that
                  height is a BUDGET, not a look: the sequence inside the
                  phone is timed in `svh` offsets into this box's contain
                  phase, which is its height less one screen. So this has
                  to stay at least `CHAT_SEQUENCE_END_SVH + 100svh` or the
                  tail of the exchange silently never plays. There is a
                  test that compares the two.

                  Borrowing the cards' height instead looked tidier and
                  gave the phone a 146px dwell against its own 704px
                  height — it pinned for about a fifth of a second of
                  scrolling and let go. */}
              <div className="watch-scroll-chat-stage min-h-[225svh] justify-self-center lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:min-h-0 lg:self-stretch">
                <div className="sticky top-20 lg:top-28">
                  <WhatsNewAssistantPhone />
                </div>
              </div>

              {/* The research. First row now: the reason cards that used
                  to sit above it are gone, so it needs no clearance from
                  them — only the grid's own top margin off the chart. */}
              <div className="mt-20 max-w-3xl lg:col-start-1 lg:row-start-1 lg:mt-0">
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

              {/* One column: the studies and the argument that turns on them
                read as a single piece, with each quote sitting in the prose
                that uses it rather than in a card alongside it.

                They come BEFORE the copy because the copy's first line is
                "put those findings next to each other" — it has to have
                findings above it to point at. Reordering these is a copy
                change, not just a layout one. */}
              <div className="mt-16 max-w-3xl lg:col-start-1 lg:row-start-2 lg:mt-20">
                {/* Deliberately NOT `SECTION_HEADING_CLASS`. At the section
                    scale this read as a third top-level heading competing
                    with the two above it, when what it actually does is
                    turn the research into a conclusion. Secondary weight:
                    smaller type, a dimmer eyebrow, and no `text-balance`
                    theatrics. */}
                <p className="text-[0.6875rem] font-semibold tracking-[0.28em] text-red-100/55 uppercase">
                  {WHATS_NEW_ASSISTANTS.closingEyebrow}
                </p>
                <h3 className="mt-3 max-w-2xl text-xl leading-snug font-semibold tracking-[-0.01em] text-white/90 sm:text-2xl">
                  {WHATS_NEW_ASSISTANTS.closingHeading}
                </h3>

                {/* Every claim is a link. A statistic on a public page that a
                  reader cannot check is worth less than no statistic.

                  Hairline rules rather than the card frames these used to
                  have: in a prose column a bordered box reads as an aside
                  the eye can skip, which is the opposite of the job here —
                  these ARE the argument, not a sidebar to it.

                  Behind a `<details>`, closed by default: three studies with
                  quotes, authors, publications and dates is the right depth
                  for the reader evaluating whether we know what we are doing
                  and the wrong depth for the partner who came to find out
                  why their language picker moved. Plain `<details>` rather
                  than a client component — it needs no JavaScript, it is
                  keyboard-operable and announced as a disclosure for free,
                  and it stays open across a print. The citations remain in
                  the DOM when closed, so they are still crawled, still
                  searchable in-page, and still assertable in tests. */}
                <details
                  data-testid="whats-new-research"
                  className="mt-10 border-t border-white/10 pt-8"
                >
                  <summary className="cursor-pointer list-none text-sm font-semibold tracking-wider text-white uppercase underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-4">
                    {WHATS_NEW_ASSISTANTS.sourcesToggleLabel}
                  </summary>
                  <ol className="mt-8 grid gap-8">
                    {WHATS_NEW_ASSISTANTS.sources.map((source) => (
                      <li
                        key={source.id}
                        data-testid="whats-new-assistant-source"
                        className="grid gap-3 border-b border-white/10 pb-8 last:border-b-0 last:pb-0"
                      >
                        <blockquote className="border-l-2 border-red-100/50 pl-5 text-lg leading-8 font-medium text-balance text-white sm:text-xl sm:leading-9">
                          <p>&ldquo;{source.quote}&rdquo;</p>
                          <footer className="mt-2 text-sm leading-6 font-normal text-white/50">
                            — {source.quoteNote}
                          </footer>
                        </blockquote>

                        <p className={BODY_CLASS}>{source.finding}</p>

                        <p className="text-sm leading-6 text-white/50">
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
                </details>

                {/* The turn: what the research obliges us to do. */}
                <div className="mt-10 space-y-5">
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
              What changed recently
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
                    // `isolate` so the cell is a stacking context in its own
                    // right. The colour band below sits at `-z-10` to stay
                    // behind the copy, and that only resolves against this
                    // cell if the cell IS one — it otherwise happened to be,
                    // via the `will-change: opacity` on its scroll reveal,
                    // which lives inside a reduced-motion media query. So the
                    // band's layering silently depended on the reader not
                    // asking for reduced motion.
                    className={`watch-scroll-card relative isolate flex flex-col border-white/10 px-6 py-10 sm:px-8 lg:px-12 lg:py-14 ${
                      item.featured ? "lg:col-span-2" : ""
                    } ${row === IMPROVEMENT_LAST_ROW ? "" : "border-b"} ${
                      column === 1 ? "lg:border-l lg:border-l-white/10" : ""
                    }`}
                  >
                    <div className="relative">
                      {/* The colour band. Negative insets cancel the cell's
                          padding so it bleeds to three cell edges; each one
                          mirrors a padding step above, so dropping one
                          makes the band stop short of that edge at that
                          breakpoint.

                          The bottom inset runs the colour WELL past the
                          shot — it used to stop about 20px below it, which
                          faded the colour out at roughly a third of the
                          card and left the rest flat black. It now carries
                          down behind the heading and into the first lines
                          of copy.

                          A PERCENTAGE, not a pixel step, and it resolves
                          against the shot's own height: the shot scales
                          with the card across breakpoints and between the
                          two-up and full-width cells, so a fixed inset
                          would reach a different fraction of every one of
                          them. 128% is the ceiling the FULL-WIDTH cell
                          sets — its shot is taller, so the same percentage
                          buys more pixels there, and at 150% its band box
                          ran 14px past the bottom of the card and into the
                          next one. Invisible, because the mask has faded to
                          nothing long before, which is exactly why it would
                          have gone unnoticed until something downstream
                          started clipping. Note the visible colour dies well before
                          the band's own bottom edge — the mask's stops are
                          fractions of the gradient LINE, not the height,
                          so a taller band pushes the fade down
                          proportionally rather than moving its end to the
                          edge. Measured, not derived.

                          Which is why `-z-10` is not decorative: an
                          absolutely positioned element paints above static
                          siblings, so without it the band would cover the
                          copy rather than sit behind it. The cell is a
                          stacking context (its scroll reveal declares
                          `will-change: opacity`), so the negative index
                          lands the band above the cell's own background and
                          below its text.

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
                        className="whats-new-tint-band pointer-events-none absolute -z-10 isolate -top-10 -right-6 -bottom-[128%] -left-6 sm:-right-8 sm:-left-8 lg:-top-14 lg:-right-12 lg:-left-12"
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
            {/* One paragraph, single column. It used to be a two-column
                band carrying three bullets, a downloads sub-block and a
                hand-counted support-ticket KPI pair; all of that came out
                on request. What a partner needs from it — downloads and
                playback got better — is now a `fixed` row in the reported
                problems list at the top of the page and a line in the
                letter. */}
            <div
              data-testid="whats-new-delivery"
              className={`mt-14 overflow-hidden rounded-3xl border border-white/12 ${ACCENT_GRADIENT_CLASS} p-6 sm:p-9 lg:mt-20 lg:p-12`}
            >
              <div className="flex items-center gap-4">
                <DeliveryIcon
                  aria-hidden
                  className="size-5 shrink-0 text-white opacity-45"
                />
                <p className={EYEBROW_CLASS}>{WHATS_NEW_DELIVERY.eyebrow}</p>
              </div>
              <h3 className="mt-5 max-w-3xl text-2xl leading-snug font-semibold tracking-[-0.015em] text-balance text-white sm:text-3xl">
                {WHATS_NEW_DELIVERY.heading}
              </h3>
              <p className={`mt-6 max-w-3xl ${BODY_CLASS}`}>
                {WHATS_NEW_DELIVERY.paragraph}
              </p>
            </div>
          </div>
        </section>

        {/* The three blocks that ask the reader for something close the
            page. The cork band steps the page from the dark sections down
            to the white shelf the vote and the FAQ share, which hands off
            to the white footer instead of ending on another dark section. */}
        <WhatsNewNoteBoard contentClass={WATCH_PAGE_CONTENT_CLASSES} />
        <WhatsNewFeatureVote contentClass={WATCH_PAGE_CONTENT_CLASSES} />
        <WhatsNewFaq
          contentClass={WATCH_PAGE_CONTENT_CLASSES}
          /* Was a full-width band of its own, above the cork board. As a
             sidebar it sits beside the questions instead — which is where
             a reader who did not find their answer already is, and it
             sticks while they scroll the list rather than having been
             passed three sections ago.

             Dark card on the light shelf on purpose: the block is an ask,
             not an answer, and it has to read as a different KIND of thing
             from the questions it sits next to. */
          aside={
            <div
              data-testid="whats-new-closing"
              aria-labelledby="whats-new-closing-heading"
              className={`relative isolate overflow-hidden rounded-3xl border border-black/10 bg-[#131111] p-7 text-white lg:p-8 ${ACCENT_GRADIENT_CLASS}`}
            >
              <NoiseOverlay />
              <div className="relative">
                <p className={EYEBROW_CLASS}>{WHATS_NEW_CLOSING.eyebrow}</p>
                <h2
                  id="whats-new-closing-heading"
                  className="mt-4 text-2xl leading-snug font-semibold tracking-[-0.015em] text-balance text-white"
                >
                  {WHATS_NEW_CLOSING.heading}
                </h2>
                <div className="mt-5 space-y-4">
                  {WHATS_NEW_CLOSING.paragraphs.map((paragraph) => (
                    <p
                      key={paragraph}
                      className="text-sm leading-7 text-white/80"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
                <WhatsNewFeedbackButton
                  label={WHATS_NEW_HERO.feedbackCta}
                  /* Sized to its label, not to the column. At `w-full` in
                     a 19rem sidebar the label wrapped onto two lines
                     inside the pill; the column is 21rem now and the
                     button takes the width its text needs. */
                  className={`mt-7 ${PRIMARY_CTA_CLASS}`}
                />
              </div>
            </div>
          }
        />
      </main>
      <WatchHomeFooter />
    </>
  )
}
