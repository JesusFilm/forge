"use client"

import Image from "next/image"
import { useEffect, useState, type FormEvent } from "react"

import { WatchFilmCollageBackground } from "@/app/login/watch-film-collage-background"
import {
  formatUserCodeForDisplay,
  isPlausibleUserCode,
  normalizeUserCode,
  resolveUserCodeInputMode,
} from "@/lib/device-user-code"

import { buildDeviceLoginRedirect } from "./device-login-redirect"

export type DeviceErrorCode =
  | "invalid_request"
  | "expired_token"
  | "device_code_already_processed"
  | "unauthorized"
  | "temporarily_unavailable"
  | "network"

type DeviceErrorCopy = {
  code: DeviceErrorCode
  title: string
  detail: string
}

type DevicePhase = "entry" | "review" | "approved" | "denied" | "failed"

type DeviceStatusResponse = {
  user_code?: string
  status?: string
  client_name?: string
  expires_in?: number
}

/**
 * Every branch is a distinct outcome the person on the phone can act on. A
 * single "something went wrong" would leave them re-entering a code that can
 * never work.
 */
export function describeDeviceError(code: string | undefined): DeviceErrorCopy {
  switch (code) {
    case "invalid_request":
      return {
        code: "invalid_request",
        title: "That code was not recognized.",
        detail:
          "Check the code on your TV screen and enter it again. Codes change often, so it may already have been replaced.",
      }
    case "expired_token":
      return {
        code: "expired_token",
        title: "That code has expired.",
        detail:
          "Your TV should be showing a new code now. Enter the new one to continue.",
      }
    case "device_code_already_processed":
      return {
        code: "device_code_already_processed",
        title: "That code was already used.",
        detail:
          "This request has already been approved or denied. Start again on your TV to get a fresh code.",
      }
    case "unauthorized":
      return {
        code: "unauthorized",
        title: "Your sign-in session ended.",
        detail: "Sign in again to approve this TV.",
      }
    // The kill switch (`assertEnabled` in device-grant-plugin.ts) answers 503
    // with this code. Without its own branch it reads as "check your
    // connection", which sends the person on the phone to reboot a router over
    // a server-side feature flag.
    case "temporarily_unavailable":
      return {
        code: "temporarily_unavailable",
        title: "TV sign-in is unavailable right now.",
        detail:
          "This is on our side, not yours. Try again later, or sign in on your TV another way.",
      }
    default:
      return {
        code: "network",
        title: "We could not reach Jesus Film.",
        detail: "Check your connection and try again.",
      }
  }
}

/**
 * True when the server has actually ruled on the code, so no amount of
 * retrying will change the answer and the decision buttons should go away.
 *
 * `network` is the catch-all for everything we could not attribute — a 502
 * from the edge, an HTML error page, a dropped connection. Those must stay
 * NON-terminal: locking Approve and Deny over a transient failure forces the
 * person on the phone to re-type a code that was never wrong. Both the status
 * lookup and the approve/deny POST route through this one predicate so the two
 * cannot drift.
 */
export function isTerminalDeviceError(code: DeviceErrorCode): boolean {
  return code !== "network"
}

