"use client"

import Image from "next/image"
import { useState } from "react"

import { WatchFilmCollageBackground } from "@/app/login/watch-film-collage-background"

type ConsentScope = {
  key: string
  label: string
  description: string
}

export function OAuthConsentPageClient({
  oauthQuery,
  requestingAppName,
  scopes,
  target,
  unverifiedDynamicClient = false,
}: {
  oauthQuery: string
  requestingAppName: string
  scopes: ConsentScope[]
  target?: { environment: string; product: string; resource: string }
  unverifiedDynamicClient?: boolean
}) {
  const [isSubmitting, setIsSubmitting] = useState<"accept" | "deny" | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  async function submitConsent(accept: boolean) {
    setIsSubmitting(accept ? "accept" : "deny")
    setError(null)

    try {
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accept,
          oauth_query: oauthQuery,
        }),
      })

      const redirectUrl = await resolveRedirectUrl(res)
      if (redirectUrl) {
        window.location.href = redirectUrl
        return
      }

      setError("We could not continue authorization. Refresh and try again.")
    } catch {
      setError("We could not continue authorization. Refresh and try again.")
    } finally {
      setIsSubmitting(null)
    }
  }

  const isBusy = isSubmitting !== null

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
                Authorize access.
              </h1>
              <p className="font-noto-serif m-0 max-w-[440px] text-[15px] leading-6 text-[#d6d3d1]">
                Continue only if you trust {requestingAppName} to use your Jesus
                Film account for the permissions shown.
              </p>
            </div>
          </div>

          <div className="bg-[rgba(12,10,9,0.84)] p-12 text-[#f5f5f4] max-[820px]:!bg-transparent max-[820px]:p-7">
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#a8a29e]">
              Permission request
            </p>
            <h2 className="mb-2 mt-2 text-2xl font-bold">
              {requestingAppName}
            </h2>
            {unverifiedDynamicClient ? (
              <p className="m-0 text-xs font-bold text-amber-200">
                Unverified client name
              </p>
            ) : null}
            <p className="font-noto-serif mb-0 mt-3 text-[13px] leading-5 text-[#d6d3d1]">
              This will allow the application to continue with the access below.
            </p>

            {target ? (
              <div className="mt-5 rounded border border-white/10 bg-white/[0.03] px-3.5 py-3">
                <strong className="block text-[13px] leading-[1.35] text-[#f5f5f4]">
                  {target.environment} {target.product}
                </strong>
                <p className="font-noto-serif mb-0 mt-1 break-all text-xs leading-[1.55] text-[#d6d3d1]">
                  {target.resource}
                </p>
              </div>
            ) : null}

            <div className="mt-6 grid max-h-[264px] gap-3 overflow-y-auto pr-1">
              {scopes.length > 0 ? (
                scopes.map((scope) => (
                  <div
                    key={scope.key}
                    className="rounded border border-white/10 bg-white/[0.03] px-3.5 py-3"
                  >
                    <strong className="block text-[13px] leading-[1.35] text-[#f5f5f4]">
                      {scope.label}
                    </strong>
                    <p className="font-noto-serif mb-0 mt-1 text-xs leading-[1.55] text-[#d6d3d1]">
                      {scope.description}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded border border-white/10 bg-white/[0.03] px-3.5 py-3">
                  <strong className="block text-[13px] leading-[1.35] text-[#f5f5f4]">
                    Basic authorization
                  </strong>
                  <p className="font-noto-serif mb-0 mt-1 text-xs leading-[1.55] text-[#d6d3d1]">
                    Continue the sign-in request for this application.
                  </p>
                </div>
              )}
            </div>

            {error ? (
              <div
                role="alert"
                className="mt-[18px] border-l-[3px] border-l-[#ef3340] bg-[rgba(239,51,64,0.1)] px-3.5 py-3"
              >
                <strong className="block text-[13px] leading-[1.35] text-red-200">
                  Authorization did not complete.
                </strong>
                <p className="font-noto-serif mb-0 mt-1 text-xs leading-[1.55] text-[#d6d3d1]">
                  {error}
                </p>
              </div>
            ) : null}

            <button
              className="relative mt-5 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2.5 rounded border-0 bg-[#ef3340] font-bold text-white transition-[background-color,box-shadow] duration-150 hover:bg-[#d91f2b] hover:shadow-[0_10px_26px_rgba(239,51,64,0.22)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(239,51,64,0.24)] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isBusy}
              onClick={() => void submitConsent(true)}
              type="button"
            >
              <span className="min-w-0">Authorize application</span>
              {isSubmitting === "accept" ? <BusySpinner /> : null}
            </button>

            <button
              className="mt-3 flex h-[42px] w-full cursor-pointer items-center justify-center rounded border border-white/10 bg-transparent px-4 font-bold text-[#f5f5f4] transition-[background-color,border-color,box-shadow] duration-150 hover:border-white/25 hover:bg-white/[0.04] focus-visible:border-[#ef3340] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(239,51,64,0.18)] disabled:cursor-not-allowed disabled:border-white/5 disabled:text-[#78716c] disabled:opacity-70"
              disabled={isBusy}
              onClick={() => void submitConsent(false)}
              type="button"
            >
              Deny access
              {isSubmitting === "deny" ? <BusySpinner /> : null}
            </button>
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

function BusySpinner() {
  return (
    <span
      aria-hidden="true"
      className="absolute right-4 size-4 animate-spin rounded-full border-2 border-white/35 border-t-white"
    />
  )
}

async function resolveRedirectUrl(res: Response) {
  const contentType = res.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const body = await res.text()
    if (body.trim()) {
      try {
        const data = JSON.parse(body) as { url?: string; redirect?: boolean }
        if (data.url) return data.url
      } catch {
        return undefined
      }
    }
  }

  return res.redirected && res.url ? res.url : undefined
}
