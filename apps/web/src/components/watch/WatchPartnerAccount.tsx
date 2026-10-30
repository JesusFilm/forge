"use client"

import type { MouseEvent, ReactNode } from "react"

import {
  useWatchAccountSession,
  watchAccountAuthUrl,
  type WatchAccountUser,
} from "@/components/watch/use-watch-account-session"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"

export type WatchPartnerAccountProps = {
  /**
   * The account-only tools. Called only while the server confirms a real
   * session, with that session's identity; never called while checking,
   * signed out, or unable to confirm. Lazy-load heavy tools inside it
   * (`next/dynamic`) so they cost nothing until an account exists.
   */
  children: (account: { user?: WatchAccountUser }) => ReactNode
}

/**
 * The hosted login/logout URL for the Partner tab, returning to this page with
 * Partner open. Call at click time: the page may have changed since render.
 */
export function watchPartnerAuthHref(
  kind: "login" | "logout",
  loginUrl?: string,
): string {
  const auth = new URL(
    watchAccountAuthUrl(kind, loginUrl),
    window.location.origin,
  )
  const returned = new URL(
    auth.searchParams.get("returnTo") ?? window.location.href,
    window.location.origin,
  )
  returned.searchParams.set("partnerPanel", "account")
  returned.searchParams.set("as", "partner")
  auth.searchParams.set(
    "returnTo",
    returned.pathname + returned.search + returned.hash,
  )
  return auth.href
}

const ACTION_CLASS =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-white/40 px-5 py-2 text-sm font-semibold text-white transition-colors hover:border-white hover:bg-white hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"

/**
 * Partner account entry. Signing in uses the existing hosted Auth flow and
 * returns to this page; the audience role lives in its own store and is never
 * touched here. Mount only where Partner is open so no session request is made
 * for visitors who never use it.
 */
export function WatchPartnerAccount({ children }: WatchPartnerAccountProps) {
  const { session, retry } = useWatchAccountSession()
  // Only read once the session has been read, which happens on the client
  // alone, so server rendering never touches `window`.
  const signInFailed =
    (session.status === "signed-out" || session.status === "unavailable") &&
    new URLSearchParams(window.location.search).get("auth") === "failed"

  const refreshReturnTo = (
    event: MouseEvent<HTMLAnchorElement>,
    kind: "login" | "logout",
    loginUrl?: string,
  ) => {
    // The page may have changed since the session was read.
    event.currentTarget.href = watchPartnerAuthHref(kind, loginUrl)
  }

  return (
    <section
      aria-labelledby="watch-partner-account-heading"
      aria-busy={session.status === "checking"}
      data-testid="watch-partner-account"
      data-account-state={session.status}
      className="w-full min-w-0 text-white"
    >
      <div className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
        <p className={WATCH_SECTION_EYEBROW_CLASS}>Partner tools</p>
        <h2
          id="watch-partner-account-heading"
          className="mt-3 text-2xl leading-tight font-semibold text-balance sm:text-3xl"
        >
          {session.status === "signed-in"
            ? "You’re signed in"
            : "Sign in to use partner tools"}
        </h2>

        {signInFailed ? (
          <p
            role="alert"
            data-testid="watch-partner-auth-notice"
            className="mt-4 max-w-[52ch] rounded-xl border border-amber-300/40 bg-amber-200/10 px-4 py-3 text-sm leading-relaxed text-amber-50"
          >
            Sign-in didn’t finish, so you’re still signed out. Nothing was
            changed and you’re back on the same page.
          </p>
        ) : null}

        {session.status === "checking" ? (
          <p className="mt-3 text-base text-white/70">Checking your account…</p>
        ) : null}

        {session.status === "unavailable" ? (
          <>
            <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-white/70">
              We couldn’t check your account right now, so partner tools stay
              locked. Your page and audience choice are unchanged.
            </p>
            <div className="mt-5">
              <button type="button" className={ACTION_CLASS} onClick={retry}>
                Try again
              </button>
            </div>
          </>
        ) : null}

        {session.status === "signed-out" ? (
          <>
            <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-white/70">
              Partner tools use your Jesus Film Project account. The resource
              library stays open to everyone without signing in.
            </p>
            <div className="mt-5">
              <a
                data-testid="watch-partner-sign-in"
                href={watchAccountAuthUrl("login", session.loginUrl)}
                onClick={(event) =>
                  refreshReturnTo(event, "login", session.loginUrl)
                }
                className={ACTION_CLASS}
              >
                Sign in
              </a>
            </div>
          </>
        ) : null}

        {session.status === "signed-in" ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="min-w-0 text-base text-white/80">
              <span className="font-semibold text-white">
                {session.user?.name?.trim() ||
                  session.user?.email?.trim() ||
                  "Your account"}
              </span>
              {session.user?.name?.trim() && session.user.email?.trim() ? (
                <span className="ml-2 text-white/60">
                  {session.user.email.trim()}
                </span>
              ) : null}
            </p>
            <a
              data-testid="watch-partner-sign-out"
              href={watchAccountAuthUrl("logout")}
              onClick={(event) => refreshReturnTo(event, "logout")}
              className={ACTION_CLASS}
            >
              Sign out
            </a>
          </div>
        ) : null}
      </div>

      {session.status === "signed-in" ? (
        <div data-testid="watch-partner-account-tools" className="mt-6">
          {children({ user: session.user })}
        </div>
      ) : null}
    </section>
  )
}