export function DeviceApprovalPageClient({
  accountEmail,
  fallbackAppName,
  initialUserCode,
}: {
  accountEmail: string
  fallbackAppName: string
  initialUserCode: string
}) {
  const [userCode, setUserCode] = useState(initialUserCode)
  const [draft, setDraft] = useState(initialUserCode)
  const [phase, setPhase] = useState<DevicePhase>(
    initialUserCode ? "review" : "entry",
  )
  const [appName, setAppName] = useState<string | null>(null)
  const [error, setError] = useState<DeviceErrorCopy | null>(null)
  const [pending, setPending] = useState<"approve" | "deny" | null>(null)

  const isReviewing = phase === "review"

  // Enrichment only. Everything the human needs to make the decision is
  // already on screen from the first paint; this names the requesting app and
  // catches a dead code before they tap Approve. Effect-local controller: no
  // hook-lifetime ref survives a StrictMode remount.
  useEffect(() => {
    if (!isReviewing || !userCode) return

    const controller = new AbortController()

    async function loadStatus(code: string) {
      try {
        const res = await fetch(
          `/api/auth/device/status?user_code=${encodeURIComponent(code)}`,
          { credentials: "include", signal: controller.signal },
        )

        if (!res.ok) {
          const failure = describeDeviceError(await readDeviceErrorCode(res))
          if (controller.signal.aborted) return
          // A transient lookup failure must not take the decision away; only a
          // code the server has actually ruled out is terminal.
          if (!isTerminalDeviceError(failure.code)) return
          setError(failure)
          setPhase("failed")
          return
        }

        const body = (await res.json()) as DeviceStatusResponse
        if (controller.signal.aborted) return
        if (body.client_name) setAppName(body.client_name)
      } catch {
        // A failed lookup must not block the decision: the approve POST is the
        // real gate, and it reports the same error codes.
      }
    }

    void loadStatus(userCode)

    return () => {
      controller.abort()
    }
  }, [isReviewing, userCode])

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalized = normalizeUserCode(draft)
    if (!isPlausibleUserCode(normalized)) return

    setUserCode(normalized)
    setAppName(null)
    setError(null)
    setPhase("review")
  }

  function startOver() {
    setDraft("")
    setUserCode("")
    setAppName(null)
    setError(null)
    setPhase("entry")
  }

  async function decide(decision: "approve" | "deny") {
    setPending(decision)
    setError(null)

    try {
      const res = await fetch(`/api/auth/device/${decision}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_code: userCode }),
      })

      if (res.ok) {
        setPhase(decision === "approve" ? "approved" : "denied")
        return
      }

      const failure = describeDeviceError(await readDeviceErrorCode(res))
      setError(failure)
      // Same rule as the status lookup above: an unattributable failure leaves
      // the decision live rather than stranding the person mid-approval.
      if (isTerminalDeviceError(failure.code)) setPhase("failed")
    } catch {
      setError(describeDeviceError(undefined))
    } finally {
      setPending(null)
    }
  }

  const requestingAppName = appName ?? fallbackAppName
  const isBusy = pending !== null

  return (
    <main className="font-apercu relative grid min-h-screen grid-cols-1 overflow-hidden bg-[#0c0a09] max-[820px]:block max-[820px]:overflow-y-auto">
      <WatchFilmCollageBackground />
      <div className="relative z-10 m-auto grid w-[min(calc(100%_-_32px),980px)] gap-4 py-8 max-[820px]:mx-auto max-[820px]:-mt-[188px] max-[820px]:w-full max-[820px]:max-w-[480px] max-[820px]:gap-0 max-[820px]:py-0">
        <section className="grid min-h-[620px] w-full grid-cols-[minmax(0,1fr)_minmax(320px,420px)] overflow-hidden rounded-md border border-white/8 bg-[rgba(20,17,15,0.72)] shadow-[0_28px_90px_rgba(0,0,0,0.68)] backdrop-blur-[5px] max-[820px]:min-h-0 max-[820px]:grid-cols-1 max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:!bg-transparent max-[820px]:shadow-none max-[820px]:backdrop-blur-none">
          <div className="grid min-h-[560px] content-end gap-[22px] border-r border-white/8 p-12 text-[#f5f5f4] max-[820px]:min-h-0 max-[820px]:content-start max-[820px]:gap-5 max-[820px]:border-b-0 max-[820px]:border-r-0 max-[820px]:p-7 max-[820px]:pt-0">
            <Image
              src="/images/jesus-film-logo-brandpad-cropped.png"
              alt="Jesus Film Project"
              width={799}
              height={272}
              className="h-auto w-[178px]"
            />
            <div className="grid gap-2 max-[820px]:mt-6">
              <h1 className="m-0 max-w-[560px] text-[clamp(36px,6.4vw,68px)] font-bold leading-[0.94] tracking-[-0.03em] max-[820px]:text-[34px] max-[820px]:leading-[0.98]">
                Connect your TV.
              </h1>
              <p className="font-noto-serif m-0 max-w-[440px] text-[15px] leading-6 text-[#d6d3d1]">
                Only continue if the code below is the one showing on your TV
                right now. If it is not, deny the request.
              </p>
            </div>
          </div>

          <div className="bg-[rgba(12,10,9,0.84)] p-12 text-[#f5f5f4] max-[820px]:!bg-transparent max-[820px]:p-7">
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#a8a29e]">
              TV sign-in request
            </p>

            {phase === "entry" ? (
              <form onSubmit={submitCode}>
                <h2 className="mb-2 mt-2 text-2xl font-bold">
                  Enter the code from your TV
                </h2>
                <p className="font-noto-serif mb-0 mt-3 text-[13px] leading-5 text-[#d6d3d1]">
                  Your TV is showing a short code. Type it here to continue.
                </p>

                <div className="mt-6 grid gap-1.5">
                  <label
                    className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#d6d3d1]"
                    htmlFor="user_code"
                  >
                    Code from your TV
                  </label>
                  <input
                    id="user_code"
                    name="user_code"
                    type="text"
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode={resolveUserCodeInputMode(draft)}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="019-450-7302"
                    className="h-[52px] w-full rounded border border-white/10 bg-transparent px-3 text-center text-[22px] font-bold tracking-[0.24em] text-[#f5f5f4] outline-none placeholder:tracking-[0.16em] placeholder:text-[#57534e] focus:border-[#ef3340] focus:shadow-[0_0_0_3px_rgba(239,51,64,0.12)]"
                  />
                </div>

                <button
                  className="relative mt-5 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2.5 rounded border-0 bg-[#ef3340] font-bold text-white transition-[background-color,box-shadow] duration-150 hover:bg-[#d91f2b] hover:shadow-[0_10px_26px_rgba(239,51,64,0.22)] focus-visible:shadow-[0_0_0_3px_rgba(239,51,64,0.24)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={!isPlausibleUserCode(draft)}
                  type="submit"
                >
                  Continue
                </button>
              </form>
            ) : null}

            {phase === "review" || phase === "failed" ? (
              <>
                <h2 className="mb-2 mt-2 text-2xl font-bold">
                  {requestingAppName}
                </h2>
                <p className="font-noto-serif mb-0 mt-3 text-[13px] leading-5 text-[#d6d3d1]">
                  A TV is asking to sign in to your Jesus Film account.
                </p>

                <div className="mt-6 rounded border border-white/10 bg-white/[0.03] px-3.5 py-4 text-center">
                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#a8a29e]">
                    Code on your TV
                  </p>
                  <p className="m-0 mt-2 text-[26px] font-bold leading-none tracking-[0.18em] text-[#f5f5f4]">
                    {formatUserCodeForDisplay(userCode)}
                  </p>
                  <p className="font-noto-serif mb-0 mt-2.5 text-xs leading-[1.55] text-[#d6d3d1]">
                    This must match the code on your TV screen exactly. If it
                    does not, someone else may be trying to use your account.
                  </p>
                </div>

                <div className="mt-4 rounded border border-white/10 bg-white/[0.03] px-3.5 py-3">
                  <strong className="block text-[13px] leading-[1.35] text-[#f5f5f4]">
                    Approving as {accountEmail}
                  </strong>
                  <p className="font-noto-serif mb-0 mt-1 text-xs leading-[1.55] text-[#d6d3d1]">
                    The TV will be signed in to this account.{" "}
                    <a
                      className="font-apercu font-bold text-[#f5f5f4] underline decoration-white/25 underline-offset-4 transition-colors duration-150 hover:decoration-white"
                      href={buildDeviceLoginRedirect(userCode)}
                    >
                      Not you?
                    </a>
                  </p>
                </div>

                {error ? (
                  <DeviceErrorNotice error={error} code={userCode} />
                ) : null}

                {/* Deny is first, the same size, and the same weight as
                    Approve. A de-emphasised deny is a phishing affordance. */}
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    className="relative inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2.5 rounded border border-white/40 bg-white/[0.1] font-bold text-[#f5f5f4] transition-[background-color,border-color,box-shadow] duration-150 hover:border-white/70 hover:bg-white/[0.16] focus-visible:shadow-[0_0_0_3px_rgba(255,255,255,0.24)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                    disabled={isBusy || !isReviewing}
                    onClick={() => void decide("deny")}
                    type="button"
                  >
                    <span className="min-w-0">Deny</span>
                    {pending === "deny" ? <BusySpinner /> : null}
                  </button>
                  <button
                    className="relative inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2.5 rounded border border-[#ef3340] bg-[#ef3340] font-bold text-white transition-[background-color,box-shadow] duration-150 hover:bg-[#d91f2b] hover:shadow-[0_10px_26px_rgba(239,51,64,0.22)] focus-visible:shadow-[0_0_0_3px_rgba(239,51,64,0.24)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                    disabled={isBusy || !isReviewing}
                    onClick={() => void decide("approve")}
                    type="button"
                  >
                    <span className="min-w-0">Approve</span>
                    {pending === "approve" ? <BusySpinner /> : null}
                  </button>
                </div>

                <button
                  className="mt-3 flex h-[42px] w-full cursor-pointer items-center justify-center rounded border border-transparent bg-transparent px-4 text-[13px] font-bold text-[#d6d3d1] transition-colors duration-150 hover:text-[#f5f5f4] focus-visible:border-white/25 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={isBusy}
                  onClick={startOver}
                  type="button"
                >
                  Enter a different code
                </button>
              </>
            ) : null}

            {phase === "approved" || phase === "denied" ? (
              <>
                <h2 className="mb-2 mt-2 text-2xl font-bold">
                  {phase === "approved" ? "TV connected." : "Request denied."}
                </h2>
                <p className="font-noto-serif mb-0 mt-3 text-[13px] leading-5 text-[#d6d3d1]">
                  {phase === "approved"
                    ? `${requestingAppName} is signing in on your TV now. You can put your phone down and carry on there.`
                    : "Nothing was shared. If you did not start this, no action is needed."}
                </p>
                <div className="mt-6 rounded border border-white/10 bg-white/[0.03] px-3.5 py-3">
                  <strong className="block text-[13px] leading-[1.35] text-[#f5f5f4]">
                    Code {formatUserCodeForDisplay(userCode)}
                  </strong>
                  <p className="font-noto-serif mb-0 mt-1 text-xs leading-[1.55] text-[#d6d3d1]">
                    {phase === "approved"
                      ? `Signed in as ${accountEmail}.`
                      : "This code can no longer be used."}
                  </p>
                </div>
              </>
            ) : null}
          </div>
        </section>

        <nav
          aria-label="Legal"
          className="flex items-center justify-center gap-4 text-[13px] font-bold leading-none text-[#d6d3d1] max-[820px]:pb-6"
        >
          <a
            className="underline decoration-white/35 underline-offset-4 transition-colors duration-150 hover:text-[#f5f5f4] hover:decoration-white/80"
            href="https://www.jesusfilm.org/terms/"
            rel="noopener noreferrer"
            target="_blank"
          >
            Terms of Use
          </a>
          <span aria-hidden="true" className="text-white/30">
            |
          </span>
          <a
            className="underline decoration-white/35 underline-offset-4 transition-colors duration-150 hover:text-[#f5f5f4] hover:decoration-white/80"
            href="https://www.jesusfilm.org/privacy/"
            rel="noopener noreferrer"
            target="_blank"
          >
            Privacy Policy
          </a>
        </nav>
      </div>
    </main>
  )
}

function DeviceErrorNotice({
  code,
  error,
}: {
  code: string
  error: DeviceErrorCopy
}) {
  return (
    <div
      role="alert"
      className="mt-[18px] border-l-[3px] border-l-[#ef3340] bg-[rgba(239,51,64,0.1)] px-3.5 py-3"
    >
      <strong className="block text-[13px] leading-[1.35] text-red-200">
        {error.title}
      </strong>
      <p className="font-noto-serif mb-0 mt-1 text-xs leading-[1.55] text-[#d6d3d1]">
        {error.detail}
      </p>
      {error.code === "unauthorized" ? (
        <a
          className="font-apercu mt-2 inline-block text-xs font-bold text-[#f5f5f4] underline decoration-white/25 underline-offset-4 transition-colors duration-150 hover:decoration-white"
          href={buildDeviceLoginRedirect(code)}
        >
          Sign in again
        </a>
      ) : null}
    </div>
  )
}

function BusySpinner() {
  return (
    <span
      aria-hidden="true"
      className="absolute right-4 size-4 animate-spin rounded-full border-2 border-white/35 border-t-white"
    />
  )
}

/**
 * Read the machine-readable `error` code out of a failure body — and nothing
 * else. `oauthError()` also sends `error_description`, whose text is composed
 * server-side and can quote the submitted user code; rendering it would put a
 * credential on screen and into any client-side error reporting. The code
 * alone selects copy that this file owns.
 */
export async function readDeviceErrorCode(
  res: Response,
): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === "string" && body.error) return body.error
  } catch {
    // Fall through: a body-less 401 still tells us the session is gone.
  }

  return res.status === 401 || res.status === 403 ? "unauthorized" : undefined
}
