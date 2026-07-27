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
    description: "Create a new localized Experience draft.",
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
    description: "Update an existing localized Experience draft.",
    requiredScopes: ["experience:locale:update"],
    inputSchema: {
      type: "object",
      properties: {
        localeId: { type: "string" },
        draft: { type: "object" },
      },
      required: ["localeId", "draft"],
      additionalProperties: false,
    },
  },
  {
    name: "experience.locale.publish",
    description: "Publish a validated ExperienceLocale.",
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
      "Create a new Experience with an initial DRAFT locale. Never publishes; set meta/OG fields afterwards via experience.locale.update.",
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
    name: "experience.generate",
    description:
      "Generate a new DRAFT Experience server-side with AI (video-grounded quick draft; optional persona steering). Never publishes.",
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
