---
module: Studio shared assets
problem_type: database_issue
tags: [studio, assets, content-packs, retention, source-identity]
---

# Immutable Studio assets and canonical source resolution

Admin owns shared assets and Content Packs. `StudioAssetService` wraps the existing
MediaAsset registry and LOCAL/S3 byte adapters. Each registration writes and reads
back original bytes, validates SHA-256, then creates one immutable version pointing
to one private READY MediaAsset. Replacement preserves the family `assetId` but
creates a fresh `versionId`, registry ID, storage key and digest. It never overwrites
historical bytes. Generic delete, replacement and visibility operations consult
Studio usage; database triggers also reject mutation of retained registry rows and
aliasing their storage keys. Folder organization remains mutable.

## Public contracts

Portable Zod contracts live in `@forge/studio-contracts/assets`, `/content-packs`,
`/sources`, and `/experiments`. They import no application, Prisma, React or provider
code. References are `{assetId, versionId, digest}`. Pack assignments use immutable
`packRevisionIds`; pack evidence (`sources`) and editorial `guidance` are distinct.
The existing revision-checked `applyStudioCommand` attaches items and pack refs.

Admin GraphQL exposes `studioAssets` (role/search/cursor/limit), `studioAsset`,
`studioContentPacks` (search/cursor/limit), `studioContentPackRevision`,
`writeStudioContentPack`, `studioNarrationIdentity`, `studioNarrationMatches`,
`captureStudioSource`, `studioSourceSnapshot`, `studioSourceEligibility`,
`materializeStudioSource`, `issueStudioAssetRead`, `issueStudioAssetUpload`,
`requestStudioExperiment`, `studioExperiment`, and
`attachStudioExperimentCandidate`. JSON inputs are validated by the portable
schemas. Author permissions apply to selection and capabilities; experiment
admission requires a human and candidate attachment/materialization requires a
trusted service. No operation dispatches paid work on admission or a cache miss. Experiment admission
includes bounded effective settings; candidates must retain matching settings.
Completed outputs retain their experiment association even if actual cost/count
exceeds admission. `studioExperiment.outcome` reports `OVERRUN`, cost/count flags
and the exact total microcost as a decimal string. Feat-458 enforces dispatch
budgets before execution.

Read/upload capabilities are random, five-minute, version/payload-specific tokens;
only their hashes are stored. Portable `studioAssetUploadSchema` carries the
registration metadata, expected byte size and digest. PUT verifies exact admitted length and SHA-256 before
registration. Read responses are private/no-store. Generic anonymous previews
require both READY and PUBLIC; authenticated authorized previews remain available.
The upload maximum is 256 MiB, and there is no provider execution here.

## Narration and recovered originals

New recorded narration must include effective text, role, language, provider, model,
provider voice ID, settings, and pronunciation reference or explicit `null`.
`narrationIdentity` resolves the exact voice preset version from foundation
`speech.voice`; its provider voice ID is used, not the asset family ID. Speech
settings and dictionary choice are explicit; non-null dictionaries must have the
`pronunciation` asset role. Lookup compares the complete canonical
identity. Unknown historic narration has no reusable identity and cannot match.
`importStudioBaseline` uses normal registration and preserves all inventoried
original bytes, source paths and available metadata. Missing voice/settings or music
provenance remains unknown; importing historic approval files grants no approval.

## Canonical source and downstream handoff

`StudioSourceService.capture` requires exact Video/Dub/Edition/language slug,
subtitle track and download IDs plus bounded source times. It never chooses another
language, edition, caption track, or transcription. Canonical VTT bytes are retained
with their digest, track flags and selected URLs. `mapStudioSourceCues` maps separate
source intervals to composition frames without filling gaps or rounding away timing.

