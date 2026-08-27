import type { CSSProperties } from "react"
import Image from "next/image"

import { WHATS_NEW_ASSISTANTS } from "@/components/whats-new/whats-new-content"

/**
 * Phone showing the real ChatGPT exchange the three reason cards beside it
 * are describing.
 *
 * Drawn in CSS rather than shipped as a screenshot: a capture would be
 * unreadable at this width, would need re-taking every time ChatGPT
 * restyles, and would cost an image request on a page that is otherwise
 * text. The trade is that the chrome is a reproduction, so its details are
 * MEASURED, not remembered — every value below was sampled off reference
 * screenshots of the iOS app (1170x2532, 3x, so ÷3 for points) on
 * 2026-08-26:
 *
 *   surface            #ffffff  — LIGHT mode, not dark
 *   assistant text     #111111, flush left at 17pt, no bubble
 *   user message       WHITE on a BLACK bubble, right-aligned,
 *                      257pt of 390pt wide, radius ~24pt
 *   composer pill      #fdfdfd, 34pt inset each side, 40pt tall
 *   composer label     "Ask ChatGPT" — not "Ask anything"
 *
 * The counter-intuitive one is the user's turn: a BLACK bubble with
 * white text, sitting in an otherwise light interface. It took three
 * attempts — dark mode with a grey bubble, then light mode with no bubble
 * at all — before measuring the region directly (84.7% black, 11.9% white,
 * and OCR of it inverted returns the question) settled it. Re-measure from
 * a fresh screenshot before changing it back; every version produced from
 * memory of "what ChatGPT looks like" has been wrong.
 *
 * Contrast inside the screen is ChatGPT's, not ours, and some of it is
 * below the WCAG text floor. That is deliberate: this is a reproduction of a picture of
 * an interface, it carries `role="img"` with an alt that states the whole
 * exchange, and a real screenshot — which is exactly what it stands in for
 * — would have the identical values with no way to edit them. Raising the
 * greys would make it stop looking like the thing it is quoting. The
 * figcaption below is different: that is our own page content, so it meets
 * the floor on its own terms.
 *
 * The transcript is REAL but ABRIDGED, and it wears ChatGPT's name and
 * chrome — so the caption underneath says both, and links to the original.
 * That pairing is the point: unlabelled, this is an advert; labelled and
 * linked, it is evidence for the claim the section is making. See the
 * editing rules on `WHATS_NEW_ASSISTANTS.phone`.
 */
/**
 * Height of the conversation viewport. Load-bearing: the reel's travel is
 * expressed as `-100% + var(--chat-viewport)`, so this value and that
 * keyframe are one calculation split across two files.
 */
const CHAT_VIEWPORT = "19rem"

