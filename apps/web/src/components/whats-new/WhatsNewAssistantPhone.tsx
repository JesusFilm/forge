import { Fragment, type CSSProperties } from "react"
import Image from "next/image"

import { WHATS_NEW_ASSISTANTS } from "@/components/whats-new/whats-new-content"

/**
 * Phone showing the real ChatGPT exchange this section is about.
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
 * The whole exchange as a sequence, in the phone's own pinned window.
 *
 * Every value is a range on the `--watch-chat` view timeline that the pin
 * stage names — NOT a duration. The reader controls the clock: scrolling
 * back runs it backwards, and stopping stops it. That is the whole reason
 * this is scroll-driven rather than an autoplaying animation, which would
 * be finished before most readers reached it and unrepeatable after.
 *
 * The units are `svh`, NOT percentages, and that is load-bearing. A
 * percentage is a fraction of the timeline's whole contain phase, so it
 * stretches with the subject: once the phone started sticking for the
 * length of the entire argument, percentage ranges spread the typing over
 * thousands of pixels and the exchange became imperceptible. Lengths pin
 * the sequence to a fixed scroll distance — it plays out over roughly one
 * screen of scrolling near the start of the pin, then the finished
 * exchange rests beside the rest of the section.
 *
 * So these are offsets INTO the contain phase, which begins where the
 * phone begins sticking. Keep the last one comfortably under the shortest
 * contain phase the layout can produce, or the tail of the exchange
 * silently never plays.
 *
 * The order is the order a person actually does it: an empty composer,
 * then typing, then send, then the wait, then the answer arriving in
 * pieces. The gaps between steps are deliberate — they are the beats where
 * nothing moves, which is what makes the next thing register.
 */
export const CHAT_STEPS = {
  /** Home screen, holding until the tap opens the app. */
  home: "contain 0svh contain 22svh",
  /** The pointer crossing the screen towards the icon. */
  pointer: "contain 3svh contain 15svh",
  /** The tap itself: the ring contracts and the icon presses in. */
  tap: "contain 15svh contain 20svh",
  /** The app taking over the screen. */
  app: "contain 16svh contain 24svh",
  /** Placeholder dips out as typing starts, and returns after send. */
  placeholder: "contain 24svh contain 70svh",
  /** One per line of `phone.typedLines`, in order. */
  typedLines: [
    "contain 27svh contain 34svh",
    "contain 34svh contain 41svh",
    "contain 41svh contain 48svh",
    "contain 48svh contain 55svh",
  ],
  /** Caret lands at the end of the last line and blinks until send. */
  caret: "contain 54svh contain 62svh",
  /** Send button wakes up while there is text, then settles back. */
  send: "contain 28svh contain 66svh",
  /** The typed text leaves the composer as the bubble takes it. */
  clear: "contain 62svh contain 66svh",
  /** Question, as a sent bubble. */
  ask: "contain 62svh contain 69svh",
  /** The wait. Opens, holds, and collapses as the answer starts. */
  think: "contain 70svh contain 79svh",
  /** Answer streaming in, then its sources, then the rest. */
  answer: ["contain 78svh contain 90svh", "contain 96svh contain 104svh"],
  sources: "contain 91svh contain 96svh",
  citation: "contain 103svh contain 112svh",
} as const

/**
 * Where the sequence ends, in `svh`. The pin stage has to be tall enough
 * that its contain phase covers this — contain is `stage height minus
 * viewport height`, so the stage needs this PLUS a screen. A stage that is
 * too short simply truncates the tail, silently, and the further down the
 * sequence a step is the more likely it never plays at all. Guarded by a
 * test that reads the stage's own `min-h` and compares.
 */
export const CHAT_SEQUENCE_END_SVH = 112

/**
 * The home screen's app grid. Only one tile is a real icon; the rest are
 * anonymous glass. Position matters: ChatGPT sits in the second slot of the
 * top row, near where a pointer entering from the lower left arrives, so
 * the tap reads as deliberate rather than as a jump across the screen.
 */
const HOME_TILES = [
  "slot-1",
  "chatgpt",
  "slot-3",
  "slot-4",
  "slot-5",
  "slot-6",
  "slot-7",
  "slot-8",
] as const