Default admission retains a canonical descriptor and VTT, permitting bounded HLS
preview preparation without downloading a multi-gigabyte film. A descriptor has
`materialization: "descriptor"`, `originalByteDigest: null`, and no covered ranges.
Its digest proves descriptor bytes only. It is rejected by render/publication input
validation. Optional `retainOriginalBytes: true` downloads at most 256 MiB; exceeding
that bound fails explicitly. Production downloads use an HTTPS origin allowlist,
a 30-second timeout and no redirects. There is no silent lower-resolution fallback.

Feat-456's trusted broker can register digest-checked selected media and preview/
export manifests with source snapshot ID, catalog digest, purpose, height and covered
ranges. `materializeStudioSource` creates a new immutable snapshot after checking
retained manifest/media bytes, matching ranges and the admitted full-resolution
export height. It leaves `originalByteDigest: null` for segmented materialization;
individual media references carry their own byte digests. The broker is responsible
for proving extraction/codec/dimensions against the admitted source; JSON metadata
alone is never accepted as video media. No production broker or provider runs in
this feature. Render input checks require materialization covering every trim.

Catalog feat-459 and publication feat-460 use transaction-compatible exports from
`services/studio-authoring/sources.ts`: `assertStudioSourceEligible`,
`resolveStudioDocumentSources`, `assertStudioRenderSources`; and from `packs.ts`:
`resolveStudioPackSources`. Resolution returns immutable `snapshot` plus **current**
`eligibility`. Current eligibility locks catalog rows before checking availability,
exact identity, URLs/duration and platform restrictions even for operators.
Consumers must use the returned current restrictions, not just pinned old evidence.
Source snapshots have restrictive FKs to Video, Dub, Edition, Subtitle and Download.
They are the canonical registry; downstream work must not introduce another one.

## Transactional retention

Migrations 0073–0078 enforce immutable versions, pack revisions, source snapshots,
components, candidates and usage edges. SQL insert/update triggers retain asset refs
from project creation, edits, fresh generation revisions, every attempt input and
result (including STALE results after publication), pack versions, component code,
source snapshots and internal publication. Dependencies of manifest versions and
pack source snapshots expand into those edges. Historical edges survive edits and
unpublication. Invalid asset triples fail the whole transaction. Source item triples
must match admitted source snapshots. The internal publication seam additionally
checks current eligibility and render materialization before its required verifier.

## Reproducible validation

Use only the disposable database `127.0.0.1:55455/forge_studio_455_test`, user
`studio455`, cluster `/tmp/forge-studio-455-pg`. Never reuse feat-454's port 55454.
The three Studio database suites require `STUDIO_TEST_DATABASE_URL`; feat-455 suites
refuse another host/port/database. Their byte tests use this checkout's LOCAL adapter
and isolated IDs. The source fixture serves exact bytes over loopback HTTP; these
are storage/identity tests, not a claim of codec or visual export certification.

The recovered originals remain under
`/home/tataihono/.local/share/forge/studio-lyuba-baseline/`. Tests register and read
all 132 files and compare recorded sizes/hashes, including six scripts. They do not
alter originals or upload production assets. Additional cases cover replacement
reconnect, exact identity misses, explicit dictionary absence, GraphQL authorization,
scoped transfers, generic guards, revision/attempt/component/pack/publication edges,
capture races, wrong source selections, literal cue timings, descriptor rejection,
low-resolution export rejection, and changed current restrictions.

Final validation evidence: all 87 migrations passed on a freshly created dedicated
database; all 24 Studio database/GraphQL cases passed. Admin full suite: 6,123 passed,
with Redis-fallback and SEO-timeout failures both passing isolated reruns (8 and 30
cases respectively). Admin, Manager, admin-graphql and studio-contracts typechecks
passed; neutral suite has three passing cases. SDL/introspection regeneration has
zero drift. Scoped ESLint and lint-staged passed. The media inspector change only
adds static usage labels; it adds no fetch, hydration or initialization work.

Independent Standards review identified classification tags, historical source
query bounds and pronunciation-role checks; all were fixed. Independent Spec
review identified explicit experiment settings and completed-overrun retention;
both were fixed with acceptance tests. No outstanding review findings remain after
re-review. The implementation and final evidence are local commits only.
