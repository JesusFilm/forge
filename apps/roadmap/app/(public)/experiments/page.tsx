import type { Metadata } from "next"
import { getOwnerProfile } from "@/lib/features"
import { EXPERIMENTS } from "@/lib/experiments"
import { ExpoPreviewPanel } from "@/components/ExpoPreviewPanel"

export const metadata: Metadata = {
  title: "Experiments | JFP DS AI Roadmap",
}

export default function ExperimentsPage() {
  return (
    <div className="mx-auto max-w-4xl pb-20">
      {/* Hero */}
      <section className="space-y-4 pb-12 pt-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">
          Live Demos
        </p>
        <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          Experiments
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-stone-400">
          Active projects demonstrating what we&apos;re building. Each explores
          a different way to use technology for ministry, from hand-crafted
          experiences to AI-generated content to mobile delivery.
        </p>
      </section>

      {/* Project Cards */}
      <div className="space-y-5">
        {EXPERIMENTS.map((experiment) => (
          <article
            key={experiment.title}
            className={`group relative rounded-xl border border-[var(--color-border)] border-l-2 ${experiment.accentBorder} bg-[var(--color-card)] p-6 transition-[border-color,box-shadow] duration-300 hover:border-stone-500/60 hover:shadow-[0_0_30px_rgba(255,255,255,0.03)] sm:p-8`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${experiment.accentBg} text-xs font-bold ${experiment.accent}`}
              >
                {experiment.number}
              </span>
              <h2 className="text-xl font-bold tracking-tight">
                {experiment.title}
              </h2>
            </div>

            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-stone-400">
              {experiment.description}
            </p>

            {/* Team + CTA row */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {experiment.team.map((key) => {
                    const profile = getOwnerProfile(key)
                    return profile?.avatar ? (
                      <img
                        key={key}
                        src={`${profile.avatar}&s=80`}
                        alt={key}
                        title={key.charAt(0).toUpperCase() + key.slice(1)}
                        className="h-8 w-8 rounded-full border-2 border-[var(--color-card)] bg-stone-800"
                      />
                    ) : (
                      <span
                        key={key}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--color-card)] bg-stone-800 text-xs font-medium uppercase text-stone-400"
                      >
                        {key[0]}
                      </span>
                    )
                  })}
                </div>
                <span className="text-xs text-stone-500">
                  {experiment.team
                    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
                    .join(", ")}
                </span>
              </div>

              {experiment.preview ? (
                <ExpoPreviewPanel
                  projectId={experiment.preview.expoProjectId}
                  channel={experiment.preview.channel}
                  buttonClass={experiment.buttonClass}
                />
              ) : experiment.comingSoon ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-5 py-2.5 text-sm font-medium text-stone-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500/60" />
                  Coming Soon
                </span>
              ) : (
                <div className="flex flex-col items-center gap-1.5">
                  <div className="flex gap-3">
                    {experiment.links.map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-lg ${experiment.buttonClass} px-6 py-3 text-sm font-semibold text-white transition-colors duration-200`}
                      >
                        {link.label}
                        <span aria-hidden="true">&#8599;</span>
                      </a>
                    ))}
                  </div>
                  {experiment.loginRequired && (
                    <span className="text-xs text-stone-500">
                      Login required
                    </span>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
