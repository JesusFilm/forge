export type ExperimentLink = { label: string; href: string }

export type Experiment = {
  number: string
  title: string
  description: string
  team: string[]
  links: ExperimentLink[]
  comingSoon?: boolean
  loginRequired?: boolean
  accent: string
  accentBg: string
  accentBorder: string
  buttonClass: string
}

export const EXPERIMENTS: Experiment[] = [
  {
    number: "01",
    title: "Easter Experience",
    description:
      "The first demonstration of a manually curated viewing experience. Our editorial team crafted a themed page in the CMS, and it flows directly to a polished front-end page, showing what's possible when people and technology work together to present the gospel.",
    team: ["urim", "nisal", "tataihono"],
    links: [
      {
        label: "View Demo",
        href: "https://watch.jesusfilm.org/watch/easter",
      },
    ],
    accent: "text-emerald-400",
    accentBg: "bg-emerald-500/10",
    accentBorder: "border-l-emerald-500",
    buttonClass: "bg-emerald-600 hover:bg-emerald-500",
  },
  {
    number: "02",
    title: "AI-Generated Christmas Experience",
    description:
      "A complete experience page created entirely by AI. It drew from content across the internet, the Bible, and our video library to assemble a themed Christmas experience automatically, demonstrating how AI can scale content creation for ministry.",
    team: ["ekkasit"],
    links: [
      {
        label: "View Demo",
        href: "https://watch.jesusfilm.org/watch/christmas",
      },
    ],
    accent: "text-violet-400",
    accentBg: "bg-violet-500/10",
    accentBorder: "border-l-violet-500",
    buttonClass: "bg-violet-600 hover:bg-violet-500",
  },
  {
    number: "03",
    title: "Mobile App",
    description:
      "A native mobile app built on top of the experience platform, bringing curated and AI-generated content directly to phones. Currently in preview as we prepare for wider release.",
    team: ["urim"],
    links: [],
    comingSoon: true,
    accent: "text-amber-400",
    accentBg: "bg-amber-500/10",
    accentBorder: "border-l-amber-500",
    buttonClass: "bg-amber-600 hover:bg-amber-500",
  },
  {
    number: "04",
    title: "Media Library Enrichment",
    description:
      "Where our video library comes to life. AI-powered data enrichment dramatically increases coverage of subtitles, metadata, and in the future, audio, across thousands of videos and hundreds of languages.",
    team: ["vlad", "nisal", "tataihono"],
    links: [{ label: "Visit Site", href: "https://manager.jesusfilm.org" }],
    loginRequired: true,
    accent: "text-blue-400",
    accentBg: "bg-blue-500/10",
    accentBorder: "border-l-blue-500",
    buttonClass: "bg-blue-600 hover:bg-blue-500",
  },
  {
    number: "05",
    title: "Content Management System",
    description:
      "The headless CMS that powers everything. Content types, media assets, and structured data are authored here and delivered via API to the web, mobile, and experience pages.",
    team: ["vlad", "nisal", "tataihono"],
    links: [{ label: "Visit Site", href: "https://cms.jesusfilm.org" }],
    loginRequired: true,
    accent: "text-cyan-400",
    accentBg: "bg-cyan-500/10",
    accentBorder: "border-l-cyan-500",
    buttonClass: "bg-cyan-600 hover:bg-cyan-500",
  },
]
