// The feat-209 denial panes (KTD5/KTD6). Presentational — no hooks, no
// 'use client': inherits the client context of app-shell.tsx, which renders
// one of these IN PLACE of <Chat>, never as a branch inside chat.tsx.

/** The two denial pane kinds (KTD5): server-decided by the /c/[id] route
 * ("sign_in", "unavailable"); the client-side escalation reuses "unavailable". */
export type DeniedScreen = "sign_in" | "unavailable"

/**
 * The "no longer available" copy — the single source shared with chat.tsx's
 * ReplayNotAvailable pane, so the two surfaces cannot drift. Deliberately the
 * same sentence for every cause (denied ≡ gone, R7). The rendered output is
 * pinned externally in app-shell.history.test.tsx.
 */
export const CONVERSATION_UNAVAILABLE_COPY =
  "This conversation is no longer available."

// The replay panes' pill (chat.tsx), as an anchor — leaving a denial is a
// clean navigation, never a session mutation (KTD6).
const ACTION_CLASS =
  "rounded-full border border-linen/15 px-4 py-2 text-sm text-linen transition-colors duration-300 hover:bg-linen/[0.06]"

/**
 * Full-pane denial screen, replacing the conversation pane while the sidebar
 * stays rendered. Two screens behind one `screen` prop: "sign_in" (heading +
 * a sign-in anchor carrying `returnTo` through /api/auth/login + a home
 * anchor) and "unavailable" (CONVERSATION_UNAVAILABLE_COPY — the same shared
 * constant chat.tsx's ReplayNotAvailable renders + a home anchor). Real
 * anchors only: no composer, no starter questions, and no role="alert" —
 * a denial is not an error. `returnTo` is the denied `/c/<id>` path.
 */
export function DenialScreen({
  screen,
  returnTo,
}: {
  screen: DeniedScreen
  returnTo?: string
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-8 pt-20">
          <div
            data-denial={screen}
            className="mx-auto flex w-full max-w-[680px] flex-col items-start gap-3"
          >
            {screen === "sign_in" ? (
              <SignInScreen returnTo={returnTo} />
            ) : (
              <UnavailableScreen />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The no-session screen (R6): sign-in returns to the same conversation. */
function SignInScreen({ returnTo }: { returnTo?: string }) {
  const href = returnTo
    ? `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/api/auth/login"
  return (
    <>
      <h1 className="font-display text-[28px] leading-tight font-normal tracking-[-0.01em] text-linen">
        Sign in to view this conversation
      </h1>
      <p className="max-w-[480px] text-[15px] leading-relaxed text-ash">
        This conversation belongs to a signed-in account. You can pick it up
        again after you sign in.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href={href} className={ACTION_CLASS}>
          Sign in
        </a>
        {/* KTD6: a deliberate cross-document navigation that re-resolves
            server-side; never a client-side <Link> (rule off in eslint.config). */}
        <a href="/" className={ACTION_CLASS}>
          Start new conversation
        </a>
      </div>
    </>
  )
}

/** The denied/gone screen (R7) — same copy for every cause, by design. */
function UnavailableScreen() {
  return (
    <>
      <p className="text-sm text-ash">{CONVERSATION_UNAVAILABLE_COPY}</p>
      {/* KTD6: a deliberate cross-document navigation that re-resolves
          server-side; never a client-side <Link> (rule off in eslint.config). */}
      <a href="/" className={ACTION_CLASS}>
        Start new conversation
      </a>
    </>
  )
}
