"use client"

// The Share film kit: a recipient-audio link, an invitation, conversation
// prompts, a few gathering suggestions and the real guides, plus a clean print
// view. Loaded only when the visitor asks for it (see WatchShareIdeas).
//
// Layout note: URLs use `break-all`, never `truncate` — `white-space: nowrap`
// would stretch the grid track past a phone viewport.

import { Copy, Printer, Share2, X } from "lucide-react"
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"

import { env } from "@/env"
import {
  WATCH_SHARE_KIT_SOURCES,
  buildShareKitInvitation,
  buildShareKitLink,
  resolveShareKitLanguages,
  resolveShareKitPrompts,
  resolveShareKitSources,
  type WatchShareFilm,
  type WatchShareKitPrompts,
  type WatchShareKitSource,
} from "@/lib/watch-share-kit"
import { WATCH_SECTION_EYEBROW_CLASS } from "./watch-section-styles"

export type WatchShareKitProps = {
  film: WatchShareFilm
  onClose: () => void
  /** Ask the host to (re)load the film's audio language inventory. */
  onRequestLanguageOptions?: () => void
}

type Status =
  | { kind: "idle" }
  | { kind: "copied"; what: "Link" | "Invitation" }
  | { kind: "failed" }

const MANUAL_COPY_MESSAGE =
  "We couldn’t copy automatically. The text is selected, so copy it manually."

/** Original gathering suggestions; the full guide is linked beside them. */
const GATHERING_STEPS = [
  "Invite a few people and say what you will watch and how long it runs.",
  "Watch together, then pause before anyone speaks.",
  "Ask one open question from the prompts and listen.",
  "Let anyone pass, and finish when you said you would.",
] as const

const PRINT_STYLE = `
  [data-watch-share-kit-print-root] { display: none }
  @media print {
    body > *:not([data-watch-share-kit-print-root]) { display: none !important }
    [data-watch-share-kit-print-root] { display: block; color: #000; background: #fff }
  }
`

const BUTTON_CLASS =
  "inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 px-4 py-2.5 text-xs font-bold tracking-wider text-white uppercase transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
const FIELD_CLASS =
  "w-full min-w-0 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base text-white focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${children} (opens in a new tab)`}
      className="font-semibold text-white underline underline-offset-4 hover:text-white/80"
    >
      {children}
    </a>
  )
}

function promptSourceNote(source: WatchShareKitPrompts["source"]) {
  return source === "authored"
    ? "From the study questions for this film."
    : "Suggested by Watch. These are general conversation starters, not a study guide for this film."
}

