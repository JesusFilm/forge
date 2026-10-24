"use client"

import Image from "next/image"
import { useEffect, useRef, useState, type ComponentType } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { hasWatchGrowReturnIntent } from "@/lib/watch-grow-return-intent"
import { WATCH_GROW_COURSE } from "@/lib/watch-grow-content"
import { useWatchModalActivity } from "./WatchModalActivityProvider"
import { WatchGrowPlans } from "./WatchGrowPlans"
import { WatchGrowPrayer } from "./WatchGrowPrayer"
import type { WatchGrowCourseProps } from "./WatchGrowCourse"

export type WatchGrowProps = {
  /** Structured progress and deferred story integrations belong to U10. */
  courseProps?: WatchGrowCourseProps
}

/** Mount only on the selected Grow intent. Curriculum starts loading at course open. */
export function WatchGrow({ courseProps }: WatchGrowProps) {
  // A hosted sign-in that started from a lesson returns here with its lesson
  // and card in the address; re-open the course so the visitor lands back in
  // it. Grow mounts only on the client after the Grow intent.
  const [open, setOpen] = useState(
    () => typeof window !== "undefined" && hasWatchGrowReturnIntent(),
  )
  const [Course, setCourse] =
    useState<ComponentType<WatchGrowCourseProps> | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [imageFailed, setImageFailed] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  // Layout-phase activity registration runs before the passive lazy import.
  // The shared lifecycle alone owns player pause/resume and delayed release.
  useWatchModalActivity(open)
  useEffect(() => {
    if (!open || Course) return
    let cancelled = false
    setFailed(false)
    void import("./WatchGrowProgressCourse").then(
      (module) => {
        if (!cancelled) setCourse(() => module.WatchGrowProgressCourse)
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, Course, attempt])

  return (
    <div
      data-testid="watch-grow"
      className="w-full min-w-0 text-white"
      lang="en"
      dir="ltr"
    >
      <h2 className="text-3xl font-semibold tracking-tight">Grow in faith</h2>
      <Dialog open={open} onOpenChange={setOpen}>
        <section className="mt-5 overflow-hidden rounded-2xl border border-white/15 bg-white/5">
          <div className="grid min-w-0 sm:grid-cols-2">
            <div className="relative min-h-48 bg-stone-800">
              {!imageFailed ? (
                <Image
                  src={WATCH_GROW_COURSE.image}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 560px, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <p className="flex h-full min-h-48 items-center justify-center p-6 text-2xl font-semibold">
                  Nine stories. One next step.
                </p>
              )}
            </div>
            <div className="min-w-0 p-5 sm:p-7">
              <h3 className="text-2xl font-semibold">
                {WATCH_GROW_COURSE.title}
              </h3>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-white/75">
                {WATCH_GROW_COURSE.summary}
              </p>
              <DialogTrigger
                render={
                  <button
                    ref={trigger}
                    type="button"
                    className="mt-5 min-h-11 cursor-pointer rounded-full bg-white px-5 py-3 text-sm font-semibold text-stone-950 hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                  />
                }
              >
                Open the nine lessons
              </DialogTrigger>
              <a
                href={WATCH_GROW_COURSE.materials}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex min-h-11 items-center text-sm text-white/75 underline underline-offset-4"
              >
                Course source and materials
              </a>
            </div>
          </div>
        </section>
        <DialogContent
          finalFocus={trigger}
          viewportClassName="fixed inset-0 z-[80] flex overflow-x-hidden overflow-y-auto p-3 sm:p-6"
          overlayClassName="z-[80] bg-black/70 motion-reduce:animate-none"
          className="m-auto w-full min-w-0 max-w-3xl shrink-0 bg-[#efece4] p-5 text-stone-950 motion-reduce:animate-none sm:max-w-3xl sm:p-8"
          lang="en"
          dir="ltr"
        >
          <DialogTitle className="pr-8 text-2xl font-semibold">
            Beginning With Jesus
          </DialogTitle>
          <DialogDescription className="text-stone-600">
            Watch, reflect and put your faith into practice. All nine lessons
            are available without an account.
          </DialogDescription>
          {open ? (
            Course ? (
              <Course {...courseProps} />
            ) : failed ? (
              <div role="alert">
                <p>
                  The course could not load. You can retry or read the source
                  materials.
                </p>
                <button
                  type="button"
                  onClick={() => setAttempt((value) => value + 1)}
                  className="mt-3 min-h-11 cursor-pointer rounded-full border border-stone-400 px-5 font-semibold"
                >
                  Try again
                </button>
                <a
                  href={WATCH_GROW_COURSE.materials}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-4 inline-flex min-h-11 items-center underline"
                >
                  Source materials
                </a>
              </div>
            ) : (
              <p role="status">Loading the nine lessons…</p>
            )
          ) : null}
        </DialogContent>
      </Dialog>
      <WatchGrowPlans />
      <WatchGrowPrayer />
    </div>
  )
}
