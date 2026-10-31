"use client"

// A three-question, persona-specific "find your next step" journey. Each
// answer re-ranks the persona's next-step actions and may surface one short
// answer that fits the choice. Ends on a single recommended step with the
// reasoning spelled out. Markup, classes and animations are copied from the
// prototype (prototype-parity manifest); questions, reasons, ranking and
// actions come from the published audience configuration instead of the
// prototype's hard-coded tables. Frontend only, no persistence, no network.

import {
  ArrowLeft,
  Check,
  Clock,
  Coffee,
  Compass,
  Flame,
  Globe,
  HeartHandshake,
  Lightbulb,
  Moon,
  MonitorPlay,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react"
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import type { WatchRole } from "@/components/watch/watch-role"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import {
  rankWatchAudienceActions,
  watchAudienceReasons,
  type WatchAudienceRoleDefinition,
} from "@/lib/watch-audience-config"
import { textDirectionForLocale } from "@/lib/locale"
import { cn } from "@/lib/utils"

/* ----------------------------- content ----------------------------- */

// Renderer-owned presentation the configuration deliberately does not carry:
// one icon per answer, keyed `questionId:optionId` — exactly the prototype's
// icons for the default (prototype) ids; only an editor-authored id the
// prototype never had uses the fallback — and the prototype's short answers,
// kept only where the claim holds for what this page actually offers.

type Reveal = { key: string; title: string; body: string }

export const WATCH_JOURNEY_OPTION_ICONS: Record<
  WatchRole,
  Record<string, LucideIcon>
> = {
  explore: {
    "from:curious": Compass,
    "from:questions": Search,
    "from:hope": HeartHandshake,
    "from:skeptic": Flame,
    "how:watch": Play,
    "how:alone": Moon,
    "how:talk": Users,
    "time:short": Clock,
    "time:medium": Coffee,
    "time:long": Sun,
  },
  grow: {
    "want:rhythm": Sun,
    "want:study": Search,
    "want:share": Sparkles,
    "want:community": Users,
    "learn:watching": Play,
    "learn:reading": Lightbulb,
    "learn:discussing": Users,
    "when:today": Clock,
    "when:week": Coffee,
    "when:ongoing": Flame,
  },
  share: {
    "who:friend": HeartHandshake,
    "who:family": Users,
    "who:group": Users,
    "who:online": Globe,
    "where:curious": Compass,
    "where:skeptical": Flame,
    "where:hurting": HeartHandshake,
    "where:believer": Sparkles,
    "how:message": Sparkles,
    "how:together": Play,
    "how:post": MonitorPlay,
  },
  partner: {
    "plan:service": Sun,
    "plan:groups": Users,
    "plan:language": Globe,
    "plan:campaign": MonitorPlay,
    "size:small": Users,
    "size:mid": Users,
    "size:large": Flame,
    "offline:yes": Globe,
    "offline:no": Moon,
    "offline:unsure": Lightbulb,
  },
}

/** An authored answer the renderer has no icon for. */
const FALLBACK_OPTION_ICON: LucideIcon = Sparkles

const REVEALS: Record<WatchRole, Reveal[]> = {
  explore: [
    {
      key: "from:skeptic",
      title: "Do I need to believe anything to watch?",
      body: "No. The films tell the story as it was written down; what you make of it is yours.",
    },
    {
      key: "from:hope",
      title: "What if I come from another faith, or none?",
      body: "You are welcome here. Take it at your own pace and ask whatever you are wondering.",
    },
    {
      key: "how:watch",
      title: "How long is the full story?",
      body: "The JESUS film runs about two hours and is available in your language.",
    },
  ],
  grow: [
    {
      key: "want:share",
      title: "Will my friend need an account?",
      body: "No. The link opens straight to the film with nothing to sign up for.",
    },
  ],
  share: [
    {
      key: "who:friend",
      title: "Will they need an account?",
      body: "No. The link opens straight to the film, in the language you were watching.",
    },
    {
      key: "where:skeptical",
      title: "Which film works for a first conversation?",
      body: "Short ones. Three minutes is easy to send and easy to watch.",
    },
    {
      key: "who:online",
      title: "Can I post it on social media?",
      body: "Yes. The share link carries a proper preview; embed code is there for a page or blog.",
    },
    {
      key: "how:together",
      title: "How do we watch it together?",
      body: "Play it, then ask one of the questions to talk about. Three minutes, then talk.",
    },
  ],
  partner: [
    {
      key: "plan:language",
      title: "Which languages are available?",
      body: "Audio in the languages listed under Download, subtitles in many more.",
    },
  ],
}

/* ----------------------------- component ----------------------------- */

export type JourneyAction = {
  /** Stable configuration action id; ranking and tests key on it. */
  id: string
  Icon: LucideIcon
  title: string
  body: string
  render: (props: { className: string; children: ReactNode }) => ReactNode
}

export function WatchRoleJourney({
  definition,
  actions,
  locale = "en",
}: {
  definition: WatchAudienceRoleDefinition
  locale?: string
  /** Only the actions this page can actually serve; ranked by stable id. */
  actions: JourneyAction[]
}) {
  // The host keys this component by role and configuration, so a persona or
  // configuration change remounts it with no answers.
  const journey = definition
  const role = definition.id
  const headingId = useId()
  const [answers, setAnswers] = useState<string[]>([])
  const [dir, setDir] = useState<1 | -1>(1)
  // Keyboard continuity: after a choice the clicked control unmounts, so the
  // next question (or the result) takes focus — only after an interaction.
  const focusStep = useRef(false)
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)

  const step = answers.length
  const done = step >= journey.questions.length
  const question = done ? null : journey.questions[step]

  useEffect(() => {
    if (!focusStep.current) return
    focusStep.current = false
    ;(done ? resultHeading : stepHeading).current?.focus()
  }, [step, done])

  const tags = useMemo(
    () => answers.map((id, i) => `${journey.questions[i]?.id}:${id}`),
    [answers, journey],
  )

  // Live ranking by stable action id; equal scores keep authored order.
  const ranked = useMemo(
    () =>
      rankWatchAudienceActions(journey, answers).flatMap(
        ({ action }) => actions.find((a) => a.id === action.id) ?? [],
      ),
    [journey, answers, actions],
  )

  const reveal = useMemo(() => {
    const reveals = REVEALS[role]
    const last = tags.at(-1)
    return (
      reveals.find(
        (r) =>
          tags.includes(r.key) &&
          (r.key === last || !reveals.some((x) => x.key === last)),
      ) ?? null
    )
  }, [tags, role])

  const reason = watchAudienceReasons(journey, answers)

  const choose = (id: string) => {
    focusStep.current = true
    setDir(1)
    setAnswers((a) => [...a, id])
  }
  const back = () => {
    focusStep.current = true
    setDir(-1)
    setAnswers((a) => a.slice(0, -1))
  }
  const reset = () => {
    focusStep.current = true
    setDir(-1)
    setAnswers([])
  }

  return (
    <section
      lang={locale}
      dir={textDirectionForLocale(locale)}
      aria-labelledby={headingId}
      data-testid="watch-role-journey"
      data-role={role}
      data-step={step}
      className="text-white"
    >
      <style>{`
        @keyframes wj-in-fwd { from { opacity: 0; transform: translateX(28px) } to { opacity: 1; transform: none } }
        @keyframes wj-in-back { from { opacity: 0; transform: translateX(-28px) } to { opacity: 1; transform: none } }
        @keyframes wj-pop { 0% { transform: scale(.96); opacity: 0 } 60% { transform: scale(1.01); opacity: 1 } 100% { transform: none } }
        @keyframes wj-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        .wj-fwd { animation: wj-in-fwd .38s cubic-bezier(.2,.9,.2,1) both }
        .wj-back { animation: wj-in-back .38s cubic-bezier(.2,.9,.2,1) both }
        .wj-pop { animation: wj-pop .45s cubic-bezier(.2,.9,.2,1) both }
        .wj-rise { animation: wj-rise .4s ease-out both }
        .wj-stagger > * { animation: wj-rise .4s ease-out both }
        .wj-stagger > *:nth-child(2) { animation-delay: .05s }
        .wj-stagger > *:nth-child(3) { animation-delay: .10s }
        .wj-stagger > *:nth-child(4) { animation-delay: .15s }
        @media (prefers-reduced-motion: reduce) { .wj-fwd,.wj-back,.wj-pop,.wj-rise,.wj-stagger > * { animation: none } }
      `}</style>

      <div className="max-w-4xl">
        {/* ---------------- the conversation ---------------- */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className={WATCH_SECTION_EYEBROW_CLASS}>{journey.eyebrow}</p>
              <h2
                id={headingId}
                ref={resultHeading}
                tabIndex={-1}
                className="mt-3 text-3xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance outline-none sm:text-4xl lg:text-5xl"
              >
                {done ? journey.finish : journey.heading}
              </h2>
              {!done ? (
                <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-white/70">
                  {journey.lead}
                </p>
              ) : null}
            </div>
            <Progress total={journey.questions.length} step={step} />
          </div>

          {/* answered trail */}
          {answers.length > 0 ? (
            <ol
              lang="en"
              dir="ltr"
              className="mt-7 flex flex-wrap gap-2"
              aria-label="Your answers"
            >
              {answers.map((id, i) => {
                const q = journey.questions[i]
                const o = q.options.find((x) => x.id === id)!
                const OptionIcon =
                  WATCH_JOURNEY_OPTION_ICONS[role][`${q.id}:${o.id}`] ??
                  FALLBACK_OPTION_ICON
                return (
                  <li key={q.id} className="wj-rise">
                    <button
                      type="button"
                      onClick={() => {
                        focusStep.current = true
                        setDir(-1)
                        setAnswers((a) => a.slice(0, i))
                      }}
                      lang="en"
                      dir="ltr"
                      title="Change this answer"
                      className="group inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] py-1.5 pr-3 pl-2 text-[13px] text-white/85 transition-colors hover:border-white/40 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
                    >
                      <span className="grid size-5 place-items-center rounded-full bg-white text-stone-900">
                        <Check aria-hidden className="size-3" />
                      </span>
                      <OptionIcon aria-hidden className="size-3.5 opacity-70" />
                      <span lang={locale} dir={textDirectionForLocale(locale)}>
                        {o.label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : null}

          {/* the question, or the result */}
          <div
            key={`${role}-${step}`}
            className={cn("mt-8", dir === 1 ? "wj-fwd" : "wj-back")}
          >
            {question ? (
              <>
                <p
                  lang="en"
                  dir="ltr"
                  className="text-sm font-medium tracking-wide text-white/50 uppercase"
                >
                  Question {step + 1} of {journey.questions.length}
                </p>
                <h3
                  ref={stepHeading}
                  tabIndex={-1}
                  className="mt-2 text-2xl leading-tight font-semibold text-balance outline-none sm:text-[28px]"
                >
                  {question.prompt}
                </h3>
                <ul className="wj-stagger mt-6 grid gap-3 sm:grid-cols-2">
                  {question.options.map((o) => {
                    const OptionIcon =
                      WATCH_JOURNEY_OPTION_ICONS[role][
                        `${question.id}:${o.id}`
                      ] ?? FALLBACK_OPTION_ICON
                    return (
                      <li key={o.id}>
                        <button
                          type="button"
                          data-option-id={o.id}
                          onClick={() => choose(o.id)}
                          className="group flex w-full cursor-pointer items-center gap-4 rounded-2xl border border-white/12 bg-white/[0.06] p-4 text-start transition-[transform,background-color,border-color] duration-200 hover:-translate-y-0.5 hover:border-white hover:bg-white hover:text-stone-900 focus-visible:border-white focus-visible:bg-white focus-visible:text-stone-900 focus-visible:outline-none active:translate-y-0 md:p-5"
                        >
                          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10 transition-colors group-hover:bg-brand-red/10 group-focus-visible:bg-brand-red/10">
                            <OptionIcon
                              aria-hidden
                              className="size-5 text-white/85 transition-colors group-hover:text-brand-red group-focus-visible:text-brand-red"
                            />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[16px] leading-tight font-semibold">
                              {o.label}
                            </span>
                            {o.hint ? (
                              <span className="mt-1 block text-[13px] leading-snug text-white/60 transition-colors group-hover:text-stone-600 group-focus-visible:text-stone-600">
                                {o.hint}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {reveal ? (
                  <div
                    lang="en"
                    dir="ltr"
                    key={reveal.key}
                    className="wj-rise mt-6 flex gap-3.5 rounded-2xl border border-white/10 bg-white/[0.05] p-4 md:p-5"
                  >
                    <Lightbulb
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-red-200/80"
                    />
                    <div>
                      <p className="text-[15px] leading-snug font-semibold">
                        {reveal.title}
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-white/70">
                        {reveal.body}
                      </p>
                    </div>
                  </div>
                ) : null}
                {step > 0 ? (
                  <button
                    type="button"
                    lang="en"
                    dir="ltr"
                    onClick={back}
                    className="mt-6 inline-flex cursor-pointer items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                  >
                    <ArrowLeft aria-hidden className="size-4" /> Back
                  </button>
                ) : null}
              </>
            ) : (
              <Result ranked={ranked} reason={reason} onReset={reset} />
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function Progress({ total, step }: { total: number; step: number }) {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-[width,background-color] duration-500 ease-[cubic-bezier(.2,.9,.2,1)]",
            i < step
              ? "w-8 bg-brand-red"
              : i === step
                ? "w-8 bg-white"
                : "w-3 bg-white/25",
          )}
        />
      ))}
    </div>
  )
}

function Result({
  ranked,
  reason,
  onReset,
}: {
  /** Served actions, best first. */
  ranked: JourneyAction[]
  reason: string[]
  onReset: () => void
}) {
  const best = ranked[0]
  const others = ranked.slice(1, 3)
  return (
    <div>
      <p className="text-sm text-white/70">
        <span lang="en" dir="ltr">
          Because{" "}
        </span>
        {reason.length ? (
          joinReasons(reason)
        ) : (
          <span lang="en" dir="ltr">
            of what you told us
          </span>
        )}
        :
      </p>
      {best ? (
        <div data-testid="watch-journey-result" className="wj-pop mt-4">
          {best.render({
            className:
              "group relative flex w-full cursor-pointer items-center gap-5 overflow-hidden rounded-2xl bg-white p-6 text-start text-stone-900 shadow-[0_20px_60px_rgba(0,0,0,.45)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40 md:p-7",
            children: (
              <>
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-red/10">
                  <best.Icon aria-hidden className="size-7 text-brand-red" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    lang="en"
                    dir="ltr"
                    className="block text-[11px] font-bold tracking-[0.16em] text-brand-red uppercase"
                  >
                    Your next step
                  </span>
                  <span className="mt-1 block text-xl leading-tight font-semibold md:text-2xl">
                    {best.title}
                  </span>
                  <span className="mt-1.5 block text-[14px] leading-snug text-stone-600">
                    {best.body}
                  </span>
                </span>
                <span
                  lang="en"
                  dir="ltr"
                  className="hidden shrink-0 rounded-full bg-stone-900 px-5 py-3 text-xs font-bold tracking-wider text-white uppercase transition-colors group-hover:bg-brand-red sm:inline-flex"
                >
                  Go
                </span>
              </>
            ),
          })}
        </div>
      ) : (
        // No served action (an authored role whose every target is absent
        // here): say so instead of an empty card.
        <p lang="en" dir="ltr" className="mt-4 text-sm text-white/70">
          No next step is available on this page. You can change your answers or
          choose another audience.
        </p>
      )}
      {others.length ? (
        <>
          <p
            lang="en"
            dir="ltr"
            className="mt-6 text-[12px] font-semibold tracking-[0.14em] text-white/50 uppercase"
          >
            Also worth a look
          </p>
          <ul
            data-testid="watch-journey-alternatives"
            className="wj-stagger mt-3 grid gap-2.5 sm:grid-cols-2"
          >
            {others.map((a) => (
              <li key={a.id}>
                {a.render({
                  className:
                    "group flex w-full cursor-pointer items-start gap-3.5 rounded-xl border border-white/10 bg-white/[0.06] p-4 text-start transition-colors hover:border-white hover:bg-white hover:text-stone-900 focus-visible:border-white focus-visible:bg-white focus-visible:text-stone-900 focus-visible:outline-none",
                  children: (
                    <>
                      <a.Icon
                        aria-hidden
                        className="mt-0.5 size-5 shrink-0 text-white/75 group-hover:text-brand-red"
                      />
                      <span className="min-w-0">
                        <span className="block text-[15px] leading-tight font-semibold">
                          {a.title}
                        </span>
                        <span className="mt-1 block text-[13px] leading-snug text-white/70 group-hover:text-stone-600">
                          {a.body}
                        </span>
                      </span>
                    </>
                  ),
                })}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <button
        type="button"
        lang="en"
        dir="ltr"
        onClick={onReset}
        className="mt-7 inline-flex cursor-pointer items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
      >
        <RotateCcw aria-hidden className="size-4" /> Start over
      </button>
    </div>
  )
}

function joinReasons(parts: string[]) {
  if (parts.length === 1) return parts[0]
  return (
    <>
      {parts.slice(0, -1).join(", ")}
      <span lang="en" dir="ltr">
        {" "}
        and{" "}
      </span>
      {parts.at(-1)}
    </>
  )
}
