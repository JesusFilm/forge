/**
 * Tool catalog (U5) — Mastra tools wrapping admin services for chat agents.
 *
 * Each tool calls into an existing service-layer entrypoint, NOT
 * directly into Prisma (except for pure reference reads like
 * BibleBook). The service layer's ABAC + revision tracking governs
 * agent-driven writes.
 *
 * Adding a new tool: define a `createTool(...)` module under this
 * directory, write a test, and re-export here. Agents in U6+ import
 * the named tools they want and pass them via `tools: { ... }`.
 */

export { searchVideosTool } from "./search-videos"
export { lookupBibleVerseTool } from "./lookup-bible-verse"
export { fetchVideoImageTool } from "./fetch-video-image"