export function WhatsNewAssistantPhone() {
  const { phone } = WHATS_NEW_ASSISTANTS

  return (
    <figure
      data-testid="whats-new-assistant-phone"
      className="flex flex-col items-center gap-4"
    >
      <div
        data-testid="whats-new-phone-device"
        role="img"
        aria-label={phone.alt}
        className="relative w-full max-w-[19rem] rounded-[2.25rem] border border-white/15 bg-white/10 p-2.5 shadow-[0_2rem_5rem_-1rem_rgba(0,0,0,0.9)]"
      >
        {/* Screen. White, because the references are light mode — which is
            also what makes it read as a phone against this black page
            rather than dissolving into it. Inner radius is the outer one
            less the bezel so the curves stay concentric. */}
        <div className="relative overflow-hidden rounded-[1.65rem] bg-white">
          {/* Camera pill standing in for the status bar. No clock or
              battery: invented set dressing on a real transcript invites
              the reader to doubt the parts that are true. */}
          <div className="flex justify-center pt-3 pb-1">
            <span aria-hidden className="h-1.5 w-16 rounded-full bg-black/10" />
          </div>

          {/* Nav bar. ICON-ONLY — OCR of the reference finds no text here
              at all, which is what corrected an invented "ChatGPT ⌄"
              wordmark. Sidebar toggle left, the knot mark right of centre,
              a second control at the far right.

              Alpha goes on `opacity`, never a fractional `text-*`: that
              composites every stroke crossing twice and the seams show.
              Page-wide rule with its own test. */}
          <div className="flex items-center px-4 pt-1.5 pb-3">
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="size-4 text-[#111111] opacity-70"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>

            <span className="ml-auto flex items-center gap-4">
              {/* OpenAI knot mark, simplified to a single stroked path at
                  this size — the full six-lobe outline turns to mud below
                  about 24px. */}
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="size-[1.15rem] text-[#111111]"
                fill="currentColor"
              >
                <path d="M12 2.6a4 4 0 0 1 3.6 2.2 4 4 0 0 1 3.7 5.9 4 4 0 0 1-1.3 5.9 4 4 0 0 1-4.4 4.3A4 4 0 0 1 12 21.4a4 4 0 0 1-3.6-2.2 4 4 0 0 1-3.7-5.9 4 4 0 0 1 1.3-5.9A4 4 0 0 1 10.4 3 4 4 0 0 1 12 2.6Zm0 3.1L8.3 7.9v4.5l3.7 2.2 3.7-2.2V7.9L12 5.7Z" />
              </svg>
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="size-4 text-[#111111] opacity-70"
                fill="currentColor"
              >
                <circle cx="5" cy="12" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="19" cy="12" r="1.7" />
              </svg>
            </span>
          </div>

          {/* Fixed-height viewport for the conversation, with the message
              column translating inside it as the reader scrolls the three
              cards beside the phone: the question, then the answer, then
              our cited film, each arriving with the card that describes it.

              The height must be FIXED for the reel arithmetic in
              `watch-chat-reel` to close — it travels
              `-100% + var(--chat-viewport)`, its own height less one
              screenful. Change one and change the other. */}
          <div
            data-testid="whats-new-phone-viewport"
            style={{ "--chat-viewport": CHAT_VIEWPORT } as CSSProperties}
            className="relative h-[var(--chat-viewport)] overflow-hidden"
          >
            <div className="watch-chat-reel flex flex-col gap-3.5 px-3.5 pb-4">
              {phone.messages.map((message, index) => {
                const fromPerson = message.from === "person"

                return (
                  <div
                    key={index}
                    data-testid="whats-new-phone-message"
                    data-from={message.from}
                    className={fromPerson ? "pl-6 text-right" : ""}
                  >
                    {/* The user's turn is a BLACK bubble with white text —
                      measured off the reference, where that region is
                      84.7% pure black and 11.9% white, and OCR of it
                      inverted returns the question. Two earlier drafts got
                      this wrong in opposite directions (a grey bubble,
                      then muted grey text with no bubble at all). It is
                      the loudest element on the screen; the answer beside
                      it is unstyled text. That contrast IS the interface.

                      Geometry, at 390pt screen width: bubble 257pt wide
                      (66%), right margin 16pt against the answer's 17pt
                      left margin, corner radius ~24pt, and the same type
                      size in both turns. */}
                    <p
                      className={
                        fromPerson
                          ? "inline-block max-w-[82%] rounded-[1.35rem] bg-black px-3.5 py-2.5 text-left text-[0.8125rem] leading-[1.4rem] text-white"
                          : "text-[0.8125rem] leading-[1.4rem] text-[#111111]"
                      }
                    >
                      {message.text}
                    </p>

                    {"citation" in message && message.citation ? (
                      // The whole point of the illustration: our catalogue
                      // named, linked, and handed over inside someone else's
                      // answer.
                      //
                      // A LARGE card with a thumbnail, not a one-line link
                      // row — in the references this is the single biggest
                      // element on screen (about 270x163pt of a 390pt-wide
                      // display), and rendering it as a text row was the main
                      // thing that stopped the reproduction reading as the
                      // real interface.
                      //
                      // The thumbnail is a drawn placeholder, never a
                      // photograph: pairing a real film's title with a
                      // stand-in still would misrepresent what the card
                      // actually previews, and it would cost an image
                      // request this component otherwise avoids.
                      <span
                        data-testid="whats-new-phone-citation"
                        className="mt-2.5 block overflow-hidden rounded-xl border border-black/10 bg-white text-left"
                      >
                        <span className="relative block aspect-[64/30] bg-black">
                          {/* The real production still for the film the
                            answer names, straight off our own delivery
                            CDN. `alt=""` because the whole device is one
                            `role="img"` whose label already describes this
                            card — a second description reads out twice. */}
                          <Image
                            src={message.citation.thumbnail.src}
                            alt={message.citation.thumbnail.alt}
                            width={message.citation.thumbnail.width}
                            height={message.citation.thumbnail.height}
                            sizes="288px"
                            className="size-full object-cover"
                          />
                          <span
                            aria-hidden
                            className="absolute inset-0 grid place-items-center"
                          >
                            <span className="grid size-9 place-items-center rounded-full bg-white/90 shadow-[0_0.25rem_1rem_rgba(0,0,0,0.45)]">
                              <svg
                                viewBox="0 0 24 24"
                                className="ml-0.5 size-3.5 text-[#111111]"
                                fill="currentColor"
                              >
                                <path d="M8 5.5v13l11-6.5z" />
                              </svg>
                            </span>
                          </span>
                        </span>
                        <span className="flex items-center gap-2.5 px-3 py-2.5">
                          <span
                            aria-hidden
                            className="grid size-6 shrink-0 place-items-center rounded-full bg-[#ef3340] text-[0.5rem] font-bold text-white"
                          >
                            JF
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[0.75rem] leading-4 font-medium text-[#111111]">
                              {message.citation.title}
                            </span>
                            <span className="block truncate text-[0.6875rem] text-[#8f8f8f]">
                              {message.citation.source}
                            </span>
                          </span>
                        </span>
                      </span>
                    ) : null}

                    {"sources" in message && message.sources ? (
                      // The references surface citations as a labelled block
                      // under the answer, not only as inline chips.
                      <span className="mt-3 block text-left">
                        <span className="block text-[0.6875rem] font-semibold text-[#111111]">
                          {phone.sourcesLabel}
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {message.sources.map((source) => (
                            <span
                              key={source}
                              data-testid="whats-new-phone-source-chip"
                              className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-[#f7f7f7] px-2 py-0.5 text-[0.625rem] text-[#5d5d5d]"
                            >
                              <span
                                aria-hidden
                                className="size-1.5 rounded-full bg-[#ef3340]"
                              />
                              {source}
                            </span>
                          ))}
                        </span>
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Composer. A `div`, not an `input` — nothing here is operable,
              and a real field would take focus and invite typing. */}
          <div className="px-3.5 pt-1 pb-4">
            <div className="flex items-center gap-2 rounded-full border border-black/12 bg-[#fdfdfd] px-3.5 py-2.5">
              <span aria-hidden className="text-[0.9rem] text-[#111111]">
                +
              </span>
              <span className="flex-1 text-[0.75rem] text-[#8f8f8f]">
                {phone.composer}
              </span>
              <span
                aria-hidden
                className="size-5 shrink-0 rounded-full bg-[#111111]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Outside the `role="img"` above on purpose: the device is a picture,
          but this is real page content and the one thing here a reader must
          be able to read. Contrast measured against the section backdrop in
          Chromium at 1440px, 2026-08-26 — /60 is 7.3:1, comfortably over
          the 4.5:1 floor for text this size, where the /40 it replaced was
          3.77:1 and failed. jsdom computes no colour, so no test holds it. */}
      <figcaption className="max-w-[19rem] text-center text-xs leading-6 text-white/60">
        {phone.disclaimer}{" "}
        <a
          href={phone.sourceHref}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-white/80 underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-4"
        >
          {phone.sourceLabel}
        </a>
      </figcaption>
    </figure>
  )
}
