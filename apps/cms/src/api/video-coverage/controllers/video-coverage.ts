import type { Core } from "@strapi/strapi"
import {
  queryAutomationCandidates,
  type AutomationCandidatesInput,
} from "../services/automation-candidates"
import { queryVideoCoverage } from "../services/video-coverage"

type StrapiContext = {
  status: number
  body: unknown
  query: Record<string, string | undefined>
}

const AUTOMATION_TEMPLATES = [
  "source_subtitles_missing",
  "target_subtitles_missing",
  "metadata_missing",
] as const

const AUTOMATION_REFRESH_MODES = [
  "missing_only",
  "refresh_ai_generated",
] as const

function parseCsv(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []
}

function parseLimit(value: string | undefined): number | null {
  const limit = Number(value ?? 100)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return null
  }
  return limit
}

function parseAutomationCandidatesQuery(
  query: StrapiContext["query"],
): AutomationCandidatesInput | string {
  const template = query.template
  if (
    !template ||
    !AUTOMATION_TEMPLATES.includes(
      template as (typeof AUTOMATION_TEMPLATES)[number],
    )
  ) {
    return "template must be a supported automation candidate template"
  }

  const refreshMode = query.refreshMode
  if (
    !refreshMode ||
    !AUTOMATION_REFRESH_MODES.includes(
      refreshMode as (typeof AUTOMATION_REFRESH_MODES)[number],
    )
  ) {
    return "refreshMode must be missing_only or refresh_ai_generated"
  }

  const targetLanguageIds = parseCsv(query.targetLanguageIds)
  if (
    template === "target_subtitles_missing" &&
    targetLanguageIds.length !== 1
  ) {
    return "target_subtitles_missing requires exactly one target language"
  }

  const limit = parseLimit(query.limit)
  if (limit == null) {
    return "limit must be an integer from 1 to 100"
  }

  return {
    template: template as AutomationCandidatesInput["template"],
    refreshMode: refreshMode as AutomationCandidatesInput["refreshMode"],
    targetLanguageIds,
    limit,
  }
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async index(ctx: StrapiContext) {
    const languageIds = ctx.query.languageIds
      ? ctx.query.languageIds.split(",").filter(Boolean)
      : undefined

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const knex = (strapi.db as any).connection

    const videos = await queryVideoCoverage(knex, languageIds)

    ctx.status = 200
    ctx.body = { videos }
  },

  async automationCandidates(ctx: StrapiContext) {
    const parsed = parseAutomationCandidatesQuery(ctx.query)
    if (typeof parsed === "string") {
      ctx.status = 400
      ctx.body = { error: parsed }
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const knex = (strapi.db as any).connection
    const result = await queryAutomationCandidates(knex, parsed)

    ctx.status = 200
    ctx.body = result
  },
})
