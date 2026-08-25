import type { CSSProperties } from "react"

import {
  WHATS_NEW_FORMATS,
  WHATS_NEW_FORMAT_DIAGRAM,
  type WhatsNewFormatGlyph,
} from "@/components/whats-new/whats-new-content"

/**
 * Hand-authored glyph set for the delivery-format diagram.
 *
 * Deliberately not Lucide: these have to read as one designed mark, so
 * they share a 48-unit box, a 1.75 stroke, round caps and joins, and the
 * same optical weight. Colour comes from the parent — never a fractional
 * `text-*` class on the SVG itself, which would apply the alpha per path
 * and light up every stroke crossing (see the icon-alpha rule in
 * WatchWhatsNewPage).
 */
const GLYPH_PROPS = {
  viewBox: "0 0 48 48",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const

function ReelGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      <circle cx="24" cy="24" r="15" />
      <g className="watch-glyph-spin">
        <circle cx="24" cy="24" r="2.6" />
        <circle cx="24" cy="14.6" r="3.4" />
        <circle cx="33.4" cy="24" r="3.4" />
        <circle cx="24" cy="33.4" r="3.4" />
        <circle cx="14.6" cy="24" r="3.4" />
      </g>
    </svg>
  )
}

function BroadcastGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      <rect x="7" y="19" width="34" height="23" rx="3" />
      <path d="M24 19 15 8" />
      <path d="M24 19 33 8" />
      <circle cx="24" cy="19" r="1.6" />
      <path d="M14 27v7" />
      {/* Signal arcs, pulsing out of the antenna. */}
      <path className="watch-glyph-pulse" d="M31.5 9.5a7 7 0 0 1 4.5 4.5" />
      <path
        className="watch-glyph-pulse watch-glyph-pulse-late"
        d="M34 6a11 11 0 0 1 7 7"
      />
    </svg>
  )
}

function CassetteGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      <rect x="5" y="13" width="38" height="22" rx="2.5" />
      <rect x="12" y="18.5" width="24" height="11" rx="1.5" />
      <g className="watch-glyph-spool-a">
        <circle cx="19" cy="24" r="2.6" />
        <path d="M19 21.4v5.2" />
      </g>
      <g className="watch-glyph-spool-b">
        <circle cx="29" cy="24" r="2.6" />
        <path d="M29 21.4v5.2" />
      </g>
      <path d="M12 39h24" />
    </svg>
  )
}

function DiscGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      <circle cx="24" cy="24" r="15" />
      <circle cx="24" cy="24" r="4" />
      <path className="watch-glyph-spin" d="M15.5 15.5A12 12 0 0 1 32.5 15.5" />
    </svg>
  )
}

function GlobeGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      <circle cx="24" cy="24" r="15" />
      <ellipse className="watch-glyph-turn" cx="24" cy="24" rx="6.4" ry="15" />
      <path d="M9 24h30" />
      <path d="M12.4 15h23.2" />
      <path d="M12.4 33h23.2" />
    </svg>
  )
}

function SearchGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      <circle className="watch-glyph-pulse" cx="21" cy="21" r="12" />
      <path d="M29.8 29.8 40 40" />
    </svg>
  )
}

function AssistantGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      <path d="M41 27a6 6 0 0 1-6 6H20l-8 7v-7a6 6 0 0 1-6-6V15a6 6 0 0 1 6-6h23a6 6 0 0 1 6 6z" />
      <path
        className="watch-glyph-twinkle"
        d="M23.5 15.5 25.4 20l4.5 1.9-4.5 1.9-1.9 4.5-1.9-4.5-4.5-1.9 4.5-1.9z"
      />
      <path d="M33 15.5v4" />
      <path d="M31 17.5h4" />
    </svg>
  )
}

const GLYPHS: Record<WhatsNewFormatGlyph, () => React.JSX.Element> = {
  reel: ReelGlyph,
  broadcast: BroadcastGlyph,
  cassette: CassetteGlyph,
  disc: DiscGlyph,
  globe: GlobeGlyph,
  search: SearchGlyph,
  assistant: AssistantGlyph,
}

