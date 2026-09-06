# ADR-0001 — Three bounded contexts behind ports; the import law

- Status: Accepted — Forge names the ingestion context `indexing` and uses
  executable scripts around the shared `src/main.ts` wiring factory.
- Date: 2026-05-21
- Issue/PR: — (foundational; see architecture.md §3–§5)
- Related: ADR-0003 (data access lives behind these ports)

## Context

The predecessor project (jesusfilm-ai) became unmaintainable: a ~1,400-line `store.ts` that
"everything reached into" via `require('./store')`, with no enforced boundaries,
so "just one more import" steadily coupled every layer until change became risky.
We re-founded this service specifically to not repeat that.

## Decision

Three bounded contexts — **Acquisition**, **Ingestion**, **Retrieval** — plus a
thin **Serving** adapter, all communicating through **port interfaces** in
`src/contracts`. The "import law": everything depends on those interfaces, never
on concrete code; the only module that constructs adapters and wires them is
`src/main.ts`.

**Forge migration note.** The boundary remains unchanged. In Forge,
**Ingestion** is named **Indexing**, `src/main.ts` exposes shared wiring, and
`scripts/*.ts` are the executable composition roots that select operations and
targets. Adapter construction remains outside the domain modules.

The boundary is **mechanically enforced** — `dependency-cruiser` (import rules),
an eslint file-size cap, and a fakes-only unit-test rule — so crossing it fails
the build. The build failure, not this document, is what keeps it honest. The
full enforcement detail and the dependency-cruiser config live in
[`architecture.md`](../architecture.md) §4–§5.

## Alternatives rejected

- **Convention-only boundaries (no enforcement)** — what jesusfilm-ai had. It
  relies on discipline and erodes one import at a time. A boundary that doesn't
  fail the build isn't real.
- **A shared data/store module imported everywhere** — the exact do-everything
  module that made the predecessor unmaintainable; convenient at first,
  unworkable at scale.

## Consequences

- (+) Contexts are testable with in-memory fakes — no DB, no network. A context
  that _can't_ be is, by definition, coupled, and the test rule catches it.
- (+) The database technology is confined to `src/adapters` and swappable without
  touching any context — this is what makes ADR-0003 a low-risk change.
- (–) Indirection has a cost: ports, fakes, and a composition root are more
  upfront structure than a direct call. We accept it as the price of staying maintainable.
