"use client"

// PROTOTYPE — throwaway. The prayer-year map, drawn as vector in the DOM rather
// than baked into the banner image.
//
// The outlines are Natural Earth 110m (public domain, via world-atlas@2) — the
// whole world, not the guide's cropped eastern-hemisphere artwork. The twelve
// countries of the prayer year are their own paths, so they can be tinted and
// this month's country filled and labelled by its real shape. Not for commit.

import {
  PRAYER_MAP_CENTROIDS,
  PRAYER_MAP_LAND,
  PRAYER_MAP_TWELVE,
  PRAYER_MAP_VIEWBOX,
} from "@/components/watch/prayer-map-path"
import { cn } from "@/lib/utils"

export function PrayerMap({
  highlight,
  className,
}: {
  /** The country to fill and label — this month's. */
  highlight: string
  className?: string
}) {
  const anchor = PRAYER_MAP_CENTROIDS[highlight] ?? null
  const label = highlight.toUpperCase()
  /* The pill is sized from the character count, which is only ever an estimate
     of how wide the text will actually draw — a short country in a wide font
     used to spill out of both ends. `textLength` below pins the drawn width to
     exactly this box minus its padding, so the text cannot overflow whatever
     the font does. */
  const LABEL_PAD = 14
  const labelText = label.length * 10.4
  const labelWidth = labelText + LABEL_PAD * 2

  return (
    <svg
      viewBox={PRAYER_MAP_VIEWBOX}
      role="img"
      aria-label={`World map of the twelve least-reached countries, with ${highlight} highlighted`}
      data-testid="watch-prayer-map"
      className={cn("h-full w-full", className)}
    >
      <defs>
        <radialGradient id="prayer-map-glow">
          <stop offset="0%" stopColor="#E23B47" stopOpacity="0.5" />
          <stop offset="55%" stopColor="#E23B47" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#E23B47" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* everywhere else */}
      <path d={PRAYER_MAP_LAND} fill="rgba(231,226,218,0.16)" />

      {/* the twelve */}
      {Object.entries(PRAYER_MAP_TWELVE).map(([country, d]) =>
        country === highlight ? null : (
          <path key={country} d={d} fill="rgba(231,226,218,0.34)" />
        ),
      )}

      {anchor ? (
        <>
          <circle
            cx={anchor[0]}
            cy={anchor[1]}
            r={62}
            fill="url(#prayer-map-glow)"
          />
          <circle
            cx={anchor[0]}
            cy={anchor[1]}
            r={14}
            fill="none"
            stroke="#E23B47"
            strokeWidth={1.6}
          >
            <animate
              attributeName="r"
              values="10;26;10"
              dur="3.6s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.9;0;0.9"
              dur="3.6s"
              repeatCount="indefinite"
            />
          </circle>
        </>
      ) : null}

      {/* this month's country, by its own shape */}
      {PRAYER_MAP_TWELVE[highlight] ? (
        <path
          d={PRAYER_MAP_TWELVE[highlight]}
          fill="#E23B47"
          stroke="#ffffff"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      ) : null}

      {anchor ? (
        <g>
          <line
            x1={anchor[0]}
            y1={anchor[1]}
            x2={anchor[0] + 34}
            y2={anchor[1] - 34}
            stroke="rgba(255,255,255,0.7)"
            strokeWidth={1.2}
          />
          <rect
            x={anchor[0] + 34}
            y={anchor[1] - 48}
            rx={13}
            ry={13}
            width={labelWidth}
            height={26}
            fill="#ffffff"
          />
          <text
            x={anchor[0] + 34 + LABEL_PAD}
            y={anchor[1] - 30}
            textLength={labelText}
            lengthAdjust="spacingAndGlyphs"
            fill="#181412"
            fontSize={13}
            fontWeight={700}
          >
            {label}
          </text>
        </g>
      ) : null}
    </svg>
  )
}
