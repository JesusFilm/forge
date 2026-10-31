"use client"

// The month's card from "For the Least Reached: A Year of Prayer", with the
// month's prayers as a rail of daily cards. Ported from the read-only
// prototype.
//
// All 31 requests, the country and the facts are transcribed from the real
// September 2026 PDF; the family edition and the month archive are the real
// files from the prayer hub. What is not ported, because it was not real:
// - "how many prayed" counts (a deterministic stand-in);
// - "prayed" ticks remembered in localStorage — a tick here lasts for this
//   page only;
// - the daily-prayer and mentor sign-up forms, which accepted an address and
//   showed success while sending nothing. Their entry points stay and say
//   plainly that sign-up is not available here.
// - "today": the requests are numbered days of the guide's own month, so a
//   day is marked today only during that month.

import {
  ArrowRight,
  Languages as LanguagesIcon,
  Play,
  Languages,
  Smartphone,
  Sparkles,
  Users,
  Waves,
} from "lucide-react"
import Image from "next/image"
import { Fragment, type ReactNode, useRef, useState } from "react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { CAROUSEL_END_SPACER } from "@/lib/content-width"
import { PrayerMap } from "@/components/watch/PrayerMap"
import { useWatchModalActivity } from "@/components/watch/WatchModalActivityProvider"

import { buttonVariants } from "@/components/ui/button-variants"
import {
  PRAYER_ART,
  PRAYER_FAMILY_GUIDE,
  PRAYER_LANGUAGE_TOTAL,
  PRAYER_LANGUAGES,
  PRAYER_MONTH,
  PRAYER_SPONSOR,
  PRAYER_WEEKS,
  type PrayerWeek,
} from "@/components/watch/grow-resources"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import { cn } from "@/lib/utils"

/* Film grain, as a tileable SVG data URI: fractal noise desaturated to grey.
   No asset to ship, no network request, and it scales with the tile size
   rather than the device pixel ratio. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='170' height='170'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E\")"

const family = PRAYER_FAMILY_GUIDE

/* The two "asks" under the language rail share a shape. Same hover fill the
   rest of this section uses, so the muted line has to flip with it. */
/* The four banners at the foot of the block share a shape: a mark, a title, a
   line of why, and one button. The card itself is not the target — the button
   is — so nothing here is hover-filled.

   No box: they are separated by a single rule, which has to follow the grid as
   it reflows. Stacked, that rule is horizontal above every banner but the
   first; two-up it is vertical down the second column; four-up it is vertical
   before each of the last three. */
const ASK_CARD = cn(
  "group relative isolate flex min-w-0 flex-col border-white/10 pt-5 [&:not(:first-child)]:border-t",
  "sm:pt-0 sm:[&:not(:first-child)]:border-t-0 sm:[&:nth-child(even)]:border-l sm:[&:nth-child(even)]:pl-6",
  "xl:[&:not(:first-child)]:border-l xl:[&:not(:first-child)]:pl-6",
  /* The white panel is painted by a pseudo-element rather than a background on
     the card itself: the card has no padding of its own — its left edge is the
     text's edge, so the block's copy all lines up — and a background would
     therefore hug the letters. The pseudo bleeds 12px sideways, exactly half
     the 24px gutter, so two neighbouring panels meet but never overlap. */
  "before:pointer-events-none before:absolute before:-inset-x-3 before:-inset-y-4 before:-z-10 before:rounded-2xl before:bg-white before:opacity-0 before:transition-opacity before:duration-150 hover:before:opacity-100 has-[:focus-visible]:before:opacity-100",
)
const ASK_NOTE =
  "mt-4 text-[14px] leading-relaxed text-white/45 transition-colors group-hover:text-stone-600"
/* Title and action were two elements per banner — eight things shouting across
   the row. They are one now: the heading itself is the link. */
const ASK_ACTION =
  /* `after` stretches the control over the whole card, so the panel that lights
     up on hover is also the thing you can click. */
  "inline-flex max-w-full cursor-pointer items-center gap-2 text-left text-xl leading-tight font-semibold text-balance text-white transition-colors group-hover:text-stone-900 after:absolute after:-inset-x-3 after:-inset-y-4 after:rounded-2xl after:content-[''] focus-visible:outline-none"

/** The country's flag emoji, built from its ISO 3166-1 alpha-2 code. */
function flagOf(code: string): string {
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  )
}

