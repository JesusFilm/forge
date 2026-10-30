"use client"

// The signed-OUT face of the Partner tab: say what is inside and put the
// sign-in choices right there, no container, no locked preview grid.
// Presentation is the original prototype's.
//
// Behavior adapter: signed-in state comes only from the real Watch session
// (`useWatchAccountSession`, read by the caller). Every sign-in choice is the
// real hosted login; there is no simulated round trip, profile step or guest
// access. Counts are the verified public library's.

import { Check } from "lucide-react"

import { PARTNER_RESOURCES } from "@/components/watch/partner-resources"
import { WatchPartnerLoginForm } from "@/components/watch/WatchPartnerLoginForm"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"

const pdfCount = PARTNER_RESOURCES.filter((r) => r.pdf).length
const kindCount = new Set(PARTNER_RESOURCES.map((r) => r.kind)).size

const PERKS = [
  "Downloads in the languages your people speak, offline ready",
  "Discussion guides, training and campaign kits",
  "Monthly prayer guides, individual and family editions",
]

export function WatchPartnerPromo({
  loginUrl,
  pending,
  unavailable,
  onRetry,
  signInFailed,
}: {
  /** Real login URL from the Watch session endpoint. */
  loginUrl?: string
  /** Session still resolving — keep the form quiet rather than wrong. */
  pending?: boolean
  /** The session could not be confirmed; the visitor stays signed out. */
  unavailable?: boolean
  onRetry?: () => void
  /** The hosted sign-in returned without completing. */
  signInFailed?: boolean
}) {
  return (
    <section
      aria-labelledby="watch-partner-promo-heading"
      data-testid="watch-partner-promo"
      className="w-full min-w-0 pt-12 text-white md:pt-16"
    >
      {/* ---- promo and form share one row ---- */}
      {/* Same 7/5 split and gaps as WatchBody, so this column lines up exactly
          with the Related Questions sidebar above it. */}
      <div className="grid min-w-0 grid-cols-1 gap-10 md:grid-cols-12 md:gap-12 xl:gap-16 2xl:gap-20">
        <div className="col-span-1 min-w-0 md:col-span-7 md:border-r md:border-white/12 md:pr-12 xl:pr-16 2xl:pr-20">
          <p className={WATCH_SECTION_EYEBROW_CLASS}>
            For churches &amp; ministries
          </p>
          <h2
            id="watch-partner-promo-heading"
            className="mt-3 text-3xl leading-[1.08] font-semibold text-balance sm:text-4xl lg:text-[42px]"
          >
            The whole toolkit, free to use.
          </h2>
          <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-white/70">
            Films, printable guides, training and campaign kits for showing this
            story in your community.
          </p>

          <dl className="mt-7 flex min-w-0 flex-wrap gap-x-10 gap-y-4">
            {[
              { n: PARTNER_RESOURCES.length, l: "ministry resources" },
              { n: pdfCount, l: "printable guides" },
              { n: kindCount, l: "categories" },
            ].map((s) => (
              <div key={s.l} className="min-w-0">
                <dt className="text-3xl leading-none font-semibold tabular-nums">
                  {s.n}
                </dt>
                <dd className="mt-1.5 text-[13px] text-white/55">{s.l}</dd>
              </div>
            ))}
          </dl>

          <ul className="mt-7 grid min-w-0 gap-2.5">
            {PERKS.map((p) => (
              <li key={p} className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-red/15">
                  <Check aria-hidden className="size-3 text-brand-red" />
                </span>
                <span className="min-w-0 text-[15px] leading-snug text-white/80">
                  {p}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* ---- sign up or log in, both visible ---- */}
        <div className="col-span-1 min-w-0 border-t border-white/12 pt-10 md:col-span-5 md:border-t-0 md:pt-0">
          {signInFailed ? (
            <p
              role="alert"
              data-testid="watch-partner-auth-notice"
              className="mb-5 text-[14px] leading-relaxed text-white/60"
            >
              Sign-in didn&rsquo;t finish, so you&rsquo;re still signed out.
              Nothing was changed.
            </p>
          ) : null}
          {unavailable ? (
            <p
              role="status"
              data-testid="watch-partner-session-unavailable"
              className="mb-5 text-[14px] leading-relaxed text-white/60"
            >
              We couldn&rsquo;t check your account right now.{" "}
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="cursor-pointer underline decoration-white/25 underline-offset-4 transition-colors hover:text-white/80"
                >
                  Try again
                </button>
              ) : null}
            </p>
          ) : null}
          <WatchPartnerLoginForm pending={pending} loginUrl={loginUrl} />

          <p className="mt-8 text-[12px] leading-relaxed text-white/40">
            Free — no card, no subscription. Watching stays open to everyone.
          </p>
        </div>
      </div>
    </section>
  )
}

/** Small banner shown above the unlocked library once signed in. */
export function WatchPartnerUnlockedNote({ name }: { name?: string }) {
  return (
    <p
      data-testid="watch-partner-unlocked"
      className="mt-12 flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.07] px-4 py-3 text-[14px] text-white/80 md:mt-16"
    >
      <Check aria-hidden className="size-4 shrink-0 text-emerald-400" />
      <span className="min-w-0">
        {name ? `${name}, your` : "Your"} partner materials are unlocked. Every
        download below is free to use in ministry.
      </span>
    </p>
  )
}
