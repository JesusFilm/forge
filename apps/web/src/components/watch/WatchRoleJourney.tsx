"use client"

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Download,
  Globe,
  History,
  Play,
  RotateCcw,
  Send,
} from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { useEffect, useRef, useState, type ReactNode } from "react"

import {
  rankWatchAudienceActions,
  watchAudienceReasons,
  type WatchAudienceAction,
  type WatchAudienceRoleDefinition,
} from "@/lib/watch-audience-config"
import { cn } from "@/lib/utils"

export type WatchJourneyDestination =
  | { kind: "watch"; href: Route }
  | { kind: "resource"; href: string }
  | { kind: "control"; onClick: () => void }

export type WatchJourneyAction = WatchAudienceAction & {
  destination: WatchJourneyDestination
}

export type WatchRoleJourneyProps = {
  definition: WatchAudienceRoleDefinition
  /** Only actions the current surface can actually serve. */
  actions: WatchJourneyAction[]
  afterResult?: ReactNode
}

export function WatchRoleJourney({
  definition,
  actions,
  afterResult,
}: WatchRoleJourneyProps) {
  const [answers, setAnswers] = useState<string[]>([])
  const [step, setStep] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusNextStep = useRef(false)
  const question = definition.questions[step]
  const done = step === definition.questions.length
  const ranked = rankWatchAudienceActions(
    { ...definition, actions },
    answers,
  ).map(
    ({ action }) => actions.find((candidate) => candidate.id === action.id)!,
  )
  const [best, ...alternatives] = ranked
  const reasons = watchAudienceReasons(definition, answers)

  useEffect(() => {
    if (focusNextStep.current) {
      heading.current?.focus()
      focusNextStep.current = false
    }
  }, [step])

  function goTo(nextStep: number) {
    if (nextStep === step) {
      heading.current?.focus()
      return
    }
    focusNextStep.current = true
    setStep(nextStep)
  }

  return (
    <div
      data-testid="watch-role-journey"
      className="grid min-w-0 gap-7 text-white lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12"
    >
      <div>
        <p className="text-sm font-medium text-blue-300">
          {definition.eyebrow}
        </p>
        <h2 className="mt-2 text-3xl leading-tight font-semibold text-balance md:text-4xl">
          {definition.heading}
        </h2>
        <p className="mt-3 max-w-md text-base leading-relaxed text-white/70">
          {definition.lead}
        </p>
        <div aria-hidden="true" className="mt-6 flex gap-2">
          {definition.questions.map((item, index) => (
            <span
              key={item.id}
              className={cn(
                "h-1.5 w-8 rounded-full",
                index < step
                  ? "bg-blue-500"
                  : index === step
                    ? "bg-white"
                    : "bg-white/25",
              )}
            />
          ))}
        </div>
      </div>
      <div className="min-w-0">
        {question ? (
          <>
            <p className="text-sm text-white/60">
              Question {step + 1} of {definition.questions.length}
            </p>
            <h3
              ref={heading}
              tabIndex={-1}
              className="mt-2 text-2xl leading-tight font-semibold text-balance outline-none sm:text-[28px]"
            >
              {question.prompt}
            </h3>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {question.options.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    data-option-id={option.id}
                    aria-pressed={answers[step] === option.id}
                    onClick={() => {
                      setAnswers([...answers.slice(0, step), option.id])
                      goTo(step + 1)
                    }}
                    className="group flex h-full min-h-16 w-full cursor-pointer flex-col justify-center rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-left transition-colors hover:border-white hover:bg-white hover:text-stone-900 focus-visible:border-white focus-visible:bg-white focus-visible:text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 aria-pressed:border-blue-400 md:p-5"
                  >
                    <span className="text-base leading-tight font-semibold">
                      {option.label}
                    </span>
                    {option.hint ? (
                      <span className="mt-1 text-sm leading-snug text-white/60 group-hover:text-stone-600 group-focus-visible:text-stone-600">
                        {option.hint}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : done ? (
          <>
            <h3
              ref={heading}
              tabIndex={-1}
              className="text-2xl leading-tight font-semibold outline-none"
            >
              {definition.finish}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              Because {joinReasons(reasons)}:
            </p>
            {best ? (
              <div data-testid="watch-journey-result" className="mt-5">
                <ActionCard action={best} primary />
              </div>
            ) : (
              <p className="mt-5 text-white/70">
                No next step is available on this page. You can change your
                answers or choose another audience.
              </p>
            )}
            {alternatives.length ? (
              <div data-testid="watch-journey-alternatives" className="mt-6">
                <p className="text-sm font-medium text-white/60">
                  Also worth a look
                </p>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {alternatives.slice(0, 2).map((action) => (
                    <li key={action.id}>
                      <ActionCard action={action} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {afterResult}
          </>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => goTo(step - 1)}
              className={TEXT_BUTTON_CLASS}
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back
            </button>
          ) : null}
          {done ? (
            <button
              type="button"
              onClick={() => goTo(0)}
              className={TEXT_BUTTON_CLASS}
            >
              Change answers
            </button>
          ) : null}
          {answers.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setAnswers([])
                goTo(0)
              }}
              className={TEXT_BUTTON_CLASS}
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Start over
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const TEXT_BUTTON_CLASS =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-white/70 hover:text-white focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400"

function joinReasons(reasons: string[]) {
  return reasons.length > 1
    ? `${reasons.slice(0, -1).join(", ")} and ${reasons.at(-1)}`
    : reasons[0]
}

function ActionCard({
  action,
  primary = false,
}: {
  action: WatchJourneyAction
  primary?: boolean
}) {
  const Icon =
    action.target.kind === "history"
      ? History
      : action.target.kind === "languages"
        ? Globe
        : action.target.kind === "resource"
          ? BookOpen
          : action.target.kind === "current-video" &&
              action.target.target === "download"
            ? Download
            : action.target.kind === "current-video" &&
                action.target.target === "share"
              ? Send
              : Play
  const className = cn(
    "group flex h-full w-full cursor-pointer items-start gap-4 rounded-2xl p-5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400",
    primary
      ? "bg-white text-stone-900 hover:bg-blue-50 md:p-6"
      : "border border-white/15 bg-white/[0.06] text-white hover:border-white hover:bg-white hover:text-stone-900 focus-visible:bg-white focus-visible:text-stone-900",
  )
  const children: ReactNode = (
    <>
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-1 size-5 shrink-0",
          primary
            ? "text-blue-600"
            : "text-blue-300 group-hover:text-blue-600 group-focus-visible:text-blue-600",
        )}
      />
      <span className="min-w-0 flex-1">
        {primary ? (
          <span className="mb-1 block text-sm font-medium text-blue-600">
            Your next step
          </span>
        ) : null}
        <span
          className={cn(
            "block leading-tight font-semibold",
            primary ? "text-xl md:text-2xl" : "text-base",
          )}
        >
          {action.title}
        </span>
        <span
          className={cn(
            "mt-2 block text-sm leading-relaxed",
            primary
              ? "text-stone-600"
              : "text-white/70 group-hover:text-stone-600 group-focus-visible:text-stone-600",
          )}
        >
          {action.body}
        </span>
      </span>
      {primary ? (
        <ArrowRight aria-hidden="true" className="mt-1 size-5 shrink-0" />
      ) : null}
    </>
  )
  switch (action.destination.kind) {
    case "control":
      return (
        <button
          type="button"
          data-action-id={action.id}
          className={className}
          onClick={action.destination.onClick}
        >
          {children}
        </button>
      )
    case "resource":
      return (
        <a
          data-action-id={action.id}
          className={className}
          href={action.destination.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      )
    case "watch":
      return (
        <Link
          data-action-id={action.id}
          className={className}
          href={action.destination.href}
          prefetch={false}
        >
          {children}
        </Link>
      )
  }
}
