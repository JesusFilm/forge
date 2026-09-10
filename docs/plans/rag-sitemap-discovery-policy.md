# RAG sitemap discovery correction

Scope: feat-468; the acquisition discovery path in `apps/rag`.

## Requirements

- Registered sitemap roots must be fetchable even when content allow patterns
  admit only article paths. Apply content allow/block/articleHints only to pages.
- Recursive children and redirects need an explicit bounded transport policy;
  preserve HTTP(S), credential, private-address, and redirect-count guards.
- The Icelandic registered path scope must not admit another language's sitemap.
- Use the real HTTP adapter in tests so a fake fetcher cannot hide admission errors.
- Preserve article policies, registry inventories, corpus state, and existing
  partial-sitemap failure semantics.

## Investigation and approach

Current main reproduces the reported code mismatch. Audit all registry policies
locally to distinguish affected restrictive policies from whole-domain and seeded
sources. Use a separate discovery destination policy anchored to each registered
sitemap origin and parent directory. Local adversarial review confirmed this
preserves recursion and path isolation; exact seed-only permission would break
recursive indexes, and a filename suffix requirement has no registry contract. No cross-model reviewer is permitted.

## Validation and completion

Run failing reproduction before the correction, then positive and negative
real-adapter tests, existing discovery tests, full RAG validation, and a public
sitemap-only smoke if useful. Review the final diff locally, capture the reusable
lesson in the existing knowledge store, and open a focused fix PR.
