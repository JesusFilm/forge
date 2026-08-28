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
 *
 * The marks are STATIC on purpose. The only motion in this section is the
 * light field behind it: seven icons each looping on their own clock read
 * as clutter, and they compete with the drift they sit on.
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
      <g>
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
      {/* Set, screen and tuning dials, with the rabbit ears as one
          symmetric V off the top centre. The arcs the antenna used to
          throw crossed the right ear at this size and read as a scribble;
          the dials carry the "television" reading on their own. */}
      <rect x="6" y="18" width="36" height="24" rx="3" />
      <rect x="10" y="22" width="22" height="16" rx="2" />
      <path d="M24 18 16 8" />
      <path d="M24 18 32 8" />
      <circle cx="37" cy="27" r="1.5" />
      <circle cx="37" cy="33" r="1.5" />
    </svg>
  )
}

function CassetteGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      {/* Shell, window onto both spools, and a label strip. Everything is
          INSIDE the shell: the old label line sat four units below it and
          rendered as a stray rule under the cassette. */}
      <rect x="6" y="13" width="36" height="22" rx="2.5" />
      <rect x="11" y="17" width="26" height="11" rx="1.5" />
      <circle cx="18.5" cy="22.5" r="3" />
      <circle cx="29.5" cy="22.5" r="3" />
      <path d="M11 31.5h26" />
    </svg>
  )
}

function DiscGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      <circle cx="24" cy="24" r="15" />
      <circle cx="24" cy="24" r="4" />
      <path d="M15.5 15.5A12 12 0 0 1 32.5 15.5" />
    </svg>
  )
}

function GlobeGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      <circle cx="24" cy="24" r="15" />
      <ellipse cx="24" cy="24" rx="6.4" ry="15" />
      <path d="M9 24h30" />
      <path d="M12.4 15h23.2" />
      <path d="M12.4 33h23.2" />
    </svg>
  )
}

function SearchGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      <circle cx="21" cy="21" r="12" />
      <path d="M29.8 29.8 40 40" />
    </svg>
  )
}

