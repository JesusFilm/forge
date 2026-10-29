import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "./errors"
import { ManagerAutomationValidationError } from "./manager-automation.service"

const candidateInput = z.object({
  template: z.enum([
    "source_subtitles_missing",
    "target_subtitles_missing",
    "metadata_missing",
  ]),
  refreshMode: z.enum(["missing_only", "refresh_ai_generated"]),
  targetLanguageIds: z.array(z.string().min(1)).max(1),
  limit: z.number().int().min(1).max(100),
})

export async function getManagerAutomationCandidates(
  db: PrismaClient,
  user: Principal | null,
  input: unknown,
) {
  if (!hasPermission(user, "write:manager-jobs")) throw new ForbiddenError()
  const options = candidateInput.parse(input)
  if (
    (options.template === "target_subtitles_missing") !==
    (options.targetLanguageIds.length === 1)
  )
    throw new ManagerAutomationValidationError(
      "Target subtitles require exactly one target language",
    )
  const target = options.targetLanguageIds[0]
  const language = target
    ? await db.language.findFirst({
        where: { deletedAt: null, OR: [{ id: target }, { coreId: target }] },
        select: { id: true, coreId: true },
      })
    : null
  if (target && !language)
    throw new ManagerAutomationValidationError("Unknown target language")
  const targetKey = language?.coreId ?? language?.id ?? "source"
  type Row = {
    document_id: string | null
    core_id: string | null
    output_owner: "missing" | "ai" | null
    eligible_count: number
    duplicate_count: number
  }
  const ownership =
    options.template === "metadata_missing"
      ? Prisma.sql`CASE WHEN v.ai_metadata THEN 'ai' WHEN EXISTS (SELECT 1 FROM video_locale vl WHERE vl.video_id=v.id AND vl.deleted_at IS NULL AND (NULLIF(BTRIM(vl.title),'') IS NOT NULL OR NULLIF(BTRIM(vl.description),'') IS NOT NULL)) THEN 'human' ELSE 'missing' END`
      : Prisma.sql`CASE WHEN EXISTS (SELECT 1 FROM video_subtitle s WHERE s.video_id=v.id AND s.deleted_at IS NULL AND s.language_id=${language ? Prisma.sql`${language.id}` : Prisma.sql`v.primary_language_id`} AND NOT s.ai_generated) THEN 'human' WHEN EXISTS (SELECT 1 FROM video_subtitle s WHERE s.video_id=v.id AND s.deleted_at IS NULL AND s.language_id=${language ? Prisma.sql`${language.id}` : Prisma.sql`v.primary_language_id`} AND s.ai_generated) THEN 'ai' ELSE 'missing' END`
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    WITH owners AS (
      SELECT v.id AS document_id, v.core_id, ${ownership} AS output_owner,
        CONCAT(${options.template}::text, ':', v.id, ':', ${targetKey}::text) AS automation_key,
        (SELECT vl.title FROM video_locale vl WHERE vl.video_id=v.id AND vl.deleted_at IS NULL AND vl.title IS NOT NULL ORDER BY (vl.locale='en') DESC,vl.id LIMIT 1) AS title
      FROM video v
      WHERE v.deleted_at IS NULL AND v.published_at IS NOT NULL
        AND NULLIF(v.core_id,'') IS NOT NULL AND v.primary_language_id IS NOT NULL
        AND COALESCE(v.label::text,'') NOT IN ('collection','series')
        AND EXISTS (SELECT 1 FROM video_dub d JOIN mux_video m ON m.id=d.mux_video_id WHERE d.video_id=v.id AND d.language_id=v.primary_language_id AND d.deleted_at IS NULL AND m.deleted_at IS NULL AND NULLIF(m.asset_id,'') IS NOT NULL)
    ), scored AS (
      SELECT owners.*, EXISTS (SELECT 1 FROM manager_enrichment_job j WHERE j.status IN ('pending','running') AND j.artifacts #>> '{automation,data,automationKey}'=owners.automation_key) AS duplicate
      FROM owners WHERE output_owner='missing' ${options.refreshMode === "refresh_ai_generated" ? Prisma.sql`OR output_owner='ai'` : Prisma.empty}
    ), selected AS (
      SELECT * FROM scored WHERE NOT duplicate ORDER BY title NULLS LAST,document_id LIMIT ${options.limit}
    ), summary AS (
      SELECT COUNT(*) FILTER(WHERE NOT duplicate)::int AS eligible_count, COUNT(*) FILTER(WHERE duplicate)::int AS duplicate_count FROM scored
    ) SELECT selected.document_id, selected.core_id, selected.output_owner, summary.* FROM summary LEFT JOIN selected ON true ORDER BY selected.title NULLS LAST,selected.document_id
  `)
  return {
    eligibleCount: rows[0]?.eligible_count ?? 0,
    skippedDuplicateCount: rows[0]?.duplicate_count ?? 0,
    candidates: rows.flatMap((row) =>
      row.document_id && row.core_id && row.output_owner
        ? [
            {
              documentId: row.document_id,
              coreId: row.core_id,
              outputOwner: row.output_owner,
            },
          ]
        : [],
    ),
  }
}