export function WhatsNewAssistantPhone() {
  const { phone } = WHATS_NEW_ASSISTANTS

  return (
    <figure
      data-testid="whats-new-assistant-phone"
      className="flex w-fit flex-col items-center gap-4"
    >
      <div
        data-testid="whats-new-phone-device"
        role="img"
        aria-label={phone.alt}
        /* 9:19.5 is the iPhone display ratio (iPhone 12 through 17,
           2532x1170 and every size since). Sizing by HEIGHT with `w-auto`
           is what keeps that ratio honest: give it a width instead and a
           `max-h` cap would flatten the phone into a tile on short
           viewports, which is the shape this replaced. */
        className="watch-chat-device relative aspect-[9/19.5] h-[min(72svh,40rem)] w-auto rounded-[2.25rem] border border-white/15 bg-white/10 p-2.5 shadow-[0_2rem_5rem_-1rem_rgba(0,0,0,0.9)]"
      >
        {/* Screen. White, because the references are light mode — which is
            also what makes it read as a phone against this black page
            rather than dissolving into it. Inner radius is the outer one
            less the bezel so the curves stay concentric. */}
        <div className="relative flex h-full flex-col overflow-hidden rounded-[1.65rem] bg-white">
          {/* The app, expanding OVER the home screen when the icon is
              tapped — which is the direction iOS moves, and the only
              layering that works here. The other way round (home on top,
              fading away to reveal the app) means both are translucent at
              once mid-transition, and a dark wallpaper over a white app
              washes the whole screen out to flat grey.

              Hence `z-10` and its own `bg-white`: an absolutely positioned
              sibling paints above a static one whatever the source order,
              and a layer with no background of its own cannot cover the
              one underneath however opaque it gets. */}
          <div
            data-testid="whats-new-phone-app"
            className="watch-chat-app watch-scroll-chat-app relative z-10 flex h-full flex-col bg-white"
            style={{ "--step-range": CHAT_STEPS.app } as CSSProperties}
          >
            {/* Camera pill standing in for the status bar. No clock or
              battery: invented set dressing on a real transcript invites
              the reader to doubt the parts that are true. */}
            <div className="flex justify-center pt-3 pb-1">
              <span
                aria-hidden
                className="h-1.5 w-16 rounded-full bg-black/10"
              />
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
                {/* The real mark, not a redrawn one — the ChatGPT desktop
                  app's own icon, lifted from its install on this machine
                  (`/usr/lib/chatgpt/resources/icon-chatgpt.png`, trimmed to
                  its squircle and resized). It replaced a hand-simplified
                  knot path that was legible but wrong in the details.

                  The icon's near-white squircle disappears against the
                  app's own white chrome at this size, which is exactly what
                  the real header looks like. */}
                <Image
                  src="/watch/images/whats-new/chatgpt-app-icon.png"
                  alt=""
                  aria-hidden
                  width={64}
                  height={64}
                  className="size-[1.15rem]"
                />
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

            {/* Viewport for the conversation, with the message column
              translating inside it as the reader scrolls past the pinned
              phone: the question, then the answer, then our cited film.

              Takes whatever height the chrome above and below leaves, so
              the device can hold the iPhone ratio at any size. The reel's
              travel is its own height less one screenful, and it reads
              that screenful off this box via `100cqh` (hence
              `watch-chat-viewport`, which makes it a size container) —
              previously a hard-coded rem duplicated in globals.css, where
              the two could drift with nothing to catch it. */}
            <div
              data-testid="whats-new-phone-viewport"
              className="watch-chat-viewport relative min-h-0 flex-1 overflow-hidden"
            >
              <div className="watch-chat-reel flex flex-col px-3.5 pb-4">
                {phone.messages.map((message, index) => {
                  const fromPerson = message.from === "person"
                  /* Spacing lives INSIDE the clipped child, never as a gap on
                   the reel: a gap is drawn for a step that has not opened
                   yet, so the conversation would sit in a ladder of blank
                   rows waiting for content. */
                  const step = fromPerson
                    ? CHAT_STEPS.ask
                    : CHAT_STEPS.answer[index - 1]

                  return (
                    <Fragment key={index}>
                      <div
                        className={`watch-chat-step watch-scroll-chat-step ${fromPerson ? "" : "watch-scroll-chat-say"}`}
                        style={
                          {
                            "--step-range": step,
                            "--step-gap": "0.875rem",
                          } as CSSProperties
                        }
                      >
                        <div
                          data-testid="whats-new-phone-message"
                          data-from={message.from}
                          className={`watch-chat-step-inner ${fromPerson ? "pl-6 text-right" : ""}`}
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
                              className="watch-chat-step watch-scroll-chat-step mt-2.5 block"
                              style={
                                {
                                  "--step-range": CHAT_STEPS.citation,
                                } as CSSProperties
                              }
                            >
                              <span
                                data-testid="whats-new-phone-citation"
                                className="watch-chat-step-inner block overflow-hidden rounded-xl border border-black/10 bg-white text-left"
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
                            </span>
                          ) : null}

                          {"sources" in message && message.sources ? (
                            // The references surface citations as a labelled block
                            // under the answer, not only as inline chips.
                            <span
                              className="watch-chat-step watch-scroll-chat-step mt-3 block text-left"
                              style={
                                {
                                  "--step-range": CHAT_STEPS.sources,
                                } as CSSProperties
                              }
                            >
                              <span className="watch-chat-step-inner block">
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
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* The wait, which is part of the workflow: a question
                        goes off somewhere and takes a moment to come back.
                        Skipping it would make the answer look instant, and
                        the whole point of the section is that a person is
                        sitting through this exchange.

                        Three dots, NOT a reproduction — unlike the rest of
                        this chrome, no reference screenshot was measured
                        for the streaming state, so this is a generic
                        waiting indicator rather than a claim about what
                        ChatGPT shows. It opens, holds, and collapses again
                        as the answer starts. */}
                      {fromPerson ? (
                        <div
                          data-testid="whats-new-phone-thinking"
                          className="watch-chat-think watch-scroll-chat-think"
                          style={
                            {
                              "--step-range": CHAT_STEPS.think,
                              "--step-gap": "0.875rem",
                            } as CSSProperties
                          }
                        >
                          <div className="watch-chat-step-inner">
                            <span
                              aria-hidden
                              className="inline-flex items-center gap-1"
                            >
                              {[0, 1, 2].map((dot) => (
                                <span
                                  key={dot}
                                  className="watch-chat-dot size-1.5 rounded-full bg-[#111111]"
                                  style={
                                    {
                                      "--dot-index": String(dot),
                                    } as CSSProperties
                                  }
                                />
                              ))}
                            </span>
                          </div>
                        </div>
                      ) : null}
                    </Fragment>
                  )
                })}
              </div>
            </div>

            {/* Composer. A `div`, not an `input` — nothing here is operable,
              and a real field would take focus and invite typing. The
              typing is drawn, for the same reason: a real field would need
              client JS to animate, and this whole device ships without
              any.

              `items-end`, not `items-center`: the pill grows downward as
              lines are typed, and the + and the send button stay level
              with the last line the way they do in the app. */}
            <div className="px-3.5 pt-1 pb-4">
              {/* A rounded RECT, not a stadium: `rounded-full` on a box that
                grows to four lines bows its sides out into an oval. At one
                line this radius still reads as a pill, which is what the
                references show. */}
              <div className="flex items-end gap-2 rounded-[1.15rem] border border-black/12 bg-[#fdfdfd] px-3.5 py-2.5">
                <span
                  aria-hidden
                  className="text-[0.9rem] leading-[1.4rem] text-[#111111]"
                >
                  +
                </span>

                <span className="watch-chat-slot min-w-0 flex-1">
                  {/* Placeholder and typed text share the same slot: the
                    placeholder is what the field says when empty, so it
                    dips out as the first line lands and returns once the
                    question has been sent. */}
                  <span
                    data-testid="whats-new-phone-placeholder"
                    className="watch-scroll-chat-placeholder block text-[0.75rem] leading-[1.4rem] text-[#8f8f8f]"
                    style={
                      {
                        "--step-range": CHAT_STEPS.placeholder,
                      } as CSSProperties
                    }
                  >
                    {phone.composer}
                  </span>

                  <span
                    data-testid="whats-new-phone-typed"
                    aria-hidden
                    className="watch-chat-typed watch-scroll-chat-typed"
                    style={
                      {
                        "--step-range": CHAT_STEPS.clear,
                        "--typed-lines": String(phone.typedLines.length),
                      } as CSSProperties
                    }
                  >
                    {phone.typedLines.map((line, index) => {
                      const last = index === phone.typedLines.length - 1

                      return (
                        <span
                          key={line}
                          data-testid="whats-new-phone-typed-line"
                          className="watch-chat-typed-line watch-scroll-chat-typed-line block leading-[1.4rem] text-[#111111]"
                          style={
                            {
                              "--step-range": CHAT_STEPS.typedLines[index],
                            } as CSSProperties
                          }
                        >
                          {line}
                          {/* Caret rides INSIDE the clipped line, after the
                            text, so the reveal uncovers it exactly as that
                            line finishes — a cursor arriving where the
                            typing stopped. Only the last line keeps one;
                            on the others it would sit under the line being
                            typed next. Reveal and blink are two elements
                            because they both drive opacity, and one
                            `animation` list would let the filling reveal
                            override the blink outright. */}
                          {last ? (
                            <span
                              className="watch-scroll-chat-caret ml-px inline-block align-[-0.15em]"
                              style={
                                {
                                  "--step-range": CHAT_STEPS.caret,
                                } as CSSProperties
                              }
                            >
                              <span className="watch-chat-caret block h-[0.95rem] w-px bg-[#111111]" />
                            </span>
                          ) : null}
                        </span>
                      )
                    })}
                  </span>
                </span>

                {/* Send control. Muted while the field is empty, awake while
                  there is something to send — the app's own tell that a
                  message is ready, and the only cue that the send is what
                  moves the text into the thread. */}
                <span
                  aria-hidden
                  data-testid="whats-new-phone-send"
                  className="watch-scroll-chat-send size-5 shrink-0 rounded-full bg-[#111111]"
                  style={{ "--step-range": CHAT_STEPS.send } as CSSProperties}
                />
              </div>
            </div>
          </div>

          {/* Home screen. Sits ON TOP of the app and gets out of the way
              when the icon is tapped, which is the only reason the app
              appears to open rather than simply being there.

              It rests HIDDEN, unlike the app: a reader with no scroll
              animation, or reduced motion, should get the finished
              exchange — the point the section is making — not a home
              screen that will never be tapped.

              No clock, battery or carrier: the same rule the app chrome
              follows. Invented set dressing on a real transcript invites
              the reader to doubt the parts that are true. */}
          <div
            data-testid="whats-new-phone-home"
            aria-hidden
            className="watch-chat-home watch-scroll-chat-home absolute inset-0 flex flex-col justify-between bg-[linear-gradient(160deg,#2b3450_0%,#151a2c_46%,#0b0e18_100%)] px-[7%] pt-[9%] pb-[6%]"
            style={{ "--step-range": CHAT_STEPS.home } as CSSProperties}
          >
            <div className="grid grid-cols-4 gap-x-[6%] gap-y-[5%]">
              {HOME_TILES.map((tile) =>
                tile === "chatgpt" ? (
                  <div key="chatgpt" className="relative">
                    {/* The one real icon on the screen, and the target of
                        the tap. The mark is the SAME drawing the app's own
                        nav bar uses — one reproduction, two sizes, so the
                        icon and the app it opens cannot disagree. */}
                    {/* A square box holding the icon and the pointer as
                        siblings. Both geometries depend on it: a circle
                        sized in percent is only round inside a square box,
                        and the pointer only lands dead centre if its box is
                        the ICON's rather than the cell's — the cell
                        includes the label below, which pulled the landing
                        point 8px low. */}
                    <div className="relative aspect-square">
                      <div
                        data-testid="whats-new-phone-app-icon"
                        /* No `bg-white` and no glyph inside: the real icon
                           carries its own squircle, so the tile is just the
                           box that clips and shadows it. */
                        className="watch-chat-icon watch-scroll-chat-icon absolute inset-0 overflow-hidden rounded-[22%] shadow-[0_0.35rem_0.9rem_rgba(0,0,0,0.45)]"
                        style={
                          { "--step-range": CHAT_STEPS.tap } as CSSProperties
                        }
                      >
                        <Image
                          src="/watch/images/whats-new/chatgpt-app-icon.png"
                          alt=""
                          aria-hidden
                          width={256}
                          height={256}
                          className="size-full object-cover"
                        />
                      </div>
                      {/* The pointer, INSIDE the icon it is aiming for. Its
                        travel is a translate away from centre, so it lands
                        dead on the icon at every device size — a pointer
                        positioned against the screen instead would drift
                        off target as the phone scales. */}
                      <span
                        data-testid="whats-new-phone-pointer"
                        className="watch-chat-pointer watch-scroll-chat-pointer pointer-events-none absolute inset-0 grid place-items-center"
                        style={
                          {
                            "--step-range": CHAT_STEPS.pointer,
                          } as CSSProperties
                        }
                      >
                        <span
                          className="watch-chat-tap watch-scroll-chat-tap block size-[62%] rounded-full border border-white/70 bg-white/35 shadow-[0_0_0.6rem_rgba(255,255,255,0.45)]"
                          style={
                            { "--step-range": CHAT_STEPS.tap } as CSSProperties
                          }
                        />
                      </span>
                    </div>

                    <p className="watch-chat-app-label mt-[14%] truncate text-center leading-tight text-white/85">
                      {phone.appLabel}
                    </p>
                  </div>
                ) : (
                  // Anonymous tiles. Real other-app icons would be brands
                  // this page has no business showing, and named invented
                  // ones read as fake; muted glass says "a home screen"
                  // without claiming anything.
                  <div
                    key={tile}
                    className="aspect-square rounded-[22%] border border-white/10 bg-white/10"
                  />
                ),
              )}
            </div>

            <div className="grid grid-cols-4 gap-x-[6%] rounded-[12%] border border-white/10 bg-white/10 p-[3%]">
              {[0, 1, 2, 3].map((slot) => (
                <div
                  key={slot}
                  className="aspect-square rounded-[22%] bg-white/15"
                />
              ))}
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