function AssistantGlyph() {
  return (
    <svg {...GLYPH_PROPS} aria-hidden>
      <path d="M41 27a6 6 0 0 1-6 6H20l-8 7v-7a6 6 0 0 1-6-6V15a6 6 0 0 1 6-6h23a6 6 0 0 1 6 6z" />
      <path d="M23.5 15.5 25.4 20l4.5 1.9-4.5 1.9-1.9 4.5-1.9-4.5-4.5-1.9 4.5-1.9z" />
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

/**
 * Out-of-focus lights for the bottom of the section — the view through a
 * wet café window, where nothing resolves but the lights still slide past.
 *
 * Every light travels LEFT TO RIGHT and only that way, like traffic seen
 * from a fixed seat: `--bokeh-from`/`--bokeh-to` are the ends of one
 * crossing, and the animation never alternates. What varies is size,
 * height, colour and speed — the near ones cross in half a minute, the far
 * ones take a minute and a half, which is what sells the depth.
 *
 * Pure radial gradients, deliberately no `filter: blur()`: the falloff is
 * already soft, and a filter would force the layer to be re-blurred on
 * every animated frame. `--bokeh-delay` is negative on purpose — it drops
 * each light in at a different point of its own crossing, so the field is
 * already populated and spread out on the first frame instead of the
 * whole set entering together from the left.
 *
 * `--bokeh-rest` is where a light parks under `prefers-reduced-motion`,
 * since a crossing with the crossing removed would pile every light on the
 * left edge.
 *
 * Each light's negative `bottom` is HALF ITS OWN SIZE PLUS A DROP, which
 * puts its centre BELOW the section's bottom edge — the section shows the
 * top of each light and the edge crops through colour rather than through
 * the falloff, so the field ends on a cut instead of dimming into a black
 * band. Move a light up towards the middle of the box and its own falloff
 * puts that band straight back.
 *
 * The upward drift over a crossing (`--bokeh-y` to `--bokeh-y-end`) is
 * always SMALLER than that drop, so a centre that starts below the edge
 * cannot climb above it halfway across.
 */
const BOKEH_LIGHTS = [
  {
    id: "violet-lead",
    className:
      "-bottom-[22rem] left-0 h-[38rem] w-[38rem] bg-[radial-gradient(closest-side,rgba(134,102,248,0.62),rgba(124,92,240,0.26)_38%,rgba(124,92,240,0.08)_60%,transparent_78%)]",
    style: {
      "--bokeh-from": "-38vw",
      "--bokeh-to": "138vw",
      "--bokeh-rest": "8vw",
      "--bokeh-y": "0rem",
      "--bokeh-y-end": "-2rem",
      "--bokeh-scale": "1.18",
      "--bokeh-dim": "0.4",
      "--bokeh-lit": "0.9",
      "--bokeh-duration": "74s",
      "--bokeh-breath": "9s",
      "--bokeh-delay": "-3.7s",
    },
  },
  {
    id: "cool-far",
    className:
      "-bottom-[10.5rem] left-0 h-[18rem] w-[18rem] bg-[radial-gradient(closest-side,rgba(108,146,236,0.42),rgba(96,132,224,0.15)_34%,rgba(96,132,224,0.05)_56%,transparent_74%)]",
    style: {
      "--bokeh-from": "-30vw",
      "--bokeh-to": "132vw",
      "--bokeh-rest": "20vw",
      "--bokeh-y": "0rem",
      "--bokeh-y-end": "-1rem",
      "--bokeh-scale": "1.4",
      "--bokeh-dim": "0.22",
      "--bokeh-lit": "0.62",
      "--bokeh-duration": "52s",
      "--bokeh-breath": "8.5s",
      "--bokeh-delay": "-9.4s",
    },
  },
  {
    id: "violet-mid",
    className:
      "-bottom-[15rem] left-0 h-[26rem] w-[26rem] bg-[radial-gradient(closest-side,rgba(168,126,255,0.5),rgba(158,116,255,0.2)_36%,rgba(158,116,255,0.06)_58%,transparent_76%)]",
    style: {
      "--bokeh-from": "-34vw",
      "--bokeh-to": "134vw",
      "--bokeh-rest": "34vw",
      "--bokeh-y": "0rem",
      "--bokeh-y-end": "-1.5rem",
      "--bokeh-scale": "1.28",
      "--bokeh-dim": "0.3",
      "--bokeh-lit": "0.78",
      "--bokeh-duration": "58s",
      "--bokeh-breath": "7.5s",
      "--bokeh-delay": "-17.4s",
    },
  },
  {
    id: "warm-near",
    className:
      "-bottom-[14rem] left-0 h-[24rem] w-[24rem] bg-[radial-gradient(closest-side,rgba(255,206,150,0.42),rgba(255,206,150,0.14)_28%,rgba(255,206,150,0.04)_52%,transparent_72%)]",
    style: {
      "--bokeh-from": "-28vw",
      "--bokeh-to": "130vw",
      "--bokeh-rest": "48vw",
      "--bokeh-y": "0rem",
      "--bokeh-y-end": "-1.5rem",
      "--bokeh-scale": "1.22",
      "--bokeh-dim": "0.28",
      "--bokeh-lit": "0.58",
      "--bokeh-duration": "38s",
      "--bokeh-breath": "10s",
      "--bokeh-delay": "-16s",
    },
  },
  {
    id: "amber-wide",
    className:
      "-bottom-[24.5rem] left-0 h-[42rem] w-[42rem] bg-[radial-gradient(closest-side,rgba(236,176,92,0.5),rgba(224,162,76,0.2)_38%,rgba(224,162,76,0.06)_60%,transparent_78%)]",
    style: {
      "--bokeh-from": "-40vw",
      "--bokeh-to": "140vw",
      "--bokeh-rest": "58vw",
      "--bokeh-y": "0rem",
      "--bokeh-y-end": "-2.5rem",
      "--bokeh-scale": "1.14",
      "--bokeh-dim": "0.35",
      "--bokeh-lit": "0.85",
      "--bokeh-duration": "88s",
      "--bokeh-breath": "12s",
      "--bokeh-delay": "-48.4s",
    },
  },
  {
    id: "plum-deep",
    className:
      "-bottom-[18.5rem] left-0 h-[32rem] w-[32rem] bg-[radial-gradient(closest-side,rgba(150,88,200,0.44),rgba(140,80,190,0.18)_36%,rgba(140,80,190,0.05)_58%,transparent_76%)]",
    style: {
      "--bokeh-from": "-36vw",
      "--bokeh-to": "136vw",
      "--bokeh-rest": "70vw",
      "--bokeh-y": "0rem",
      "--bokeh-y-end": "-2rem",
      "--bokeh-scale": "1.2",
      "--bokeh-dim": "0.3",
      "--bokeh-lit": "0.72",
      "--bokeh-duration": "96s",
      "--bokeh-breath": "13s",
      "--bokeh-delay": "-63.4s",
    },
  },
  {
    id: "ember-near",
    className:
      "-bottom-[14rem] left-0 h-[24rem] w-[24rem] bg-[radial-gradient(closest-side,rgba(245,138,102,0.44),rgba(239,124,90,0.16)_34%,rgba(239,124,90,0.05)_58%,transparent_76%)]",
    style: {
      "--bokeh-from": "-30vw",
      "--bokeh-to": "132vw",
      "--bokeh-rest": "82vw",
      "--bokeh-y": "0rem",
      "--bokeh-y-end": "-1.5rem",
      "--bokeh-scale": "1.32",
      "--bokeh-dim": "0.25",
      "--bokeh-lit": "0.7",
      "--bokeh-duration": "46s",
      "--bokeh-breath": "11s",
      "--bokeh-delay": "-35.9s",
    },
  },
  {
    id: "lilac-close",
    className:
      "-bottom-[10rem] left-0 h-[17rem] w-[17rem] bg-[radial-gradient(closest-side,rgba(196,180,255,0.38),rgba(196,180,255,0.12)_28%,rgba(196,180,255,0.04)_50%,transparent_70%)]",
    style: {
      "--bokeh-from": "-26vw",
      "--bokeh-to": "128vw",
      "--bokeh-rest": "92vw",
      "--bokeh-y": "0rem",
      "--bokeh-y-end": "-1rem",
      "--bokeh-scale": "1.36",
      "--bokeh-dim": "0.2",
      "--bokeh-lit": "0.5",
      "--bokeh-duration": "33s",
      "--bokeh-breath": "6.5s",
      "--bokeh-delay": "-29.7s",
    },
  },
] as const satisfies readonly {
  id: string
  className: string
  style: Record<string, string>
}[]

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
      /* No divider rule, and the base wash fades to transparent at the TOP
         rather than starting on a solid colour — over the black page that
         leaves no seam where the section begins. It deliberately holds its
         colour to the bottom edge instead of fading out again: the section
         ends on a crop, and a fade here would put a black band back under
         the lights. `overflow-x-clip` lets the bokeh spill below the
         section while still preventing the oversized lights from widening
         the page. */
      className="relative isolate overflow-x-clip bg-[linear-gradient(180deg,transparent_0%,#140b20_34%,#1b0d18_74%,#1b0d18_100%)] scroll-mt-24 md:scroll-mt-32"
    >
      {/* Vignette first, lights second: the darkening is what makes the
          top of the section read as unlit, and the bokeh has to sit on
          top of it rather than be dimmed by it. Centred on the BOTTOM
          edge, so it darkens upwards and outwards only — a centred
          vignette darkens the bottom too, which is the black band the
          cropped light field is meant to be free of. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_85%_at_50%_100%,transparent_38%,rgba(0,0,0,0.62)_100%)]"
      />
      {/* Rainy-window bokeh. Anchored to the bottom and masked away
          towards the top of its own box, so the colour dissolves into
          black well before the heading — no light ever reaches the top of
          the section. The bottom is deliberately NOT faded: the lights
          run at full strength into the section's edge and are cropped
          there, the way a window frame cuts the view rather than dimming
          it. `overflow-hidden` is what does the cropping, and it also
          keeps the crossing lights from widening the page. */}
      <div
        aria-hidden
        data-testid="whats-new-format-bokeh"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[68%] overflow-hidden [mask-image:linear-gradient(to_top,black_0%,black_46%,rgba(0,0,0,0.42)_74%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_top,black_0%,black_46%,rgba(0,0,0,0.42)_74%,transparent_100%)]"
      >
        {BOKEH_LIGHTS.map((light) => (
          <span
            key={light.id}
            className={`watch-bokeh-orb absolute rounded-full ${light.className}`}
            style={light.style as CSSProperties}
          />
        ))}
        {/* Grain over the lights, inside the same masked box so it fades
            out exactly where they do. Rain on glass is never clean light:
            the speckle is what keeps these from reading as flat CSS
            circles. Scoped to the light field on purpose — the era cards
            own the page's other grain, and a section-wide haze reads as a
            dirty background rather than texture on something. */}
        <span aria-hidden className="watch-bokeh-grain" />
      </div>
      <div className={`${contentClass} relative py-16 sm:py-20 lg:py-24`}>
        <header className="max-w-3xl">
          <p className={eyebrowClass}>{WHATS_NEW_FORMAT_DIAGRAM.eyebrow}</p>
          <h2 id="whats-new-formats-heading" className={`mt-4 ${headingClass}`}>
            {WHATS_NEW_FORMAT_DIAGRAM.heading}
          </h2>
          <p className={`mt-6 ${bodyClass}`}>{WHATS_NEW_FORMAT_DIAGRAM.body}</p>
        </header>

        {/* The row breaks out of the page rail. It is the one block in this
            section that is a full-width diagram rather than a column of
            prose, and the rail padding was costing it 8rem of span at the
            desktop breakpoint. Negative margins MIRROR
            WATCH_PAGE_RAIL_PADDING_CLASSES — change one and change the
            other, or the row stops being flush with the section. Mobile
            keeps its padding: the stacked grid there needs the gutter. */}
        <div className="relative mt-14 md:-mx-16 lg:mt-20 xl:-mx-24">
          {/* The line is drawn in SEGMENTS, one per gap, rather than as a
              single wire behind the row. A continuous wire has to be
              masked wherever a mark sits on it, and the only thing that
              can mask it over a moving background is an opaque disc —
              which is what used to ring every icon. Segments stop short of
              each mark instead, so the row is marks and gaps and nothing
              else. Each step is an equal-width column (`lg:flex-1`), so a
              segment reaches the next mark with percentages of its own
              box: start half a column across plus the clear radius, then
              run a full column less two of those radii. */}
          <ol className="relative grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-4 lg:flex lg:gap-x-0">
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
                  className="watch-scroll-pip relative flex flex-col items-center gap-4 text-center lg:flex-1"
                >
                  {!isLast && (
                    <span
                      aria-hidden
                      data-testid="whats-new-format-link"
                      /* Sits at the marks' optical centre: half of the
                         4rem glyph box. The 3rem clear radius is that half
                         plus a 1rem gap, so the line stops short of the
                         mark on both sides. */
                      className={`absolute top-8 left-[calc(50%+3rem)] hidden h-px w-[calc(100%-6rem)] lg:block ${
                        index === count - 2
                          ? "bg-gradient-to-r from-white/25 to-red-100/55"
                          : "bg-gradient-to-r from-white/12 to-white/25"
                      }`}
                    />
                  )}
                  <span
                    className={`block size-16 ${
                      isLast ? "text-red-100" : "text-white/85"
                    }`}
                  >
                    <Glyph />
                  </span>

                  <span
                    data-testid="whats-new-format-label"
                    className="text-xs font-semibold tracking-[0.18em] text-white uppercase"
                  >
                    {format.label}
                  </span>
                  <span className="text-xs tracking-wide text-white/50 tabular-nums">
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
