import Image from "next/image"

import { type ChatIdentity } from "@/auth/session-cookie"
import { cn } from "@/lib/cn"

import { SignInIcon, SignOutIcon, UserIcon } from "./icons"
import { type CollapsedStyles } from "./sidebar-collapsed-styles"

type SidebarAccountProps = {
  authConfigured: boolean
  identity: ChatIdentity | null
  signInError: boolean
  collapsed: boolean
  styles: CollapsedStyles
  /** feat-209 (KTD8): current `/c/<id>` path — when set, the sign-in anchor
   * round-trips it through /api/auth/login so the conversation survives. */
  signInReturnTo?: string
}

const SIGN_IN_ERROR_TEXT = "Sign-in didn't complete — try again."

/**
 * The rail-foot account control (R2, R4, R6, R12). Signed out → a "Sign in"
 * anchor to /api/auth/login (a full-page redirect is expected). Signed in → the
 * user's identity (name → email → generic label; avatar → initials → icon) plus
 * a "Sign out" POST form. Renders nothing when auth is unconfigured (KTD6).
 *
 * Presentational (no hooks) — inherits the client context of the `'use client'`
 * modules that import it, like the other `sidebar-*` sub-components. Collapse is
 * `md:`-scoped so the same DOM serves the expanded rail, the 68px collapsed rail
 * (icon-only), and the mobile drawer (always full). The accessible name is
 * always carried by an sr-only span so a screen reader announces the user once,
 * never "JD" or nothing, in every presentation.
 */
export function SidebarAccount({
  authConfigured,
  identity,
  signInError,
  collapsed,
  styles,
  signInReturnTo,
}: SidebarAccountProps) {
  if (!authConfigured) return null

  return (
    <div
      className={cn(
        "mt-auto flex flex-col gap-1.5 border-t border-linen/10 px-3 py-3",
        styles.account,
      )}
    >
      {signInError && !identity ? (
        <SignInErrorNotice collapsed={collapsed} styles={styles} />
      ) : null}
      {identity ? (
        <SignedIn identity={identity} collapsed={collapsed} styles={styles} />
      ) : (
        <SignInLink styles={styles} returnTo={signInReturnTo} />
      )}
    </div>
  )
}

/** Signed-in identity row + sign-out form. */
function SignedIn({
  identity,
  collapsed,
  styles,
}: {
  identity: ChatIdentity
  collapsed: boolean
  styles: CollapsedStyles
}) {
  const name = resolveDisplayName(identity)

  return (
    <div
      className={cn(
        "flex items-center gap-2.5",
        collapsed && "md:justify-center",
      )}
      title={name}
    >
      <Avatar identity={identity} />
      {/* Accessible name — always in the DOM so a screen reader announces it in
          every presentation; the visible text below is aria-hidden to avoid a
          double announcement. */}
      <span className="sr-only">{name}</span>
      <div
        aria-hidden="true"
        className={cn("min-w-0 flex-1 leading-tight", styles.accountLabel)}
      >
        <span className="block truncate text-sm font-medium text-linen">
          {name}
        </span>
        {identity.email && identity.email !== name ? (
          <span className="block truncate text-xs text-ash">
            {identity.email}
          </span>
        ) : null}
      </div>
      {/* Sign-out is a POST form (not a GET link — a GET logout is
          prefetchable/crawlable). Reachable only on expand when the desktop rail
          is collapsed (styles.signOut) — the shared-device tradeoff is that a
          collapsed rail must be expanded to sign out. */}
      <form
        method="post"
        action="/api/auth/logout"
        className={cn("shrink-0", styles.signOut)}
      >
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className="inline-flex size-9 items-center justify-center rounded-lg text-ash transition-colors duration-300 hover:bg-linen/[0.06] hover:text-linen"
        >
          <SignOutIcon className="size-[18px]" />
        </button>
      </form>
    </div>
  )
}

/** The signed-out "Sign in" affordance (anchor — a full-page redirect, AE2). */
function SignInLink({
  styles,
  returnTo,
}: {
  styles: CollapsedStyles
  returnTo?: string
}) {
  return (
    <a
      // KTD8: on a /c/<id> render the FAMILIAR rail control must carry the
      // deep link too, or signing in through it silently lands on "/".
      href={
        returnTo
          ? `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
          : "/api/auth/login"
      }
      title="Sign in"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] border border-linen/10 px-3.5 py-2.5 text-sm font-medium text-linen transition-colors duration-300 hover:border-linen/20 hover:bg-linen/[0.04]",
        styles.signIn,
      )}
    >
      <SignInIcon className="size-[18px] shrink-0 text-vesper" />
      <span className={cn("whitespace-nowrap", styles.accountLabel)}>
        Sign in
      </span>
    </a>
  )
}

/** Avatar: picture → initials → generic icon (R4). Decorative; name is sr-only. */
function Avatar({ identity }: { identity: ChatIdentity }) {
  const base =
    "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-linen/10 text-xs font-medium text-linen"
  const initials = resolveInitials(identity)

  if (identity.picture) {
    return (
      <Image
        src={identity.picture}
        alt=""
        width={32}
        height={32}
        unoptimized
        aria-hidden="true"
        className={cn(base, "object-cover")}
      />
    )
  }

  return (
    <span aria-hidden="true" className={base}>
      {initials ?? <UserIcon className="size-4" />}
    </span>
  )
}

/**
 * R12 notice: brief, non-PII, affordance stays present. Full text in the
 * expanded rail / mobile drawer; a `title`-tooltip icon in the collapsed rail so
 * the retry cue is never invisible where a just-returned user lands.
 */
function SignInErrorNotice({
  collapsed,
  styles,
}: {
  collapsed: boolean
  styles: CollapsedStyles
}) {
  return (
    <div role="status">
      <p className={cn("px-1 pb-1 text-xs text-vesper", styles.accountLabel)}>
        {SIGN_IN_ERROR_TEXT}
      </p>
      {collapsed ? (
        <span
          title={SIGN_IN_ERROR_TEXT}
          className="hidden md:flex md:justify-center md:pb-1"
        >
          <SignInIcon className="size-4 text-vesper" />
          <span className="sr-only">{SIGN_IN_ERROR_TEXT}</span>
        </span>
      ) : null}
    </div>
  )
}

function resolveDisplayName(identity: ChatIdentity): string {
  return identity.name ?? identity.email ?? "Signed in"
}

function resolveInitials(identity: ChatIdentity): string | null {
  const source = identity.name ?? identity.email
  if (!source) return null
  const parts = source.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
