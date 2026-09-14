# Shorts-owned data model

User direction: Shorts must not be generated Video/VideoDub catalog entries. Use a dedicated Short table, permit many Shorts per existing VideoDub, and remove Studio names from unshipped database migrations. Supersedes the earlier Watch-publication integration.

- Replace the authoring project Prisma model with `Short`, mapped to `short`, with optional indexed `sourceVideoDubId` and inverse `VideoDub.shorts`. Standalone authoring remains valid; source snapshots still preserve exact multi-source provenance.
- Store rendered release metadata and Mux identities in Short-owned release rows. Never create or change Video, VideoDub, VideoEdition, VideoLocale, VideoImage or MuxVideo as output records.
- Keep immutable revision, approval, execution, lease, schedule, publication and revocation rules within Short-owned records. Remove Watch delivery and catalog-table triggers. Restore Watch consumers and shared visibility contracts to main.
- Rename the unshipped consolidated Admin migration to `0094_shorts` and its tables/constraints/functions/triggers; rename the separate unshipped native execution migration too. No compatibility migrations or deployed DB changes.
- Update callers, GraphQL generation and focused tests. Verify fresh migration replay, one dub-to-many Shorts, standalone creation, zero output catalog writes, and publication/revocation. Keep concise results only, with no raw captures committed.

Completed locally: `Short` and supporting Prisma/SQL names, source-dub creation/read contracts, Short-owned releases, publication/revocation and removal of Watch coupling. Watch files match main exactly. Both migrations replayed on isolated databases; Short schema comparison has no drift. Three model DB tests and ten release/publication DB tests passed; the native execution deadline and migration runner passed five tests. Shared restored consumers passed 187 unit tests; contract/native/client checks and Admin, Manager, Mastra and Web types passed. Review corrected a source-immutability test to require the identity guard's exact error rather than any constraint failure. Source reviews are clear. No production database, provider or VM changes were performed.

## CI follow-up

The recommendation attribution migration fixture mixed a fixed expiry with a current-time creation default. Pin its request creation to the existing fixture timeline; production migrations and expiry constraints remain unchanged. The exact expiry failure reproduced before the fix; all 49 tests in the 11-file CI group pass afterward with the isolated database set to UTC, matching CI. The initial local Pacific/Auckland run had two separate timezone-dependent failures. Changed-file lint and formatting pass.