export function WatchShareKit({
  film,
  onClose,
  onRequestLanguageOptions,
}: WatchShareKitProps) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const invitationRef = useRef<HTMLTextAreaElement>(null)
  const [recipientSlug, setRecipientSlug] = useState(film.languageSlug)
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [canNativeShare] = useState(
    () =>
      typeof navigator !== "undefined" && typeof navigator.share === "function",
  )

  const languages = useMemo(
    () =>
      resolveShareKitLanguages({
        current: { slug: film.languageSlug, name: film.languageName },
        variants: film.languageVariants,
      }),
    [film.languageSlug, film.languageName, film.languageVariants],
  )
  const recipient =
    languages.find((language) => language.slug === recipientSlug) ??
    languages[0]
  const prompts = useMemo(
    () => resolveShareKitPrompts(film.studyQuestions),
    [film.studyQuestions],
  )
  const sources = useMemo(
    () => resolveShareKitSources(WATCH_SHARE_KIT_SOURCES),
    [],
  )
  const languageStatus = film.languageOptionsStatus ?? "ready"
  const senderLanguage =
    languages.find((language) => language.slug === film.languageSlug)?.name ??
    film.languageSlug

  // Move focus into the kit once, as it opens.
  useEffect(() => headingRef.current?.focus(), [])

  const link = recipient
    ? buildShareKitLink({
        origin: env.NEXT_PUBLIC_CANONICAL_ORIGIN,
        videoSlug: film.slug,
        languageSlug: recipient.slug,
      })
    : null
  if (!recipient || !link) return null
  const invitation = buildShareKitInvitation({
    title: film.title,
    url: link,
    runtimeMinutes: film.runtimeMinutes,
    languageName: recipient.name,
  })

  function refuse(
    field: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  ) {
    field.current?.select()
    setStatus({ kind: "failed" })
  }

  async function copy(
    text: string,
    what: "Link" | "Invitation",
    field: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  ) {
    try {
      await navigator.clipboard.writeText(text)
      setStatus({ kind: "copied", what })
    } catch {
      refuse(field)
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: film.title, text: invitation, url: link! })
    } catch (error) {
      // Dismissing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return
      refuse(linkRef)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") onClose()
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="watch-share-kit"
      onKeyDown={onKeyDown}
      className="mt-8 grid w-full min-w-0 gap-8 rounded-2xl border border-white/15 bg-white/[0.04] p-5 text-white sm:p-7"
    >
      <header className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={WATCH_SECTION_EYEBROW_CLASS}>Film kit</p>
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="mt-2 text-2xl leading-tight font-semibold text-balance outline-none sm:text-3xl"
          >
            {film.title}
          </h3>
        </div>
        <button
          type="button"
          data-testid="watch-share-kit-close"
          onClick={onClose}
          aria-label="Close film kit"
          className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border border-white/20 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      <div className="grid min-w-0 gap-3">
        <label
          htmlFor={`${headingId}-language`}
          className="text-sm font-semibold"
        >
          Their audio language
        </label>
        <select
          id={`${headingId}-language`}
          data-testid="watch-share-kit-language"
          value={recipient.slug}
          onChange={(event) => {
            setRecipientSlug(event.target.value)
            setStatus({ kind: "idle" })
          }}
          className={FIELD_CLASS}
        >
          {languages.map((language) => (
            <option key={language.slug} value={language.slug}>
              {language.nativeName
                ? `${language.name} (${language.nativeName})`
                : language.name}
            </option>
          ))}
        </select>
        <p className="text-sm text-white/65">
          This changes the audio of the link only. Your page stays in{" "}
          {senderLanguage}.
        </p>
        {languageStatus === "error" ? (
          <p className="flex flex-wrap items-center gap-3 text-sm text-amber-300">
            Other audio languages couldn’t be loaded.
            <button
              type="button"
              data-testid="watch-share-kit-language-retry"
              onClick={onRequestLanguageOptions}
              className={BUTTON_CLASS}
            >
              Try again
            </button>
          </p>
        ) : languageStatus === "ready" ? (
          languages.length < 2 ? (
            <p className="text-sm text-white/65">
              No other audio languages are listed for this film yet.
            </p>
          ) : null
        ) : (
          <p className="text-sm text-white/65">
            Checking which audio languages this film has…
          </p>
        )}
      </div>

      <div className="grid min-w-0 gap-3">
        <label htmlFor={`${headingId}-link`} className="text-sm font-semibold">
          Link
        </label>
        <input
          id={`${headingId}-link`}
          ref={linkRef}
          data-testid="watch-share-kit-link"
          type="text"
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          className={FIELD_CLASS}
        />
        <label
          htmlFor={`${headingId}-invitation`}
          className="mt-2 text-sm font-semibold"
        >
          Invitation
        </label>
        <textarea
          id={`${headingId}-invitation`}
          ref={invitationRef}
          data-testid="watch-share-kit-invitation"
          lang="en"
          readOnly
          rows={4}
          value={invitation}
          onFocus={(event) => event.currentTarget.select()}
          className={FIELD_CLASS}
        />
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            data-testid="watch-share-kit-copy-link"
            onClick={() => void copy(link, "Link", linkRef)}
            className={BUTTON_CLASS}
          >
            <Copy aria-hidden className="size-4" />
            Copy link
          </button>
          <button
            type="button"
            data-testid="watch-share-kit-copy-invitation"
            onClick={() => void copy(invitation, "Invitation", invitationRef)}
            className={BUTTON_CLASS}
          >
            <Copy aria-hidden className="size-4" />
            Copy invitation
          </button>
          {canNativeShare ? (
            <button
              type="button"
              data-testid="watch-share-kit-native-share"
              onClick={() => void nativeShare()}
              className={BUTTON_CLASS}
            >
              <Share2 aria-hidden className="size-4" />
              Share…
            </button>
          ) : null}
          <button
            type="button"
            data-testid="watch-share-kit-print"
            onClick={() => window.print()}
            className={BUTTON_CLASS}
          >
            <Printer aria-hidden className="size-4" />
            Print or save as PDF
          </button>
        </div>
        <p
          role="status"
          aria-live="polite"
          data-testid="watch-share-kit-status"
          className="min-h-5 text-sm text-white/80"
        >
          {status.kind === "copied"
            ? `${status.what} copied.`
            : status.kind === "failed"
              ? MANUAL_COPY_MESSAGE
              : ""}
        </p>
      </div>

      <div data-testid="watch-share-kit-prompts" className="grid min-w-0 gap-3">
        <h4 className="text-lg font-semibold">Conversation prompts</h4>
        <p className="text-sm text-white/65">
          {promptSourceNote(prompts.source)}
        </p>
        <ul
          lang={prompts.source === "editorial" ? "en" : ""}
          dir={prompts.source === "editorial" ? "ltr" : "auto"}
          className="grid list-disc gap-2 pl-5 text-[15px] leading-snug text-white/85"
        >
          {prompts.prompts.map((prompt) => (
            <li key={prompt}>{prompt}</li>
          ))}
        </ul>
      </div>

      <div className="grid min-w-0 gap-3">
        <h4 className="text-lg font-semibold">Hosting a small gathering</h4>
        <p className="text-sm text-white/65">
          Our own suggestions. The full guide is listed below.
        </p>
        <ol className="grid list-decimal gap-2 pl-5 text-[15px] leading-snug text-white/85">
          {GATHERING_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      <div data-testid="watch-share-kit-sources" className="grid min-w-0 gap-4">
        <h4 className="text-lg font-semibold">
          Guides from Jesus Film Project
        </h4>
        <ul className="grid gap-4">
          {sources.map((source) => (
            <li key={source.id} className="grid min-w-0 gap-1">
              <p className="font-semibold">{source.title}</p>
              <p className="text-sm text-white/65">
                {source.publisher} · {source.language} · checked{" "}
                {source.verifiedOn}
              </p>
              <p className="text-[15px] leading-snug text-white/80">
                {source.summary}
              </p>
              <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <ExternalLink href={source.pageHref}>
                  Read the guide
                </ExternalLink>
                {source.pdfHref ? (
                  <ExternalLink href={source.pdfHref}>
                    Download the PDF
                  </ExternalLink>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {createPortal(
        <div data-watch-share-kit-print-root="">
          <style>{PRINT_STYLE}</style>
          <ShareKitPrintDocument
            film={film}
            audio={recipient.name}
            link={link}
            invitation={invitation}
            prompts={prompts}
            sources={sources}
          />
        </div>,
        document.body,
      )}
    </section>
  )
}

/** The printed kit: content only, nothing interactive and nothing private. */
function ShareKitPrintDocument({
  film,
  audio,
  link,
  invitation,
  prompts,
  sources,
}: {
  film: WatchShareFilm
  audio: string
  link: string
  invitation: string
  prompts: WatchShareKitPrompts
  sources: readonly WatchShareKitSource[]
}) {
  return (
    <article
      data-testid="watch-share-kit-print-document"
      lang="en"
      dir="ltr"
      className="mx-auto max-w-2xl p-8 text-base leading-relaxed"
    >
      <h1 lang="" dir="auto" className="text-3xl font-semibold">
        {film.title}
      </h1>
      <p>Film kit from Jesus Film Project · Audio language: {audio}</p>
      <h2 className="mt-6 text-xl font-semibold">Link</h2>
      <p className="break-all">{link}</p>
      <h2 className="mt-6 text-xl font-semibold">Invitation</h2>
      <p className="break-words">{invitation}</p>
      <h2 className="mt-6 text-xl font-semibold">Conversation prompts</h2>
      <p>{promptSourceNote(prompts.source)}</p>
      <ul
        lang={prompts.source === "editorial" ? "en" : ""}
        dir={prompts.source === "editorial" ? "ltr" : "auto"}
        className="list-disc pl-6"
      >
        {prompts.prompts.map((prompt) => (
          <li key={prompt}>{prompt}</li>
        ))}
      </ul>
      <h2 className="mt-6 text-xl font-semibold">Hosting a small gathering</h2>
      <ol className="list-decimal pl-6">
        {GATHERING_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <h2 className="mt-6 text-xl font-semibold">Sources</h2>
      <ul className="grid gap-3">
        {sources.map((source) => (
          <li key={source.id}>
            <p className="font-semibold">{source.title}</p>
            <p>
              {source.publisher} · {source.language} · checked{" "}
              {source.verifiedOn}
            </p>
            <p className="break-all">{source.pageHref}</p>
            {source.pdfHref ? (
              <p className="break-all">{source.pdfHref}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </article>
  )
}
