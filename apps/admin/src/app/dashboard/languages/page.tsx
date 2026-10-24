import { getAdminMessages } from "@/i18n/server"
import { loadLanguagesData } from "@/app/dashboard/ops-data"
import { LanguageDiagnostics } from "@/app/dashboard/languages/language-diagnostics"

function headerDescription(template: string, total: number) {
  const [before, after] = template.split("{total}")
  if (after === undefined) {
    return template
  }

  return (
    <>
      {before}
      <strong className="font-semibold text-[var(--color-text-primary)]">
        {total.toLocaleString("en")}
      </strong>
      {after}
    </>
  )
}

export default async function LanguagesPage() {
  const messages = await getAdminMessages()
  const page = messages.pages.languages
  const data = await loadLanguagesData()

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="min-w-0">
        <div className="label-text mb-1">{page.eyebrow}</div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">
          {page.title}
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
          {headerDescription(page.description, data.diagnosticRows.length)}
        </p>
      </header>

      <LanguageDiagnostics
        rows={data.diagnosticRows}
        diagnostics={data.diagnostics}
        metrics={data.metrics}
      />
    </div>
  )
}
