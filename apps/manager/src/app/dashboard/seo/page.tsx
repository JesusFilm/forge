import type { Metadata } from "next"
import { env } from "@/config/env"
import {
  buildSeoDemoWorkspace,
  seoWorkspaceViewSchema,
  type SeoWorkspace,
  type SeoRunPage,
} from "@/features/seo/seo-contract"
import { createSeoAdminClient } from "@/features/seo/seo-admin-client"
import { SeoWorkspace as SeoWorkspaceView } from "@/features/seo/seo-workspace"
import { SeoRunsPage } from "@/features/seo/seo-runs-page"
import { requireAuth } from "@/lib/require-auth"
import { issueSeoCsrfToken } from "@/lib/seo-csrf"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "SEO workspace — Studio",
}

function emptyWorkspace(): SeoWorkspace {
  return {
    generatedAt: new Date().toISOString(),
    proposals: [],
    experiments: [],
    lessons: [],
    ticketReconciliations: [],
  }
}

function emptyRunPage(): SeoRunPage {
  return {
    generatedAt: new Date().toISOString(),
    items: [],
    hasNextPage: false,
    nextCursor: null,
  }
}

export default async function SeoDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; cursor?: string }>
}) {
  const user = await requireAuth()
  const params = await searchParams
  const initialView = seoWorkspaceViewSchema
    .catch("overview")
    .parse(params?.view)
  const isDemo = env.MANAGER_DATA_MODE === "mock"
  if (initialView === "runs") {
    let runs = emptyRunPage()
    let runsLoadError: string | undefined
    if (isDemo) {
      runsLoadError = "Run history is available only from the Admin ledger."
    } else {
      try {
        runs = await (
          await createSeoAdminClient()
        ).getSeoRuns(25, params?.cursor)
      } catch (error) {
        runsLoadError =
          error instanceof Error
            ? error.message
            : "Admin SEO run history could not be loaded."
      }
    }
    return (
      <div className="studio-page studio-page--seo">
        <SeoRunsPage
          page={runs}
          loadError={runsLoadError}
          cursor={params?.cursor}
          isDemo={isDemo}
        />
      </div>
    )
  }

  const csrfToken = issueSeoCsrfToken(user.id)
  let workspace: SeoWorkspace
  let loadError: string | undefined

  if (isDemo) {
    workspace = buildSeoDemoWorkspace()
  } else {
    try {
      workspace = await (await createSeoAdminClient()).getSeoWorkspace(50)
    } catch (error) {
      workspace = emptyWorkspace()
      loadError =
        error instanceof Error
          ? error.message
          : "Admin SEO workspace could not be loaded."
    }
  }

  const assertionConfigured =
    Boolean(env.SEO_APPROVAL_KEY_ID) && Boolean(env.SEO_APPROVAL_PRIVATE_KEY)
  const readOnlyReason = assertionConfigured
    ? loadError
      ? "Actions are disabled until the Admin ledger is reachable."
      : undefined
    : "Delegated approval signing is not configured. Add the active Manager private key and matching Admin public key before enabling decisions."

  return (
    <div className="studio-page studio-page--seo">
      <SeoWorkspaceView
        initialWorkspace={workspace}
        initialView={initialView}
        initialCsrfToken={csrfToken}
        readOnlyReason={readOnlyReason}
        loadError={loadError}
        isDemo={isDemo}
      />
    </div>
  )
}
