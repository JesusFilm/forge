# apps/mastra Agent Guide

Full context lives in `apps/mastra/CLAUDE.md`. Keep both files aligned.

## Core model

- Runs the self-hosted Mastra Server runtime for Forge agents and workflows.
- Owns transcript embedding chunk planning and provider calls, then submits
  transcript vectors to Admin ingest.
- Owns experience embedding provider calls and workflow diagnostics, then
  submits experience vectors to Admin's experience-specific ingest endpoint.
- Owns offline eval query generation for catalog-derived, locale-quality, and
  Admin-trace-sampled candidates, then stores staged candidates back through
  Admin's authenticated HTTP contracts.
- Owns the offline search eval system: seed prompt sets, baseline/report
  artifacts, comparison workflows, judge orchestration, and developer/operator
  eval routes that call Admin search through authenticated HTTP.
- Owns search eval caller tracks. Public Watch, AI experience generation, and
  semantic diagnostics use different seed prompts, mode defaults, judge
  rubrics, and baseline identities even when they call the same Admin search
  endpoint.
- Owns a thin search eval orchestrator that coordinates those leaf workflows
  for baseline capture, comparison, native Evaluation sync, and release-gate
  summaries without moving leaf logic into one mega-workflow.
- Owns Firecrawl web data access for agents and operator workflows through
  bounded search/scrape tools, a dedicated web research agent, and the
  `/forge-firecrawl-web-data` service route.
- Owns optional website review-queue and saved-source discovery integration.
  Incomplete website configuration disables only that integration and must
  never block Mastra startup; outbound clients require HTTPS before sending
  the shared bearer and reject redirects.
- Owns subtitle enrichment execution through `/forge-subtitle-enrichment`:
  reads Manager transcript artifacts, translates and retimes subtitles, and
  writes Manager-compatible subtitle/translation artifacts to shared storage.
- Owns RAG retrieval for the seeker agent through the `retrieveAnswer` tool and
  `jesusfilm-rag-client` (outbound-only bearer to the JesusFilm RAG service;
  the tool returns cited passages, the agent generates the answer). Fully
  optional config — unset degrades to an explicit unavailable result, never a
  boot failure.
- Owns subtitle scripture accuracy validation for Bible-story results:
  runs model-knowledge checks by default, can optionally compare against a
  configured target-language Bible text source, and writes sanitized
  Manager-compatible validation artifacts.
- Owns source transcript scripture correction judgment through
  `/forge-transcript-scripture-correction`: detects likely Bible-story source
  transcripts and returns bounded correction candidates/flag-only findings.
  Manager applies deterministic exact-match corrections and writes artifacts.
- Transcript and experience embedding workflows share provider-result
  validation for count alignment, finite vector values, and configured
  dimensions before calling Admin.
- AI Gateway content embeddings request the normal OpenAI-compatible
  embedding response and require the configured native dimensions before Admin
  ingest. Current production gateway output is native 1536, so Mastra does not
  pass `dimensions` through LiteLLM and does not apply a client transform; keep
  the shared 4096-to-1536 truncate/re-normalize helper for future gateway
  variants that truly return 4096.
- Transcript and experience embedding workflows use the shared Admin ingest
  client behavior but keep separate endpoints and payload schemas. The scene
  embedding workflow/Admin ingest path is retired; scene analysis artifacts are
  non-search source artifacts.
- Generation modes are consistent across embedding workflows: omitted means
  idempotent; explicit repair, force, and model-upgrade request rewrites.
- Builds Studio assets with `mastra build --studio` and serves them from the
  same internal Railway service.
- Human Studio access is handled by `apps/mastra-gateway`; this service should
  not become the human identity authority.
- App-to-runtime calls use service bearer authentication.

## Boundaries

- Do not import from app contexts such as `apps/admin`, `apps/manager`, or
  `apps/auth`.
- Do not log bearer tokens, model provider keys, cookies, or raw prompts that
  may contain sensitive data.
- Runtime storage uses Postgres via `DATABASE_URL`; Studio-visible logs and
  observability use DuckDB files under `MASTRA_STORAGE_DIR` on the Railway
  volume.
- Do not import from Admin or Manager to share types; use service HTTP
  contracts and local schemas.
- Eval query generation is offline only. It must not enter Admin's live search
  path, generate live query embeddings, or make generated candidates permanent
  regression truth before Admin human promotion.
- Offline search eval is also outside the live request path. Baselines are
  seed-prompt artifacts owned by Mastra. Keep the Studio-facing workflow
  seed-only until a later human promotion flow decides how staged generated
  candidates should become reviewable.
- Offline search eval baselines are scoped by `callerTrack`. Treat legacy
  untracked baselines as `public-watch`, and do not compare or overwrite a
  baseline under a different caller track.
- The search eval orchestrator must not promote generated, trace-derived, seed,
  or user-submitted candidates. Candidate generation and seed submission are
  opt-in staging steps; human promotion stays behind Admin review contracts.
- Firecrawl access belongs in this runtime. Do not add Firecrawl SDK/API calls
  to Admin or Manager; expose typed Mastra tools/workflows and HTTP contracts
  from here when other apps need web data.
- Subtitle translation and retiming belongs in this runtime. Manager may call
  the service route and handle job state/Mux sync, but should not reintroduce
  provider-heavy subtitle execution.
- Gospel-aware subtitle translation prompt steering belongs in this runtime.
  Manager may send optional title, label, and Bible-reference context, but
  Mastra owns scripture-context detection, translation prompt guidance, and
  sanitized subtitle artifact provenance.
- Subtitle scripture accuracy validation also belongs in this runtime. Missing
  Bible-source configuration must fall back to `model_knowledge` validation,
  not fail translation or require Manager-side scripture logic.
- Source transcript scripture correction judgment also belongs in this runtime.
  Return candidates and sanitized rationale only; do not mutate Manager source
  artifacts or log raw prompts/full Bible passage text.
- Firecrawl MCP is not the product runtime path. Revisit MCP only for local
  operator/coding-agent convenience or after a clear multi-tool server need.
- Studio-facing workflows need structured Zod object input schemas on both the
  workflow and first step. Avoid `z.unknown()` for operator-run workflows, and
  prefer defaults/optional fields that render usable Studio forms.
- Keep service-bearer auth scoped to explicit `/forge-*` service routes so
  Studio's built-in `/api/workflows` calls continue to work.

## Validation

- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- `pnpm --filter @forge/mastra eval:content-embedding-gate -- --baseline-name=<baseline>`
