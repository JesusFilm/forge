# feat-455 implementation and verification

Base: reviewed feat-454 commits `55bd5f11`, `037ff6d8`, applied after the four
coordinator prerequisite commits. Scope: canonical Admin Content Packs, immutable
MediaAsset versions, source capture and eligibility, durable dependency edges,
shared audio metadata and explicit experiment admission. No provider execution.

Approved test seams are the Studio command and asset service interfaces backed by
real disposable Postgres, the existing LOCAL byte adapter with real hashes/reads,
and exact catalog resolution against isolated catalog/HTTP fixtures. Database
guard tests also exercise direct writes to verify lifecycle enforcement.

Implementation slices:

1. Register immutable shared bytes and metadata; exact narration identity and
   explicit unknown/absent pronunciation; replacement creates a new version.
2. Version Content Packs with separate evidence and guidance. Add transactional
   dependency edges for all revision/attempt paths, packs, components and the
   internal publication seam. Retain stale results and historical dependencies.
3. Resolve exact catalog Video/Dub/Edition/language/track/download identities,
   retain original source/track bytes, map multiple trims to composition frames,
   and revalidate current eligibility without operator restriction bypass.
4. Expose permissioned GraphQL selection, scoped byte transfer, reusable voice
   presets and explicit estimated-cost experiment/candidate contracts. Import all
   132 recovered files through the same byte-registration service, preserving
   unknown provenance without granting historical approvals/cache hits.
5. Regenerate SDL/introspection, check affected consumers, run focused and full
   suites, independent Standards/Spec review, fix findings and commit locally.

Catalog feat-459 consumes the canonical source snapshots and transaction-compatible
eligibility check. It must not duplicate the source registry. Source catalog FKs
use restrictive deletion; stored restrictions are evidence, and release checks
current restrictions. NLE selection UI remains feat-456; paid audition execution
and UI remain feat-458.

Local preparation: `127.0.0.1:55455/forge_studio_455_test`, user `studio455`,
cluster `/tmp/forge-studio-455-pg`; all 80 baseline migrations passed. Existing
asset baseline: 44 tests passed. All 132 preserved original byte counts and
SHA-256 hashes verified against the recovered inventory. No shared DB or storage
was modified.

Approved source admission adjustment: selection retains a canonical descriptor and
VTT by default, with `originalByteDigest: null`; original bytes are optional and
bounded. Render eligibility requires registered original bytes or broker manifests
covering the admitted full-resolution ranges. Descriptor hashes never stand for
media hashes. See the durable handoff in
`docs/solutions/database-issues/studio-shared-assets-and-source-retention.md`.

Validation: clean disposable database rebuilt with all migrations including
0073–0078; 24 real Postgres/GraphQL/storage/source tests pass. Both conflicting
capture requests and changed current restrictions are covered. Historical/stale
usage survives unpublication. All 132 baseline files round-trip with inventory
hash/size checks. SDL/introspection regenerated. Full suite and independent review
results are recorded in the final handoff after verification.
