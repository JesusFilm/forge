# feat-434 Seeker cutover evidence

Verified on September 3, 2026 against the Forge production environment. No
credentials, bearer values, prompts, retrieved passages, or user content are
recorded here.

## Deployment

- Mastra deployment: `5fb4a1e5-ee24-43a7-a2d3-7db212be5ce8` (`SUCCESS`)
- Forge RAG deployment: `514dfbb4-146f-40a8-8ba8-b4b68bdd4bac` (`SUCCESS`)
- `JESUSFILM_RAG_BASE_URL` uses the Forge RAG Railway-private hostname and port
  `8080`.
- `JESUSFILM_RAG_ALLOWED_HOSTS` exactly pins that private hostname.
- The existing API key was retained; its value is intentionally omitted.

## Seeker smoke

After the Mastra deployment completed, an operator ran a fresh Seeker chat turn.
The terminal result was grounded and presented sources, proving that the
deployed `retrieveAnswer` path returned a successful RAG result under the new
configuration.

The smoke is strong operational evidence for the cutover because the active
Mastra configuration addresses Forge RAG through Railway-private DNS. It is not
claimed as per-request log correlation; that would require a request identifier
shared by Mastra and Forge RAG.

## Rollback

The previous public base URL and matching allowlist were retained out of band.
Rollback restores those two values atomically while retaining the existing API
key, then waits for the healthchecked Mastra deployment before repeating the
Seeker smoke. The legacy receiver remains available during feat-435.
