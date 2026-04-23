import {
  BookOpen,
  CalendarDays,
  Church,
  Cross,
  Film,
  Flame,
  Heart,
  HelpCircle,
  Info,
  type LucideIcon,
  MapPin,
  MessageCircle,
  Play,
  Sparkles,
  Star,
  Sun,
  Users,
} from "lucide-react"

import type { InfoBlocksSection } from "@forge/experience-templates"

const ICON_MAP: Record<string, LucideIcon> = {
  book: BookOpen,
  bookopen: BookOpen,
  calendar: CalendarDays,
  calendardays: CalendarDays,
  church: Church,
  cross: Cross,
  film: Film,
  flame: Flame,
  heart: Heart,
  help: HelpCircle,
  helpcircle: HelpCircle,
  info: Info,
  location: MapPin,
  mappin: MapPin,
  message: MessageCircle,
  messagecircle: MessageCircle,
  play: Play,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  users: Users,
}

function resolveIcon(name?: string): LucideIcon {
  if (!name) return Info
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[-_\s]/g, "")
  return ICON_MAP[key] ?? Info
}

type InfoBlocksPreviewProps = {
  section: InfoBlocksSection
}

export function InfoBlocksPreview({ section }: InfoBlocksPreviewProps) {
  const blocks = (section.blocks ?? []).filter(
    (b): b is NonNullable<typeof b> => b != null,
  )

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {section.intro ? (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">
            {section.intro}
          </p>
        ) : null}
        {section.heading ? (
          <h3 className="text-base font-bold text-neutral-900">
            {section.heading}
          </h3>
        ) : null}
        {section.description ? (
          <p className="text-sm text-neutral-700">{section.description}</p>
        ) : null}
      </div>
      {blocks.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {blocks.map((block, i) => {
            const Icon = resolveIcon(block.icon)
            return (
              <article
                key={i}
                className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
              >
                <Icon className="h-5 w-5 text-blue-600" aria-hidden />
                {block.title ? (
                  <h4 className="text-sm font-semibold text-neutral-900">
                    {block.title}
                  </h4>
                ) : null}
                {block.description ? (
                  <p className="text-xs leading-relaxed text-neutral-600">
                    {block.description}
                  </p>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
