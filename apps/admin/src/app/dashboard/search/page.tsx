import { Search } from "lucide-react"
import {
  DashboardPageHeader,
  DataTable,
  InsightGrid,
  OperatorRail,
  PageSection,
} from "@/components/admin-ui"
import { requireSession } from "@/auth/session"
import { getAdminMessages } from "@/i18n/server"
import { runSemanticSearch } from "@/app/dashboard/ops-data"

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function SearchPage({
  searchParams,
}: SearchPageProps = {}) {
  const messages = await getAdminMessages()
  const page = messages.pages.search
  const principal = await requireSession()
  const params = (await searchParams) ?? {}
  const data = await runSemanticSearch({
    queryText: firstParam(params.q),
    locale: firstParam(params.locale),
    user: principal,
  })

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
      />

      <div className="grid gap-4 md:grid-cols-3">
        {data.metrics.map((card) => (
          <div key={card.label} className="app-card flex flex-col gap-2 p-4">
            <span className="label-text">{card.label}</span>
            <span className="font-mono text-xl font-medium">{card.value}</span>
            <span className="font-mono text-[10px] uppercase text-[var(--color-text-muted)]">
              {card.footer}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="flex flex-col gap-6">
          <PageSection
            title="Query Console"
            meta="TEXT_TO_VECTOR / PGVECTOR / HYDRATION"
          >
            <form
              method="get"
              className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_120px_auto]"
            >
              <input
                type="text"
                name="q"
                defaultValue={data.queryText}
                placeholder="forgiveness and restoration"
                className="h-10 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none"
              />
              <input
                type="text"
                name="locale"
                defaultValue={data.locale}
                placeholder="en"
                className="h-10 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 font-mono text-[12px] text-[var(--color-text-primary)] outline-none"
              />
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-[var(--color-brand)] px-4 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)]"
              >
                <Search className="h-4 w-4" strokeWidth={1.5} />
                Search
              </button>
            </form>
            <div className="px-4 pb-4 text-[12px] text-[var(--color-text-secondary)]">
              {data.unavailableReason
                ? data.unavailableReason
                : "Search text is embedded server-side and resolved against experience locale vectors."}
            </div>
          </PageSection>

          <PageSection title="Resolved Results" meta="TOP_MATCHES">
            <DataTable
              columns={["Experience", "Status", "Updated"]}
              rows={
                data.results.length > 0
                  ? data.results.map((row) => [
                      <div key={`${row.id}-title`}>
                        <div className="text-[13px] font-medium">
                          {row.title}
                        </div>
                        <div className="mono-meta text-[var(--color-text-muted)]">
                          {row.locale} / {row.slug} / owner {row.owner}
                        </div>
                      </div>,
                      <span
                        key={`${row.id}-status`}
                        className="status-pill border-[var(--color-success-border)] text-[var(--color-success)]"
                      >
                        {row.status}
                      </span>,
                      <span
                        key={`${row.id}-updated`}
                        className="mono-meta text-[var(--color-text-muted)]"
                      >
                        {row.updated}
                      </span>,
                    ])
                  : [
                      [
                        <div key="empty-title">
                          <div className="text-[13px] font-medium">
                            {data.queryText
                              ? "No matching rows"
                              : "No query submitted"}
                          </div>
                          <div className="mono-meta text-[var(--color-text-muted)]">
                            {data.queryText
                              ? "The semantic search pipeline returned zero hydrated rows for this input."
                              : "Run a search query to inspect retrieval behavior."}
                          </div>
                        </div>,
                        <span
                          key="empty-status"
                          className="status-pill border-white/15 text-[var(--color-text-muted)]"
                        >
                          Idle
                        </span>,
                        <span
                          key="empty-updated"
                          className="mono-meta text-[var(--color-text-muted)]"
                        >
                          --
                        </span>,
                      ],
                    ]
              }
            />
          </PageSection>

          <PageSection title="Search Signals" meta="RETRIEVAL_CONFIDENCE">
            <div className="p-4">
              <InsightGrid
                items={data.insights.map((item) => ({
                  ...item,
                  icon: Search,
                }))}
              />
            </div>
          </PageSection>
        </div>

        <OperatorRail
          title={messages.common.operatorNotes}
          meta={messages.common.fieldGuide}
          notes="This route now performs an actual text-to-vector lookup when an embedding provider is configured, making it usable as a semantic search diagnostics surface in v1."
          chips={[
            { label: "Locale", value: data.locale.toUpperCase() },
            {
              label: "Provider",
              value: data.unavailableReason ? "BLOCKED" : "READY",
            },
            { label: "Surface", value: "SEARCH_DIAGNOSTICS" },
          ]}
        />
      </div>
    </div>
  )
}
