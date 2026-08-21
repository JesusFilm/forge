import type { QueryResult, QueryResultRow } from "pg"

export const REQUIRED_SUPPORT_RESEARCH_MIGRATION = {
  version: 2,
  name: "002-support-research.sql",
  sha256: "516439bb11d4422d50a8eff496d3b87fecf57694c3f9d01d8cf3d16c2e4d6df9",
} as const

export const REQUIRED_SUPPORT_RESEARCH_TABLES = [
  "support_research.cursors",
  "support_research.runs",
  "support_research.observations",
  "support_research.actions",
  "support_research.action_sources",
  "support_research.reports",
] as const

export const REQUIRED_SUPPORT_RESEARCH_INDEXES = [
  "support_research.support_research_runs_status_lease_idx",
  "support_research.support_research_observations_cluster_idx",
  "support_research.support_research_observations_theme_idx",
  "support_research.support_research_actions_live_fingerprint_idx",
  "support_research.support_research_actions_due_idx",
  "support_research.support_research_reports_expiry_idx",
] as const

export type SupportResearchDatabase = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

export type SupportResearchDatabaseReadiness =
  | { ready: true; version: number }
  | {
      ready: false
      reason: string
      version?: number
      missingRelations?: string[]
    }

export async function getSupportResearchDatabaseReadiness(
  database: SupportResearchDatabase,
): Promise<SupportResearchDatabaseReadiness> {
  try {
    const migration = await database.query<{ version: number | string }>(
      `select version
         from devotional_workspace.schema_migrations
        where version = $1
          and name = $2
          and sha256 = $3
        limit 1`,
      [
        REQUIRED_SUPPORT_RESEARCH_MIGRATION.version,
        REQUIRED_SUPPORT_RESEARCH_MIGRATION.name,
        REQUIRED_SUPPORT_RESEARCH_MIGRATION.sha256,
      ],
    )
    const version = Number(migration.rows[0]?.version ?? 0)
    if (version !== REQUIRED_SUPPORT_RESEARCH_MIGRATION.version) {
      return {
        ready: false,
        version,
        reason: `required support research migration ${REQUIRED_SUPPORT_RESEARCH_MIGRATION.version} is unavailable`,
      }
    }

    const tables = await database.query<{ relation: string }>(
      `select required.relation
         from unnest($1::text[]) as required(relation)
         left join pg_class as relation
           on relation.oid = to_regclass(required.relation)
        where relation.oid is null
           or relation.relkind <> 'r'
        order by required.relation`,
      [REQUIRED_SUPPORT_RESEARCH_TABLES],
    )
    const indexes = await database.query<{ relation: string }>(
      `select required.relation
         from unnest($1::text[]) as required(relation)
         left join pg_class as relation
           on relation.oid = to_regclass(required.relation)
         left join pg_index as index_metadata
           on index_metadata.indexrelid = relation.oid
        where relation.oid is null
           or relation.relkind <> 'i'
           or index_metadata.indisvalid is distinct from true
        order by required.relation`,
      [REQUIRED_SUPPORT_RESEARCH_INDEXES],
    )
    const missingRelations = [...tables.rows, ...indexes.rows]
      .map((row) => row.relation)
      .sort()
    if (missingRelations.length > 0) {
      return {
        ready: false,
        version,
        reason: "support research schema is incomplete",
        missingRelations,
      }
    }

    return { ready: true, version }
  } catch {
    return {
      ready: false,
      reason: "support research database schema is unavailable",
    }
  }
}
