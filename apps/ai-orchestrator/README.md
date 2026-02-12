# apps/ai-orchestrator

AI provider abstraction and orchestration service.

## Boundary

- Owns provider adapters, prompt/policy execution, RAG, provenance logging.
- Must not publish content.
- Writes AI revisions/variants only via Strapi APIs.
