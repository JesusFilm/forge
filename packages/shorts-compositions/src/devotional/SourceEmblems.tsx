import { Easing, interpolate } from "remotion"

/**
 * The credit emblems as live line art (owner, 2026-09-29: the book could turn
 * a page, the scroll roll up and open again; nothing special, a small
 * pleasure). Drawn after the owner's ChatGPT icons in source-portraits.ts:
 * white round-capped strokes on transparency, in the same 344x252 box.
 *
 * `t` is seconds since the emblem appeared; the motion starts a moment after
 * it has settled and plays once.
 */
const EASE = Easing.bezier(0.45, 0, 0.25, 1)
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const STROKE = {
  fill: "none",
  stroke: "#fff",
  strokeWidth: 9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const

const phase = (t: number, from: number, to: number) =>
  interpolate(t, [from, to], [0, 1], { ...clamp, easing: EASE })

/** A wavy line of "text" from x0 to x1 at height y. */
const wave = (x0: number, x1: number, y: number) => {
  const n = 3
  const step = (x1 - x0) / n
  let d = `M${x0},${y}`
  for (let i = 0; i < n; i++) {
    const a = x0 + step * i
    d += ` Q${a + step / 4},${y - 6} ${a + step / 2},${y} T${a + step},${y}`
  }
  return d
}

// Right-hand page with the spine at x = 0.
const PAGE = "M0,62 C32,44 72,42 108,50 L108,186 C72,178 32,180 0,198"

export function AnimatedBook({ t }: { t: number }) {
  // Two pages turn, one after the other.
  // Slow enough to read at emblem size (owner: the quicker turn was hard to
  // see), and the turning page is filled so it reads as a sheet.
  const flips = [phase(t, 0.9, 2.0), phase(t, 2.3, 3.4)]
  return (
    <svg viewBox="0 0 344 252" width="100%" height="100%">
      <path
        {...STROKE}
        d="M52,62 L52,200 C100,192 140,196 172,210 C204,196 244,192 292,200 L292,62"
      />
      <path {...STROKE} d={PAGE} transform="translate(172,0) scale(-1,1)" />
      <path {...STROKE} d={PAGE} transform="translate(172,0)" />
      <path {...STROKE} d="M172,62 L172,198" />
      {[96, 124, 152].map((y) => (
        <g key={y}>
          <path {...STROKE} d={wave(88, 150, y)} />
          <path {...STROKE} d={wave(194, 256, y)} />
        </g>
      ))}
      {flips.map((p, i) =>
        p > 0 && p < 1 ? (
          <path
            key={i}
            {...STROKE}
            fill="rgba(255,255,255,0.32)"
            d={`${PAGE} Z`}
            // Turning over the spine: full width on the right, edge-on in the
            // middle, full width on the left; lifted a touch at mid-turn.
            transform={`translate(172,${(-22 * Math.sin(Math.PI * p)).toFixed(2)}) scale(${Math.cos(Math.PI * p).toFixed(4)},1)`}
          />
        ) : null,
      )}
    </svg>
  )
}

export function AnimatedScroll({ t }: { t: number }) {
  // Rolls up towards the middle, then opens again.
  const closing = phase(t, 1.0, 1.9)
  const opening = phase(t, 2.25, 3.15)
  const half = 102 - 76 * (closing - opening)
  const xl = 172 - half
  const xr = 172 + half
  const roller = (x: number) => (
    <g>
      <rect {...STROKE} x={x - 13} y={60} width={26} height={132} rx={12} />
      <path {...STROKE} d={`M${x},60 L${x},42 M${x},192 L${x},210`} />
      <circle {...STROKE} cx={x} cy={36} r={7} />
      <circle {...STROKE} cx={x} cy={216} r={7} />
    </g>
  )
  const a = xl + 13
  const b = xr - 13
  return (
    <svg viewBox="0 0 344 252" width="100%" height="100%">
      <defs>
        <clipPath id="scroll-paper">
          <rect x={a} y={0} width={Math.max(0, b - a)} height={252} />
        </clipPath>
      </defs>
      <g clipPath="url(#scroll-paper)">
        <path
          {...STROKE}
          d={`M${a},78 C${a + (b - a) * 0.35},64 ${a + (b - a) * 0.65},92 ${b},78`}
        />
        <path
          {...STROKE}
          d={`M${a},174 C${a + (b - a) * 0.35},160 ${a + (b - a) * 0.65},188 ${b},174`}
        />
        {[108, 128, 148].map((y) => (
          <g key={y}>
            <path {...STROKE} d={wave(106, 162, y)} />
            <path {...STROKE} d={wave(182, 238, y)} />
          </g>
        ))}
      </g>
      {roller(xl)}
      {roller(xr)}
    </svg>
  )
}