/** One symbol per fact, in the order the guide states them. */
const FACT_ICONS = [Users, Languages, Smartphone, Waves]

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]
/* The guide's month ("September 2026"), as a calendar month. */
const [GUIDE_MONTH_NAME = "", GUIDE_YEAR = ""] = PRAYER_MONTH.month.split(" ")

/* The day of the guide's month it is, or null outside that month. The rail
   opens there; outside it, it opens on day 1. */
function today(): number | null {
  const now = new Date()
  return now.getFullYear() === Number(GUIDE_YEAR) &&
    MONTHS[now.getMonth()] === GUIDE_MONTH_NAME
    ? now.getDate()
    : null
}

export function WatchGrowPrayer() {
  const [day] = useState(today)
  return (
    <section
      data-testid="watch-grow-prayer"
      aria-labelledby="watch-grow-prayer-heading"
      className="w-full min-w-0 pt-12 text-white md:pt-16"
    >
      {/* ONE block: the guide's banner art and copy at the top, the month's
          prayer cards riding along the bottom of the same card. */}
      <div className="relative min-w-0 overflow-hidden rounded-3xl border border-white/[0.075] border-t-white/10 border-b-white/[0.045] bg-stone-950 shadow-[0_1px_0_0_rgba(0,0,0,0.9)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={PRAYER_ART.banner}
          alt=""
          width={2400}
          height={2000}
          decoding="async"
          className="absolute inset-0 size-full object-cover object-top brightness-[0.68] saturate-[0.85]"
        />
        {/* the lower half is blurred and dimmed so the cards read over it */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[52%] backdrop-blur-xl [mask-image:linear-gradient(to_bottom,transparent,black_28%)]"
        />
        {/* the guide's map, drawn as vector so this month's country can be
            highlighted and the pins can breathe */}
        <div
          aria-hidden={false}
          className="pointer-events-none absolute top-0 right-0 hidden h-[62%] w-[52%] items-center justify-center pr-4 md:flex"
        >
          <PrayerMap highlight={PRAYER_MONTH.country} className="max-h-full" />
        </div>
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-stone-950/92 via-stone-950/45 to-transparent"
        />
        {/* the art settles into the card behind the rail */}
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-transparent via-stone-950/30 to-stone-950/70"
        />
        {/* A little film grain over the whole card. Generated by the browser
            from an inline SVG rather than shipped as an image, and blended
            soft-light so it sits in the art instead of greying it out. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.22] mix-blend-soft-light"
          style={{ backgroundImage: GRAIN, backgroundSize: "170px 170px" }}
        />

        <div className="relative grid min-w-0 gap-6 px-6 pt-9 pb-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:px-10 md:pt-12 md:pb-10">
          <div className="min-w-0 max-w-[38rem]">
            <p
              className={cn(
                WATCH_SECTION_EYEBROW_CLASS,
                "text-sm sm:text-xs xl:text-sm 2xl:text-base",
              )}
            >
              {PRAYER_MONTH.month} · one country a month
            </p>
            <h2
              id="watch-grow-prayer-heading"
              className="mt-4 text-3xl leading-[1.05] font-semibold text-balance sm:text-4xl lg:text-5xl"
            >
              {day === null
                ? `In ${PRAYER_MONTH.month} we pray for`
                : "This month we pray for"}{" "}
              {PRAYER_MONTH.country}{" "}
              <span aria-hidden className="whitespace-nowrap">
                {flagOf(PRAYER_MONTH.countryCode)}
              </span>
            </h2>
            <ul className="mt-8 grid min-w-0 gap-4">
              {PRAYER_MONTH.facts.map((f, i) => {
                const Icon = FACT_ICONS[i] ?? Sparkles
                return (
                  <li
                    key={f}
                    className="flex min-w-0 items-start gap-3.5 text-[15px] leading-relaxed text-white/80 sm:text-base"
                  >
                    <Icon
                      aria-hidden
                      className="mt-1 size-5 shrink-0 text-white"
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0">{f}</span>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* The two frames that used to sit here were decoration. This is the
              one thing the block has to offer a parent, so it gets the corner
              instead — and it is the same card that used to sit below. */}
          {family ? (
            <a
              href={family.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="watch-grow-prayer-family"
              className="group flex min-w-0 shrink-0 items-center gap-4 rounded-2xl border border-white/8 bg-stone-950/35 p-3.5 opacity-85 backdrop-blur-sm transition hover:border-white/25 hover:bg-stone-950/70 hover:opacity-100 focus-visible:border-white/40 focus-visible:opacity-100 focus-visible:outline-none md:max-w-[21rem] md:self-start"
            >
              {family.image ? (
                <Image
                  src={family.image}
                  alt=""
                  width={124}
                  height={124}
                  className="size-[72px] shrink-0 rounded-full object-cover"
                />
              ) : null}
              <span className="min-w-0">
                <span className="block text-[16px] leading-tight font-semibold text-white/90">
                  The family edition
                </span>
                <span className="mt-1.5 block text-[13px] leading-snug text-white/55">
                  Verses and activities for elementary ages.
                </span>
              </span>
              <ArrowRight
                aria-hidden
                className="mr-1 ml-auto size-5 shrink-0 text-white/45 transition-transform group-hover:translate-x-1"
              />
            </a>
          ) : null}
        </div>

        {/* the month's prayers, inside the same block */}
        <PrayerDayRail day={day} />

        {/* then the languages people there actually speak, and the two asks
            that follow from them */}
        <PrayerLanguages />
        <PrayerAsks />
      </div>
    </section>
  )
}
/** One card per day of the month, opening on today. */
function PrayerDayRail({ day }: { day: number | null }) {
  const [openDay, setOpenDay] = useState<number | null>(null)
  // Page-only: a tick is a private act and is not stored anywhere.
  const [prayed, setPrayed] = useState<number[]>([])

  // Each week opener adds a slide before its first day, so the index of
  // "today" is its day number plus every opener that precedes it.
  const startIndex =
    day === null
      ? 0
      : Math.max(
          day - 1 + PRAYER_WEEKS.filter((w) => w.startsOn <= day).length,
          0,
        )

  const toggle = (n: number) =>
    setPrayed((prev) =>
      prev.includes(n) ? prev.filter((d) => d !== n) : [...prev, n],
    )

  return (
    <div className="relative min-w-0 px-6 pt-2 md:px-10">
      <Carousel
        aria-label={`Daily prayers for ${PRAYER_MONTH.country}`}
        opts={{
          dragFree: true,
          containScroll: "trimSnaps",
          align: "start",
          startIndex,
        }}
        className="min-w-0"
      >
        {/* The arrows sit up here on the header line. Left where the shared
            carousel puts them they float over a card and sit on top of the
            prayer text, which is the one thing in the block you have to be
            able to read. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 pr-24">
          <p className="text-[11px] font-bold tracking-[0.14em] text-white/45 uppercase">
            One prayer a day
          </p>
          <p className="text-[13px] text-white/45">
            {prayed.length > 0
              ? `${prayed.length} of ${PRAYER_MONTH.days.length} prayed`
              : `${PRAYER_MONTH.days.length} days`}
          </p>
        </div>

        <CarouselPrevious
          label="Earlier days"
          className="top-0 right-11 left-auto size-9 translate-y-0 opacity-100 md:inline-flex pointer-events-auto"
        />
        <CarouselNext
          label="Later days"
          className="top-0 right-0 size-9 translate-y-0 opacity-100 md:inline-flex pointer-events-auto"
        />

        {/* Bleed off the RIGHT edge only: the left edge stays on the block's own
            padding so a snapped card lines up with the copy above it. */}
        <div className="mt-4 -mr-6 w-[calc(100%+1.5rem)] min-w-0 md:-mr-10 md:w-[calc(100%+2.5rem)]">
          <CarouselContent
            data-testid="watch-grow-prayer-rail"
            className="-ml-3"
          >
            {PRAYER_MONTH.days.map((text, i) => {
              const n = i + 1
              const week = PRAYER_WEEKS.find((w) => w.startsOn === n)
              return (
                <Fragment key={n}>
                  {week ? (
                    <CarouselItem className="basis-auto pl-3">
                      <WeekCard week={week} />
                    </CarouselItem>
                  ) : null}
                  <CarouselItem className="basis-auto pl-3">
                    <PrayerCard
                      n={n}
                      text={text}
                      isToday={n === day}
                      prayed={prayed.includes(n)}
                      expanded={openDay === n}
                      onExpand={() => setOpenDay(openDay === n ? null : n)}
                      onToggle={() => toggle(n)}
                    />
                  </CarouselItem>
                </Fragment>
              )
            })}
            <CarouselItem className="basis-auto pl-0" aria-hidden tabIndex={-1}>
              <div className={CAROUSEL_END_SPACER} />
            </CarouselItem>
          </CarouselContent>
        </div>
      </Carousel>
    </div>
  )
}

function PrayerCard({
  n,
  text,
  isToday,
  prayed,
  expanded,
  onExpand,
  onToggle,
}: {
  n: number
  text: string
  isToday: boolean
  prayed: boolean
  expanded: boolean
  onExpand: () => void
  onToggle: () => void
}) {
  // Long requests are clamped on the card and open in place.
  const long = text.length > 180
  return (
    <div
      data-testid="watch-grow-prayer-card"
      data-day={n}
      data-today={isToday || undefined}
      className={cn(
        "flex h-full min-h-[16rem] shrink-0 flex-col justify-between rounded-2xl border p-5 transition-colors sm:min-h-[17rem]",
        /* Today gets twice the width from sm up. On a phone the rail is only
           ~340px wide, so doubling there would leave no edge of the next card
           showing and the carousel would stop reading as one. */
        isToday
          ? "w-[17rem] border-white bg-white p-6 text-stone-900 sm:w-[34rem]"
          : "w-[15rem] border-white/10 bg-white/[0.05] sm:w-[17rem]",
        prayed && "opacity-70",
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p
            className={cn(
              "text-[11px] font-bold tracking-[0.14em] uppercase",
              isToday ? "text-stone-500" : "text-white/45",
            )}
          >
            Day {n}
          </p>
          {isToday ? (
            <span className="rounded-full bg-brand-red px-2.5 py-0.5 text-[10px] font-bold tracking-[0.1em] text-white uppercase">
              Today
            </span>
          ) : null}
        </div>
        <p
          className={cn(
            "mt-3 leading-snug",
            isToday
              ? "text-[16px] leading-relaxed text-stone-800 sm:text-[19px]"
              : "text-[14px] text-white/85",
            long && !expanded && "line-clamp-6",
          )}
        >
          {text}
        </p>
        {long ? (
          <button
            type="button"
            onClick={onExpand}
            aria-expanded={expanded}
            className={cn(
              "mt-2 cursor-pointer text-[12px] underline underline-offset-4 transition-colors",
              isToday
                ? "text-stone-500 decoration-stone-400 hover:text-stone-900"
                : "text-white/45 decoration-white/25 hover:text-white/80",
            )}
          >
            {expanded ? "Less" : "More"}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-pressed={prayed}
        aria-label={prayed ? `You prayed day ${n}` : `Pray day ${n}`}
        title={prayed ? "You prayed this" : "I prayed this"}
        className={cn(
          "mt-4 inline-flex h-11 shrink-0 cursor-pointer items-center gap-2.5 self-start rounded-full border pr-4 pl-2.5 transition-colors focus-visible:outline-none",
          prayed
            ? "border-brand-red bg-brand-red text-white"
            : isToday
              ? "border-stone-300 text-stone-700 hover:border-stone-900"
              : "border-white/15 text-white/75 hover:border-white",
        )}
      >
        <span
          className={cn(
            "grid size-7 place-items-center rounded-full transition-colors",
            prayed
              ? "bg-white/20 text-white"
              : isToday
                ? "bg-stone-900/8 text-stone-700"
                : "bg-white/10 text-white",
          )}
        >
          {/* lucide has no praying hands — the emoji is the glyph */}
          <span aria-hidden className="text-[15px] leading-none">
            {"\u{1F64F}"}
          </span>
        </span>
        <span className="text-[14px] font-semibold">
          {prayed ? "Prayed" : "Pray"}
        </span>
      </button>
    </div>
  )
}

/** A week opener: the guide's own photograph, with the verse printed on it. */
function WeekCard({ week }: { week: PrayerWeek }) {
  return (
    <div
      data-testid="watch-grow-prayer-week"
      data-week={week.n}
      className="relative flex h-full min-h-[16rem] w-[17rem] shrink-0 flex-col justify-end overflow-hidden rounded-2xl border border-white/10 sm:min-h-[17rem] sm:w-[20rem]"
    >
      <Image
        src={week.image}
        alt=""
        width={1200}
        height={800}
        className="absolute inset-0 size-full object-cover"
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black from-[18%] via-black/55 via-[58%] to-black/15"
      />
      <div className="relative p-5">
        <p className="text-[11px] font-bold tracking-[0.14em] text-white/60 uppercase">
          Week {week.n}
        </p>
        <p className="mt-2 font-serif text-[15px] leading-snug text-balance">
          &ldquo;{week.verse}&rdquo;
        </p>
        <p className="mt-2 text-[12px] text-white/60">{week.reference}</p>
      </div>
    </div>
  )
}

/**
 * Get the day's prayer where you already are. The prototype collected an
 * email or phone number here and showed success while sending nothing; there
 * is no daily list behind this page, so the dialog says so and points to the
 * real prayer-guide archive instead.
 */
function PrayerSubscribeCta() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // The page player pauses while this covers it, through the shared owner.
  useWatchModalActivity(open)

  return (
    <>
      <AskBlock
        testId="watch-grow-prayer-ask-daily"
        note={`A single short prayer for ${PRAYER_MONTH.country} each morning. Not available from this page yet.`}
      >
        <button
          ref={triggerRef}
          type="button"
          data-testid="watch-grow-prayer-subscribe-open"
          onClick={() => setOpen(true)}
          className={ASK_ACTION}
        >
          Get one prayer a day
          <ASK_ARROW />
        </button>
      </AskBlock>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          lang="en"
          dir="ltr"
          data-testid="watch-grow-prayer-subscribe"
          data-available="false"
          finalFocus={triggerRef}
          overlayClassName="bg-black/80 backdrop-blur-sm"
          className="w-[min(92vw,30rem)] max-w-none gap-0 rounded-3xl border-white/12 bg-stone-950 p-6 text-white sm:p-8"
        >
          <DialogTitle className="text-2xl leading-tight font-semibold text-balance">
            One prayer a day, sent to you
          </DialogTitle>
          <DialogDescription className="mt-2 text-[15px] leading-relaxed text-white/70">
            Daily prayers by email or text are not available from this page yet.
            Every month&rsquo;s guide is on the prayer hub, free to read and
            print.
          </DialogDescription>
          <a
            href={PRAYER_MONTH.hub}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "pill" }),
              "mt-6 h-12 w-full",
            )}
          >
            Open the prayer guides
          </a>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* The marquee's own CSS. Kept here rather than in globals.css because the
   whole block is throwaway. Pauses on hover and on keyboard focus so the links
   are reachable, and does not run at all for a reader who asked for less
   motion — they get the full list, still and scrollable. */
const MARQUEE_CSS = `
@keyframes watch-prayer-marquee {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(-50%, 0, 0); }
}
.watch-prayer-marquee {
  animation: watch-prayer-marquee 55s linear infinite;
  will-change: transform;
}
.watch-prayer-marquee:hover,
.watch-prayer-marquee:focus-within {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  .watch-prayer-marquee {
    animation: none;
  }
}
`

/** Every language below has a real JESUS page in that language. */
function PrayerLanguages() {
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${Math.round(n / 1_000_000)}M speakers`
      : `${Math.round(n / 1000)}k speakers`

  return (
    <div
      data-testid="watch-grow-prayer-languages"
      className="relative min-w-0 px-6 pt-9 md:px-10 md:pt-11"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-white/50 uppercase">
          <LanguagesIcon aria-hidden className="size-3.5" />
          Hear Jesus in their language
        </p>
        <p className="text-[13px] text-white/45">
          {PRAYER_LANGUAGE_TOTAL} languages are spoken in {PRAYER_MONTH.country}
        </p>
      </div>

      {/* A continuous band rather than a carousel: the point is that the list
          does not end at nine. Two identical copies scroll as one and the
          keyframe stops at exactly half, so the seam never shows. */}
      <style>{MARQUEE_CSS}</style>
      <div
        data-testid="watch-grow-prayer-language-rail"
        className="mt-5 -mx-6 overflow-hidden bg-black/45 backdrop-blur-[2px] md:-mx-10"
      >
        <div className="watch-prayer-marquee flex w-max items-center">
          {[0, 1].map((copy) => (
            <div
              key={copy}
              aria-hidden={copy === 1}
              className="flex shrink-0 items-center"
            >
              {PRAYER_LANGUAGES.map((lang) => (
                <a
                  key={lang.name}
                  href={lang.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={
                    copy === 0 ? "watch-grow-prayer-language" : undefined
                  }
                  tabIndex={copy === 1 ? -1 : undefined}
                  className="group inline-flex shrink-0 items-center gap-2 px-5 py-3.5 text-white transition-opacity hover:opacity-100 focus-visible:underline focus-visible:underline-offset-4 focus-visible:outline-none"
                >
                  <Play
                    aria-hidden
                    className="size-3.5 shrink-0 text-white/70 group-hover:text-white"
                  />
                  <span className="text-[14px] font-semibold whitespace-nowrap">
                    {lang.name}
                  </span>
                  {lang.native ? (
                    <span className="text-[14px] whitespace-nowrap text-white/75">
                      {lang.native}
                    </span>
                  ) : null}
                  <span className="text-[12px] tabular-nums whitespace-nowrap text-white/60">
                    {fmt(lang.speakers)}
                  </span>
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The two asks, at the foot of the block: one for the person who can fund a
 * language, one for the person who already speaks it.
 */
function ASK_ARROW() {
  return (
    <ArrowRight
      aria-hidden
      className="size-5 shrink-0 transition-transform group-hover:translate-x-1"
    />
  )
}

/** One banner: mark, title, a line of why, and a single action. */
function AskBlock({
  note,
  testId,
  children,
}: {
  note: ReactNode
  /** The heading, which is also the link or button. */
  children: ReactNode
  testId: string
}) {
  return (
    <div data-testid={testId} className={ASK_CARD}>
      {children}
      <p className={ASK_NOTE}>{note}</p>
    </div>
  )
}

/** The four ways out of this block, as banners. */
function PrayerAsks() {
  return (
    <div className="relative grid min-w-0 gap-x-6 gap-y-8 px-6 pt-10 pb-10 sm:grid-cols-2 md:px-10 md:pt-12 md:pb-12 xl:grid-cols-4">
      <AskBlock
        testId="watch-grow-prayer-ask-pdf"
        note={`All ${PRAYER_MONTH.days.length} days on one printable page, straight from the guide. Free to print and to hand round.`}
      >
        <a
          href={PRAYER_MONTH.pdf}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="watch-grow-prayer-pdf"
          className={ASK_ACTION}
        >
          Pray the whole month
          <ASK_ARROW />
        </a>
      </AskBlock>

      <PrayerSubscribeCta />

      <AskBlock
        testId="watch-grow-prayer-ask-sponsor"
        note={`Not every language here has the film yet. Mission ${PRAYER_SPONSOR.groups} funds the ones still waiting.`}
      >
        <a
          href={PRAYER_SPONSOR.give}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="watch-grow-prayer-sponsor"
          className={ASK_ACTION}
        >
          Sponsor a translation
          <ASK_ARROW />
        </a>
      </AskBlock>

      <PrayerMentorCta />
    </div>
  )
}

/**
 * The second ask: people who already speak one of these languages answering the
 * people who write in after they watch. There is no public mentor programme or
 * conversation queue behind this page, so the prototype's sign-up form (which
 * showed success and sent nothing) is not ported; the dialog says so.
 */
function PrayerMentorCta() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // The page player pauses while this covers it, through the shared owner.
  useWatchModalActivity(open)

  return (
    <>
      <AskBlock
        testId="watch-grow-prayer-ask-mentor"
        note={`Speak one of these languages? Mentor sign-up is not available from this page yet.`}
      >
        <button
          ref={triggerRef}
          type="button"
          data-testid="watch-grow-prayer-mentor-open"
          onClick={() => setOpen(true)}
          className={ASK_ACTION}
        >
          Become a mentor
          <ASK_ARROW />
        </button>
      </AskBlock>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          lang="en"
          dir="ltr"
          data-testid="watch-grow-prayer-mentor"
          data-available="false"
          finalFocus={triggerRef}
          overlayClassName="bg-black/80 backdrop-blur-sm"
          className="w-[min(92vw,32rem)] max-w-none gap-0 rounded-3xl border-white/12 bg-stone-950 p-6 text-white sm:p-8"
        >
          <DialogTitle className="text-2xl leading-tight font-semibold text-balance">
            Be the person who answers
          </DialogTitle>
          <DialogDescription className="mt-2 text-[15px] leading-relaxed text-white/70">
            Mentors would reply in chat to people in {PRAYER_MONTH.country} who
            ask a question after they watch. Signing up is not available from
            this page yet, and nothing is collected here.
          </DialogDescription>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={cn(buttonVariants({ variant: "pill" }), "mt-6 h-12")}
          >
            Close
          </button>
        </DialogContent>
      </Dialog>
    </>
  )
}
