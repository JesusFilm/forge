"use client"

// The Jesus Film One log-in choices, shown inline so the Partner tab does not
// read as "go somewhere else" before it starts. Presentation is the original
// prototype's.
//
// Behavior adapter: Watch sign-in is one hosted OAuth PKCE entry point
// (`/watch/api/auth/login` → auth.jesusfilm.org), which accepts no provider or
// `login_hint` parameter. Every choice here is therefore an ordinary link to
// that real entry point, returning to this page with Partner open, and the
// hosted page shows its own provider picker, email sign-up and sign-in. No
// address is collected here, and nothing is simulated.

import { ChevronDown, CircleHelp, LifeBuoy, Mail } from "lucide-react"
import { useState, type MouseEvent } from "react"

import { watchPartnerAuthHref } from "@/components/watch/WatchPartnerAccount"
import { cn } from "@/lib/utils"

type Provider = {
  id: string
  label: string
  Logo: () => React.ReactElement
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.92l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.26a12 12 0 0 0 0 10.74l4.01-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.26 6.63l4.01 3.09C6.22 6.88 8.87 4.75 12 4.75Z"
      />
    </svg>
  )
}

function FacebookLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path
        fill="#fff"
        d="M16.05 15.47 16.58 12h-3.33V9.75c0-.95.47-1.88 1.96-1.88h1.51V4.92s-1.37-.23-2.68-.23c-2.74 0-4.53 1.66-4.53 4.66V12H6.6v3.47h3.05v8.39a12.1 12.1 0 0 0 3.6 0v-8.39h2.8Z"
      />
    </svg>
  )
}

function OktaLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="currentColor">
      <path d="M12 6.55A5.45 5.45 0 1 0 17.45 12 5.46 5.46 0 0 0 12 6.55Zm0 8.18A2.73 2.73 0 1 1 14.73 12 2.73 2.73 0 0 1 12 14.73Z" />
    </svg>
  )
}

/* The two everyone has, shown with Email. Anything rarer sits under
   "More ways to sign in" so the first screen stays a short set of choices. */
const PROVIDERS: Provider[] = [
  { id: "google", label: "Continue with Google", Logo: GoogleLogo },
  { id: "facebook", label: "Continue with Facebook", Logo: FacebookLogo },
]

const MORE_PROVIDERS: Provider[] = [
  { id: "okta", label: "Continue with Okta", Logo: OktaLogo },
]

const SECONDARY_LINK =
  "inline-flex cursor-pointer items-center gap-2 text-[13px] text-white/45 transition-colors hover:text-white/80"
const SECONDARY_LABEL = "underline decoration-white/25 underline-offset-4"

// The option rows reuse the section's existing choice-button look (same
// resting grey, same white hover fill as the journey's action rows).
const ROW =
  "group flex h-12 w-full cursor-pointer items-center gap-3 rounded-full border border-white/10 bg-white/[0.06] px-5 text-[15px] font-semibold transition-colors hover:border-white hover:bg-white hover:text-stone-900 focus-visible:border-white focus-visible:bg-white focus-visible:text-stone-900 focus-visible:outline-none"

/** Server-rendered fallback; replaced with the current page's URL on click. */
const LOGIN_FALLBACK = "/watch/api/auth/login"

export function WatchPartnerLoginForm({
  pending,
  loginUrl,
}: {
  /** Session still resolving — choices stay inert rather than wrong. */
  pending?: boolean
  /** The login URL the session endpoint returned, when it sent one. */
  loginUrl?: string
}) {
  const [moreOpen, setMoreOpen] = useState(false)

  const signIn = (event: MouseEvent<HTMLAnchorElement>) => {
    if (pending) {
      event.preventDefault()
      return
    }
    event.currentTarget.href = watchPartnerAuthHref("login", loginUrl)
  }
  const link = {
    href: loginUrl ?? LOGIN_FALLBACK,
    onClick: signIn,
    "aria-disabled": pending || undefined,
  }

  return (
    <div data-testid="watch-partner-login" className="min-w-0">
      <h3 className="text-2xl leading-tight font-semibold text-balance">
        Get the free resources
      </h3>
      <p className="mt-2 text-[14px] leading-relaxed text-white/60">
        Create a free account using one of the options below.
      </p>

      <ul className="mt-5 grid min-w-0 gap-3">
        {/* email, as an option in the same list */}
        <li className="min-w-0">
          <a {...link} data-testid="watch-partner-sign-in" className={ROW}>
            <Mail
              aria-hidden
              className="size-5 shrink-0 text-white/75 transition-colors group-hover:text-stone-600"
            />
            <span className="min-w-0 truncate">Continue with Email</span>
          </a>
        </li>

        {PROVIDERS.map((p) => (
          <li key={p.id} className="min-w-0">
            <ProviderRow provider={p} link={link} />
          </li>
        ))}

        {moreOpen
          ? MORE_PROVIDERS.map((p) => (
              <li key={p.id} className="min-w-0">
                <ProviderRow provider={p} link={link} />
              </li>
            ))
          : null}
      </ul>

      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        aria-expanded={moreOpen}
        className={cn(SECONDARY_LINK, "mt-3")}
      >
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 transition-transform",
            moreOpen && "rotate-180",
          )}
        />
        <span className={SECONDARY_LABEL}>
          {moreOpen ? "Fewer options" : "More ways to sign in"}
        </span>
      </button>

      <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
        {/* The hosted page also offers email sign-up for people with none of
            the listed accounts. */}
        <a {...link} className={SECONDARY_LINK}>
          <CircleHelp aria-hidden className="size-4 shrink-0" />
          <span className={SECONDARY_LABEL}>
            I don&rsquo;t use any of these
          </span>
        </a>

        {/* Real destination — the same support form the feedback modal and the
            Watch home footer point at. */}
        <a
          href="https://www.jesusfilm.org/contact/"
          target="_blank"
          rel="noopener noreferrer"
          className={SECONDARY_LINK}
        >
          <LifeBuoy aria-hidden className="size-4 shrink-0" />
          <span className={SECONDARY_LABEL}>Contact our team</span>
        </a>
      </div>
    </div>
  )
}

function ProviderRow({
  provider,
  link,
}: {
  provider: Provider
  link: {
    href: string
    onClick: (event: MouseEvent<HTMLAnchorElement>) => void
    "aria-disabled"?: boolean
  }
}) {
  return (
    <a {...link} className={ROW}>
      <span className="shrink-0">
        <provider.Logo />
      </span>
      <span className="min-w-0 truncate">{provider.label}</span>
    </a>
  )
}
