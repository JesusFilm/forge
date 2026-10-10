import type { Metadata } from "next"
import Link from "next/link"
import { getOwnerProfile } from "@/lib/features"
import { EXPERIMENTS } from "@/lib/experiments"

export const metadata: Metadata = {
  title: "About | JFP DS AI Roadmap",
}

const TEAM = [
  { name: "Tataihono", key: "tataihono", role: "Architect" },
  { name: "Vlad", key: "vlad", role: "Product Owner & Manager Builder" },
  { name: "Ekkasit", key: "ekkasit", role: "AI Experience Generation" },
  { name: "Nisal", key: "nisal", role: "Backend" },
  { name: "Urim", key: "urim", role: "Frontend (Web & Mobile)" },
  { name: "Josh", key: "josh", role: "Roadmap Operations & PM" },
]

const QUARTERS = [
  {
    label: "Sept \u2013 Nov 2025",
    title: "Foundation",
    current: false,
  },
  {
    label: "Dec 2025 \u2013 Feb 2026",
    title: "Infrastructure & Data",
    current: false,
  },
  {
    label: "March \u2013 May 2026",
    title: "Search, Topics, Audio",
    current: true,
  },
  {
    label: "June \u2013 Aug 2026",
    title: "Personalization, Publishing, Video AI",
    current: false,
  },
]

const PRINCIPLES = [
  {
    title: "Theological fidelity",
    description:
      "AI assists, humans verify. No speculative doctrine. Every generated piece of content is grounded in trusted Scripture and reviewed before publication.",
  },
  {
    title: "Human oversight",
    description:
      "Generated content starts as drafts, published only after human review. The AI proposes; the ministry team decides.",
  },
  {
    title: "Safe experimentation",
    description:
      "Practical outcomes over full automation. We ship incremental value, measure impact, and iterate with care.",
  },
  {
    title: "Ministry first",
    description:
      "Technology serves the mission, not the other way around. Every capability we build is measured by lives reached, not models deployed.",
  },
]

export default function AboutPage() {
  return (
    <div className="space-y-20 pb-20">
      {/* Hero */}
      <section className="space-y-6 pt-8 text-center">
        <img
          src="/jesusfilm-sign.svg"
          alt="Jesus Film Project"
          className="mx-auto h-10"
        />
        <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          Reaching every person,
          <br />
          in every language,
          <br />
          through the power of AI
        </h1>
        <p className="mx-auto max-w-2xl text-lg leading-relaxed text-stone-400">
          Build trusted, scalable AI capabilities that help people discover
          gospel content, engage meaningfully with Scripture, and take faithful
          next steps, while maintaining strong theological and ministry
          guardrails.
        </p>
      </section>

      {/* Vision */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">The Opportunity</h2>
        <p className="max-w-3xl text-base leading-relaxed text-stone-300">
          Billions of people across hundreds of languages are searching for
          hope, meaning, and truth. The Jesus Film Project has decades of gospel
          media (films, short videos, Scripture resources) but connecting the
          right content to the right person at the right moment remains an
          enormous challenge. AI changes the equation. Not by replacing human
          ministry, but by making it possible to structure, discover, and
          deliver content at a scale that was previously impossible. This is a
          ministry opportunity rooted in hope, not hype. Technology serves the
          mission.
        </p>
      </section>

      {/* Focus Areas */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold">Three Focus Areas</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          <FocusCard
            number="01"
            title="Content Discovery & Recommendation"
            description="Structure and tag media so people and AI systems can discover related content. Semantic search, embeddings, and intelligent recommendations that surface the right video, the right Scripture, at the right moment."
            accent="border-purple-500/40"
          />
          <FocusCard
            number="02"
            title="Topic Pages & Guided Journeys"
            description="Use clustered content and AI assistance to generate clear, public-facing topic pages. Tens of thousands of pages, each a doorway to the gospel, organized by theme, question, and life situation."
            accent="border-blue-500/40"
          />
          <FocusCard
            number="03"
            title="AI-Assisted Media Creation"
            description="Reduce the cost and effort of creating media through AI-assisted subtitles, audio, and video. Break language barriers at scale, reaching communities that have waited too long to hear the gospel in their own tongue."
            accent="border-amber-500/40"
          />
        </div>
      </section>

      {/* Timeline */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold">Year 1 Timeline</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          {QUARTERS.map((q) => (
            <div
              key={q.label}
              className={`rounded-lg border p-4 ${
                q.current
                  ? "border-blue-500/60 bg-blue-500/5"
                  : "border-[var(--color-border)] bg-[var(--color-card)]"
              }`}
            >
              <div
                className={`text-xs font-medium uppercase tracking-wider ${
                  q.current ? "text-blue-400" : "text-stone-500"
                }`}
              >
                {q.label}
              </div>
              <div className="mt-2 text-sm font-semibold">{q.title}</div>
              {q.current && (
                <div className="mt-2 inline-block rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-400">
                  Current
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Team */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold">The Team</h2>
        <div className="grid gap-6 sm:grid-cols-3 lg:grid-cols-6">
          {TEAM.map((member) => {
            const profile = getOwnerProfile(member.key)
            return (
              <div key={member.key} className="text-center">
                {profile?.avatar ? (
                  <img
                    src={`${profile.avatar}&s=96`}
                    alt={member.name}
                    className="mx-auto h-16 w-16 rounded-full bg-stone-800"
                  />
                ) : (
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-stone-800 text-xl font-bold text-stone-500">
                    {member.name[0]}
                  </div>
                )}
                <div className="mt-3 text-sm font-semibold capitalize">
                  {member.name}
                </div>
                <div className="mt-0.5 text-xs text-stone-500">
                  {member.role}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Principles */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold">Our Guardrails</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <div
              key={p.title}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-5"
            >
              <h3 className="text-sm font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">
                {p.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Experiments */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold">Live Experiments</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {EXPERIMENTS.map((exp) => (
            <div
              key={exp.number}
              className={`rounded-lg border border-[var(--color-border)] border-l-2 ${exp.accentBorder} bg-[var(--color-card)] p-5`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold ${exp.accentBg} ${exp.accent}`}
                >
                  {exp.number}
                </span>
                <h3 className="text-sm font-semibold">{exp.title}</h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">
                {exp.description}
              </p>
              <div className="mt-3">
                {exp.comingSoon ? (
                  <span className="text-xs text-stone-500">Coming soon</span>
                ) : exp.links[0] ? (
                  <a
                    href={exp.links[0].href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs font-medium ${exp.accent} hover:underline`}
                  >
                    {exp.links[0].label} &#8599;
                    {exp.loginRequired && (
                      <span className="ml-1 text-stone-500">
                        (login required)
                      </span>
                    )}
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="text-center">
        <Link
          href="/roadmap"
          className="inline-flex items-center gap-2 rounded-lg bg-[#EF3340] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#d92d39]"
        >
          Explore the Roadmap &rarr;
        </Link>
      </section>
    </div>
  )
}

function FocusCard({
  number,
  title,
  description,
  accent,
}: {
  number: string
  title: string
  description: string
  accent: string
}) {
  return (
    <div
      className={`rounded-lg border-l-2 ${accent} border border-[var(--color-border)] bg-[var(--color-card)] p-5`}
    >
      <div className="text-xs font-bold text-stone-600">{number}</div>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-stone-400">
        {description}
      </p>
    </div>
  )
}
