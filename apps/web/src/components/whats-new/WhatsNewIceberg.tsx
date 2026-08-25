import { WHATS_NEW_ICEBERG } from "@/components/whats-new/whats-new-content"

/**
 * Iceberg for the team section: a small bright tip above the waterline and
 * a much larger mass below it.
 *
 * Hand-authored rather than an icon, for the same reason as the format
 * diagram — it has to carry an argument, not decorate a paragraph. The
 * submerged mass is revealed downward on scroll, so reading the section
 * literally uncovers the work that holds the visible changes up.
 *
 * The two captions are HTML, not SVG `<text>`: they inherit the page's
 * font stack and stay selectable and translatable.
 */
export function WhatsNewIceberg() {
  return (
    <figure
      data-testid="whats-new-iceberg"
      className="relative mx-auto w-full max-w-md"
    >
      <svg
        viewBox="0 0 320 400"
        role="img"
        aria-label={WHATS_NEW_ICEBERG.alt}
        className="w-full"
      >
        <defs>
          <linearGradient id="whats-new-berg-tip" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eef2ff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#a8b6e6" stopOpacity="0.75" />
          </linearGradient>
          <linearGradient id="whats-new-berg-sub" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c8ad4" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#5a5aa8" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#2a2350" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="whats-new-berg-ray" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bcc6ff" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#bcc6ff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Light falling through the water. */}
        <g className="watch-berg-rays">
          <path d="M96 150 76 400h26l24-250z" fill="url(#whats-new-berg-ray)" />
          <path
            d="M186 150 210 400h-22l-18-250z"
            fill="url(#whats-new-berg-ray)"
          />
        </g>

        <g className="watch-berg-bob">
          {/* Submerged mass — the part the section is about. */}
          <g className="watch-scroll-berg">
            <path
              d="M62 150 96 240 82 306l46 52 50 16 56-44 28-86-12-70-14-64z"
              fill="url(#whats-new-berg-sub)"
              stroke="#aebbf0"
              strokeOpacity="0.28"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <g stroke="#c3cdf7" strokeOpacity="0.16" strokeWidth="1.25">
              <path d="M112 152 128 232l-46 74" />
              <path d="M178 154 168 268l60 62" />
              <path d="M128 232l40 36" />
              <path d="M168 268l-40 90" />
            </g>
          </g>

          {/* Waterline. */}
          <g className="watch-berg-ripple">
            <path
              d="M4 150h312"
              stroke="#dfe6ff"
              strokeOpacity="0.5"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M22 157h58M104 157h44M172 157h72M258 157h34"
              stroke="#dfe6ff"
              strokeOpacity="0.22"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
          </g>

          {/* Tip — everything anyone actually sees. */}
          <path
            d="M110 150 138 74l22-30 26 44 28 62z"
            fill="url(#whats-new-berg-tip)"
            stroke="#eef2ff"
            strokeOpacity="0.6"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M160 44 150 150M160 44l26 44"
            stroke="#6f7bb5"
            strokeOpacity="0.35"
            strokeWidth="1.25"
          />
        </g>
      </svg>

      <figcaption className="pointer-events-none absolute inset-0">
        <span className="absolute top-[9%] right-[4%] max-w-[8rem] text-right text-[0.6875rem] leading-snug font-semibold tracking-[0.16em] text-white uppercase">
          {WHATS_NEW_ICEBERG.tip}
        </span>
        <span className="absolute right-[4%] bottom-[16%] max-w-[9rem] text-right text-[0.6875rem] leading-snug font-semibold tracking-[0.16em] text-white/60 uppercase">
          {WHATS_NEW_ICEBERG.mass}
        </span>
      </figcaption>
    </figure>
  )
}
