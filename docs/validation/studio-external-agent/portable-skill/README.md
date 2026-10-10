# Portable skill implementation evidence

Feat-547 ships `skills/shorts-creator/` as a standalone skill and
`apps/manager/public/shorts-creator.zip` as its download. The Shorts projects
page has one native download link. Users install/extract this archive without a
Forge checkout, provider credentials, or packaging tools. Client-specific
installation and OAuth connection instructions are inside the package.

## Reproduce package and contract validation

```sh
pnpm --filter @forge/manager skill:package
pnpm --filter @forge/manager skill:check
pnpm --filter @forge/manager test -- src/services/studio-agent/portable-skill.test.ts
pnpm --filter @forge/admin test -- src/services/studio-authoring/portable-skill.test.ts
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/admin typecheck
CI=1 pnpm --filter @forge/manager build
```

The maintainer packaging script uses Python 3 standard library only. Sorted ZIP
entries have fixed timestamps, regular-file permissions and stored bytes, so
reproduction does not depend on compressor versions. `skill:check` compares the
committed archive with source, checks paths and references, and rejects symlinks
or checkout paths. The Manager test extracts the archive to a temporary directory
outside the checkout, resolves its references, and parses shipped examples
against actual MCP tool schemas. Five examples cover creation, source capture,
composition/music, speech and conversation feedback. The Admin test applies the
examples through the real operation engine and verifies separate overlay/spoken
text while preserving intervening human timing, title, style and music.

Two Manager tests and one Admin test passed. Admin and Manager typechecks and
touched-file lint passed. Manager production build passed,
including normal standalone public-asset copying. The measured build used `CI=1`
and the repository's existing CI validation behavior, with no provider credentials
loaded. A normal non-CI environment requires its declared configuration. This
is compilation evidence, not provider connectivity.
Skill-creator's packaging
validator passed. No GraphQL schema changes, paid calls or deployment occurred.

## Discovery loading impact

Run the retained measurement from the repository root:

```sh
node docs/validation/studio-external-agent/portable-skill/measure-discovery.cjs "$PWD"
```

`discovery-performance.json` compares the actual initial projects component SSR
against the fixed pre-skill baseline `0b75ba130`. It uses actual React, Next Link,
and lucide rendering with 100 warmups and 500 alternating measurements; the
existing client fetch rejects if invoked during SSR. Initial markup grew from
636 to 740 bytes, gzip 395 to 450 (+55 bytes). Median component rendering was
0.447ms before and 0.472ms after; that difference is noise, not a performance
improvement or regression claim. The new native anchor adds no module import,
prefetch, fetch, media, hydration hook or script. The ZIP transfers only when
explicitly downloaded. The final reviewed archive is 28,788 bytes;
this retained page-load measurement used the earlier 28,510-byte archive. The
278-byte documentation correction changes only the download payload, not page
markup or initial loading.

This is scoped server-render/loading-payload evidence, not a fresh end-to-end
browser navigation/LCP measurement. It does not replace feat-546's broader
review-interface performance evidence.

## Qualification boundary

Static contract validation and operation tests are separate from a real-agent
workflow. The final archive's actual Codex broad-brief → render → inspect →
feedback run, including one bounded repair, is recorded in
`../final-skill-replay.md`. Its client received the sample images but explicitly
declined visual assessment; Claude installation/access remains unobserved.
Recheck the archive SHA256 after the final commit hooks. Documentation-backed
setup instructions alone are not client qualification.
