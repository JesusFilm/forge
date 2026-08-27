import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"

export type AdminMcpToolDefinition = {
  name: string
  description: string
  requiredScopes: readonly string[]
  inputSchema: {
    type: "object"
    properties?: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
}

const WATCH_HOME_CATEGORY_RAIL_MCP_GUIDANCE =
  `The watchHomeCategoryRail block is a homepage-only top-level singleton with shape {t:"watchHomeCategoryRail",categoryIds:[...]}. ` +
  `categoryIds must be a non-empty unique subset of ${WATCH_HOME_CATEGORY_CATALOG.map(({ id }) => id).join(", ")}; array order is rendered tile order. ` +
  "When changing it, send the complete blocks array and preserve unrelated blocks and their order."

export const ADMIN_MCP_TOOLS = [
  {
    name: "experience.list",
    description: "List Experiences the authenticated Admin user may read.",
    requiredScopes: ["experience:read"],
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "experience.locale.list",
    description: "List locales for an Experience.",
    requiredScopes: ["experience:read"],
    inputSchema: {
      type: "object",
      properties: {
        experienceId: { type: "string" },
      },
      required: ["experienceId"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.locale.read",
    description: "Read one ExperienceLocale and its localization context.",
    requiredScopes: ["experience:read"],
    inputSchema: {
      type: "object",
      properties: {
        experienceId: { type: "string" },
        locale: { type: "string" },
      },
      required: ["experienceId", "locale"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.locale.missing",
    description: "Find Experiences missing requested target locales.",
    requiredScopes: ["experience:read"],
    inputSchema: {
      type: "object",
      properties: {
        sourceLocale: { type: "string" },
        targetLocales: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
        },
      },
      required: ["sourceLocale", "targetLocales"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.locale.validate",
    description: "Validate a proposed ExperienceLocale draft.",
    requiredScopes: ["experience:locale:validate"],
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["create", "update"] },
        draft: { type: "object" },
      },
      required: ["draft"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.locale.diff",
    description: "Compare source and target ExperienceLocale content.",
    requiredScopes: ["experience:read", "experience:locale:validate"],
    inputSchema: {
      type: "object",
      properties: {
        sourceLocaleId: { type: "string" },
        targetDraft: { type: "object" },
      },
      required: ["sourceLocaleId", "targetDraft"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.locale.create",
    description: `Create a new localized Experience draft. ${WATCH_HOME_CATEGORY_RAIL_MCP_GUIDANCE}`,
    requiredScopes: ["experience:locale:create"],
    inputSchema: {
      type: "object",
      properties: {
        experienceId: { type: "string" },
        locale: { type: "string" },
        draft: { type: "object" },
      },
      required: ["experienceId", "locale", "draft"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.locale.update",
    description: `Update an existing localized Experience draft. ${WATCH_HOME_CATEGORY_RAIL_MCP_GUIDANCE}`,
    requiredScopes: ["experience:locale:update"],
    inputSchema: {
      type: "object",
      properties: {
        localeId: { type: "string" },
        expectedDraftRevision: {
          type: ["string", "null"],
          description:
            "Opaque revision returned by experience.locale.read, or null to assert that no active draft exists.",
        },
        draft: { type: "object" },
      },
      required: ["localeId", "expectedDraftRevision", "draft"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.locale.publish",
    description:
      "Publish the one active shared draft for an ExperienceLocale into canonical public content.",
    requiredScopes: ["experience:publish"],
    inputSchema: {
      type: "object",
      properties: {
        localeId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["localeId", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.locale.discard",
    description:
      "Conditionally discard a newly created active draft without overwriting a later editor change. Restore an existing draft by calling experience.locale.update with the produced revision and the private pre-write payload.",
    requiredScopes: ["experience:locale:update"],
    inputSchema: {
      type: "object",
      properties: {
        localeId: { type: "string" },
        expectedDraftRevision: { type: "string" },
      },
      required: ["localeId", "expectedDraftRevision"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.locale.preview",
    description:
      "Return the unlisted public preview URL for the active shared ExperienceLocale draft. The URL remains valid until that draft is published or discarded.",
    requiredScopes: ["experience:read"],
    inputSchema: {
      type: "object",
      properties: {
        localeId: { type: "string" },
      },
      required: ["localeId"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.media.check",
    description:
      "Check target-locale media availability for Experience blocks.",
    requiredScopes: ["experience:read", "media:read", "video:read"],
    inputSchema: {
      type: "object",
      properties: {
        blocks: { type: "array" },
        targetLocale: { type: "string" },
      },
      required: ["blocks", "targetLocale"],
      additionalProperties: false,
    },
  },
  {
    name: "video.search_replacements",
    description: "Search for target-locale-compatible replacement videos.",
    requiredScopes: ["video:read"],
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        locale: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["q", "locale"],
      additionalProperties: false,
    },
  },
  {
    name: "bible.lookup",
    description: "Look up Bible reference metadata for localization.",
    requiredScopes: ["bible:read"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        locale: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.create",
    description:
      "Create a new Experience with an initial non-homepage DRAFT locale, so blocks cannot include watchHomeCategoryRail; use experience.locale.update on the designated homepage instead. Never publishes; set meta/OG fields afterwards via experience.locale.update. Unlike the locale tools, expected failures return a structuredContent envelope {ok:false, reason, retryable, message} instead of a JSON-RPC error — a duplicate (locale, slug) returns reason 'slug_exists' with the existing resource's ids in a conflict field; success returns {ok:true, experience, locale, editorUrl}.",
    requiredScopes: ["experience:create"],
    inputSchema: {
      type: "object",
      properties: {
        locale: { type: "string" },
        slug: { type: "string" },
        title: { type: "string" },
        blocks: { type: "array" },
        isTemplate: { type: "boolean" },
      },
      required: ["locale", "slug", "title", "blocks"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.duplicate",
    description:
      "Duplicate every locale of any readable Experience into a new unpublished DRAFT Experience owned by the delegated principal. Copies authored blocks, routing, SEO, OG content, and template classification; generates available -copy slugs; never copies homepage, publication, embedding, revision, or chat state. Success returns {ok:true, sourceExperienceId, experience, locales, editorUrl}.",
    requiredScopes: ["experience:read", "experience:create"],
    inputSchema: {
      type: "object",
      properties: {
        experienceId: { type: "string", minLength: 1 },
      },
      required: ["experienceId"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.generate",
    description:
      "Generate a new DRAFT Experience server-side with AI (video-grounded quick draft; optional persona steering). Never publishes. Expected failures return a structuredContent envelope {ok:false, reason, retryable, message} instead of a JSON-RPC error (reasons: config_missing, auth_failed, network_error, parse_error, invalid_input, timeout, generation_failed, internal_error, slug_exists, candidates_failed, normalization_failed, persist_failed); retry only when retryable is true. Success returns {ok:true, experience, locale, editorUrl, provenance}.",
    requiredScopes: ["experience:generate"],
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string" },
        locale: { type: "string" },
        slug: { type: "string" },
        personaId: { type: "string" },
        exemplarExperienceId: { type: "string" },
      },
      required: ["topic", "locale"],
      additionalProperties: false,
    },
  },
] as const satisfies readonly AdminMcpToolDefinition[]

export function findAdminMcpTool(name: string) {
  return ADMIN_MCP_TOOLS.find((tool) => tool.name === name)
}