export function WhatsNewFormatDiagram({
  eyebrowClass,
  headingClass,
  bodyClass,
  contentClass,
}: {
  eyebrowClass: string
  headingClass: string
  bodyClass: string
  contentClass: string
}) {
  const count = WHATS_NEW_FORMATS.length

  return (
    <section
      id="formats"
      aria-labelledby="whats-new-formats-heading"
      data-testid="whats-new-format-diagram"
      /* No divider rule, and the wash fades to transparent at both ends
         rather than starting on a solid colour — over the black page that
         leaves no seam at all. `overflow-x-clip` lets the colour fields
         spill above and below the section while still preventing the
         oversized blurred circles from widening the page. */
      className="relative isolate overflow-x-clip bg-[linear-gradient(180deg,transparent_0%,#140b20_34%,#1b0d18_74%,transparent_100%)] scroll-mt-24 md:scroll-mt-32"
    >
      {/* Immersive wash: two large, soft colour fields drawn from the same
          palette as the hero, plus a vignette so the section reads as lit
          rather than flat. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-1/2 -left-1/4 h-[80rem] w-[80rem] rounded-full bg-[radial-gradient(closest-side,rgba(124,92,240,0.3),transparent_72%)] blur-3xl"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -right-1/4 -bottom-1/2 h-[70rem] w-[70rem] rounded-full bg-[radial-gradient(closest-side,rgba(224,162,76,0.22),transparent_72%)] blur-3xl"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_45%,transparent_35%,rgba(0,0,0,0.6)_100%)]"
      />
      <div className={`${contentClass} relative py-16 sm:py-20 lg:py-24`}>
        <header className="max-w-3xl">
          <p className={eyebrowClass}>{WHATS_NEW_FORMAT_DIAGRAM.eyebrow}</p>
          <h2 id="whats-new-formats-heading" className={`mt-4 ${headingClass}`}>
            {WHATS_NEW_FORMAT_DIAGRAM.heading}
          </h2>
          <p className={`mt-6 ${bodyClass}`}>{WHATS_NEW_FORMAT_DIAGRAM.body}</p>
        </header>

        <div className="relative mt-14 lg:mt-20">
          {/* The wire the glyphs sit on. Drawn left to right as the
              section scrolls in; each glyph masks it with its own solid
              background so the line reads as passing behind them. */}
          <span
            aria-hidden
            data-testid="whats-new-format-wire"
            className="watch-scroll-wire absolute top-9 right-12 left-12 hidden h-px origin-left bg-gradient-to-r from-white/30 via-white/45 to-red-100/80 lg:block"
          />
          {/* Live pulse running the wire. A sibling of the wire, not a
              child: the wire is scaled as it draws, which would squash
              anything inside it. */}
          <span
            aria-hidden
            className="absolute top-9 right-12 left-12 hidden h-px overflow-hidden lg:block"
          >
            <span className="watch-wire-pulse absolute inset-y-0 left-0 w-1/5 bg-gradient-to-r from-transparent via-white to-transparent" />
          </span>

          <ol className="relative grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-4 lg:flex lg:justify-between lg:gap-x-2">
            {WHATS_NEW_FORMATS.map((format, index) => {
              const Glyph = GLYPHS[format.glyph]
              const isLast = index === count - 1
              const start = (index / count) * 100

              return (
                <li
                  key={format.id}
                  data-testid="whats-new-format-step"
                  data-terminal={isLast ? "" : undefined}
                  style={
                    {
                      "--pip-range": `entry ${(18 + start * 0.5).toFixed(1)}% entry ${(56 + start * 0.45).toFixed(1)}%`,
                    } as CSSProperties
                  }
                  className="watch-scroll-pip flex flex-col items-center gap-3 text-center lg:w-24"
                >
                  <span
                    className={`grid size-[4.5rem] place-items-center rounded-full border bg-stone-950 ${
                      isLast
                        ? "border-red-100/50 text-red-100"
                        : "border-white/15 text-white/80"
                    }`}
                  >
                    <span className="block size-9">
                      <Glyph />
                    </span>
                  </span>

                  <span className="text-[0.6875rem] font-semibold tracking-[0.18em] text-white uppercase">
                    {format.label}
                  </span>
                  <span className="text-[0.6875rem] tracking-wide text-white/50 tabular-nums">
                    {format.era}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}
