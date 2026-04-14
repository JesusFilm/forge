import type { LucideIcon } from "lucide-react"
import { PremiumStubPage } from "@/components/admin-ui"
import type { AdminMessages } from "@/i18n/messages"

type StubPageKey =
  | "workflows"
  | "embeddings"
  | "search"
  | "users"
  | "settings"
  | "languages"
  | "media"

export function AdminStubPage({
  common,
  page,
  icon,
}: {
  common: AdminMessages["common"]
  page: AdminMessages["pages"][StubPageKey]
  icon: LucideIcon
}) {
  return (
    <PremiumStubPage
      eyebrow={page.eyebrow}
      title={page.title}
      description={page.description}
      stubLabel={common.premiumStubLabel}
      operatorTitle={common.operatorNotes}
      operatorMeta={common.fieldGuide}
      insightTitle={page.insightTitle}
      insightMeta={page.insightMeta}
      cards={page.cards}
      queueTitle={page.queueTitle}
      queueMeta={page.queueMeta}
      queue={page.queue.map((item) => ({
        title: item.title,
        meta: item.meta,
        detail: item.detail,
        status: { label: item.statusLabel, tone: item.statusTone },
      }))}
      notes={page.notes}
      chips={page.chips}
      insights={page.insights.map((item) => ({
        label: item.label,
        value: item.value,
        detail: item.detail,
        icon,
      }))}
    />
  )
}
