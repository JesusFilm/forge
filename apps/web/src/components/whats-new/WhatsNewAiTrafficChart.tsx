import { WHATS_NEW_ASSISTANTS } from "@/components/whats-new/whats-new-content"

/**
 * AI-assistant referral trend.
 *
 * Traced point-for-point from the analytics screenshot rather than
 * redrawn by eye: the blue pixel run was sampled per column and resampled
 * onto an even grid, snapping to the local extremum inside each window so
 * the week-to-week spikes survive. Re-run that trace if the screenshot is
 * replaced — a hand-smoothed curve would quietly understate the noise,
 * and the noise is part of what makes the last third read as a real
 * break rather than a trend line.
 *
 * Values are normalised 0–1 against the series' own min and max. They
 * carry NO magnitude: see `WHATS_NEW_ASSISTANTS.chart` for why the
 * vertical axis is deliberately unlabelled.
 */
const SERIES = [
  0.0, 0.015, 0.145, 0.194, 0.216, 0.189, 0.172, 0.131, 0.124, 0.091, 0.202,
  0.216, 0.2, 0.161, 0.157, 0.153, 0.142, 0.153, 0.211, 0.207, 0.161, 0.107,
  0.098, 0.161, 0.167, 0.22, 0.238, 0.277, 0.277, 0.215, 0.171, 0.168, 0.172,
  0.178, 0.218, 0.227, 0.242, 0.222, 0.212, 0.19, 0.167, 0.208, 0.282, 0.259,
  0.245, 0.234, 0.222, 0.197, 0.24, 0.218, 0.207, 0.163, 0.161, 0.139, 0.134,
  0.202, 0.218, 0.213, 0.222, 0.264, 0.282, 0.382, 0.348, 0.335, 0.387, 0.398,
  0.446, 0.453, 0.387, 0.36, 0.369, 0.416, 0.452, 0.517, 0.478, 0.483, 0.431,
  0.406, 0.408, 0.408, 0.404, 0.482, 0.629, 0.652, 0.715, 0.729, 0.726, 0.738,
  0.73, 0.731, 0.758, 0.784, 0.814, 0.912, 0.93, 1.0,
] as const

// Plot box inside the viewBox.
//
// The viewBox is stretched to the container (`preserveAspectRatio="none"`)
// rather than fitted, because a fitted 1000x320 box collapses to ~96px
// tall at phone widths — too flat to read the "level, then climbing"
// shape that is the whole point of the figure. Every stroke therefore
// carries `vectorEffect="non-scaling-stroke"` so weights stay honest
// under the stretch, and the endpoint marker is HTML rather than an SVG
// circle so it cannot be squashed into an ellipse.
const WIDTH = 1000
const HEIGHT = 320
const PLOT_TOP = 14
const PLOT_BOTTOM = 306
const PLOT_LEFT = 0
const PLOT_RIGHT = 1000

const pointAt = (index: number) => {
  const x = PLOT_LEFT + ((PLOT_RIGHT - PLOT_LEFT) * index) / (SERIES.length - 1)
  const y = PLOT_BOTTOM - (PLOT_BOTTOM - PLOT_TOP) * SERIES[index]
  return { x, y }
}

const LINE_PATH = SERIES.map((_, index) => {
  const { x, y } = pointAt(index)
  return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
}).join("")

// Area is the same run of points closed down to the baseline. Drawn as a
// separate element rather than a filled line so the stroke keeps a
// constant weight independent of the fill's opacity ramp.
const AREA_PATH = `${LINE_PATH}L${PLOT_RIGHT} ${PLOT_BOTTOM}L${PLOT_LEFT} ${PLOT_BOTTOM}Z`

const LAST = pointAt(SERIES.length - 1)

/**
 * Single series, so no legend — the caption names it. No tooltip either,
 * which is the one place this deviates from the house chart rules: a
 * crosshair exists to reveal values, and this figure has none to reveal.
 * If real figures ever land in `SERIES`, add the hover layer back.
 */
export function WhatsNewAiTrafficChart() {
  const { chart } = WHATS_NEW_ASSISTANTS

  return (
    <figure
      data-testid="whats-new-ai-traffic-chart"
      /* No `overflow-hidden` here, deliberately. Any `overflow` value
         other than `visible` makes this figure a scroll container, and
         `animation-timeline: view()` on the line inside then resolves
         against a box that never scrolls — the reveal freezes mid-draw at
         whatever progress it first computed, on every viewport, with no
         error anywhere. Nothing in here overflows: the background
         gradient already clips to the border radius, and the SVG clips
         its own contents. */
      className="relative isolate mt-12 rounded-3xl border border-white/12 bg-[linear-gradient(180deg,rgba(124,92,240,0.12),rgba(12,12,10,0.4))] p-6 sm:p-8 lg:mt-16"
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <span className="text-sm font-semibold text-white sm:text-base">
          {chart.metric}
        </span>
        <span className="text-xs tracking-wide text-white/50 sm:text-sm">
          {chart.period}
        </span>
      </figcaption>

      {/* The scroll reveal wipes THIS box — the plot and the endpoint
          marker together — not the SVG group alone. That is what keeps
          the marker in step with the line at every width; see
          `.watch-scroll-trend` in globals.css. */}
      <div className="watch-scroll-trend relative mt-6 h-48 sm:h-60 lg:h-72">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={chart.alt}
          className="size-full"
        >
          <defs>
            <linearGradient
              id="whats-new-trend-fill"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor="#7c5cf0" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#7c5cf0" stopOpacity="0" />
            </linearGradient>
          </defs>

          <g>
            <path d={AREA_PATH} fill="url(#whats-new-trend-fill)" />
            <path
              data-testid="whats-new-trend-line"
              d={LINE_PATH}
              fill="none"
              stroke="#7c5cf0"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>

        {/* Endpoint marker: the one point worth marking directly. HTML and
            absolutely positioned rather than an SVG circle, because the
            viewBox above is stretched and a circle inside it would render
            as an ellipse at every width but one. The surface-coloured ring
            separates it from the line running underneath — a 2px gap, not
            a border drawn around the mark. */}
        <span
          aria-hidden
          data-testid="whats-new-trend-tip"
          style={{
            left: `${((LAST.x / WIDTH) * 100).toFixed(3)}%`,
            top: `${((LAST.y / HEIGHT) * 100).toFixed(3)}%`,
          }}
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stone-950 p-[3px]"
        >
          <span className="block size-full rounded-full bg-[#7c5cf0]" />
        </span>
      </div>
    </figure>
  )
}
