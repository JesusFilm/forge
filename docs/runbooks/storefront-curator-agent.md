# Storefront Curator Agent

## Purpose

The `storefront-homepage-curation` workflow prepares small, localized Watch
homepage updates from bounded Admin MCP evidence. English is the only enabled
locale by default. Russian, Spanish, French, and other Admin-supported locales
use the same workflow and are enabled only after separate editorial pilots.

The curator model is a private, zero-tool agent. It is imported only by the
workflow and is not registered in Mastra's public agent registry. The model
receives evidence assembled by deterministic workflow code; it cannot call
Admin, MCP, publish, discard, or any other tool. Deterministic code owns every
read, validation, and write.

The optional schedule is weekly on Monday at 06:00 UTC. Both the workflow mode
and the schedule have independent default-off gates. Automated runs can stage
an Admin shared draft, but publication remains a separate human Admin action.

## Ownership and safety boundaries

- Admin remains authoritative for homepage content, catalog and translation
  inventory, authorization, drafts, previews, and publication.
- `storefront.homepage.context` is read-only and minimal. It returns canonical
  locale content, a canonical digest, bounded evidence, and limited active-draft
  attribution. It does not return draft content or a preview token/URL and does
  not mint preview access.
- Model-provider readiness is checked before the first Admin call, so a missing
  model credential cannot cause catalog data to leave Admin unnecessarily.
- The model may propose at most three `mediaCollection` sections and may use
  only collection, video, and language IDs present in the evidence.
- Deterministic workflow code validates proposal identifiers and block shape.
  Leaf videos receive target-language media checks. Collection parents are
  accepted only from Admin's collection inventory, whose entries already
  represent a playable collection in the target Watch language; the leaf media
  checker is not incorrectly asked to resolve a collection ID.
- Curator sections have a `storefront-curator-` section-key prefix. A refresh
  removes only those sections and inserts their replacements at the first prior
  curator slot. If no curator section exists, the new sections are appended.
  Human-authored blocks keep their relative order and are otherwise unchanged.
- Staging carries a fresh UUID `operationId` and SHA-256 `candidateDigest`.
  Admin recomputes the digest after block normalization, locks the locale row,
  refuses changed canonical content or any active shared draft, and records both
  values in the AI draft's attribution.
- The workflow never calls publish or discard. It retries OAuth renewal and
  explicitly idempotent evidence/validation calls at most once; it never
  retries a stage write or the preview operation that may mint capability.
- Christmas and Easter are optional UTC calendar signals, not mandatory themes.

## Access surfaces

Manual runs use only:

```text
POST /forge-storefront-curation
Authorization: Bearer <dedicated storefront curator operator key>
Content-Type: application/json

{"locale":"en","dryRun":true}
```

The response includes the stored `runId` alongside the validated workflow
output. Operators inspect manual or scheduled runs through the same dedicated
bearer boundary:

```text
GET /forge-storefront-curation/runs?limit=10
GET /forge-storefront-curation/runs/<runId>
Authorization: Bearer <dedicated storefront curator operator key>
```

The list limit defaults to 10 and cannot exceed 25. Inspection responses expose
only run ID, status, timestamps, and the validated storefront output when one is
present. They never expose raw workflow steps, request context, provider errors,
or stored snapshots. `previewUrl` can appear only inside the already-authorized
workflow output contract.

The route is protected by `STOREFRONT_CURATOR_SERVICE_API_KEYS`. An unset
allowlist fails closed. Mastra refuses to boot if any value overlaps the shared
`MASTRA_SERVICE_API_KEYS` pool. Built-in native routes for
`storefront-homepage-curation` are denied, including their read and mutation
variants; the private operator start and inspection routes are the only manual
access surface.

The internal weekly scheduler may invoke the registered workflow only when
`STOREFRONT_CURATOR_SCHEDULE_ENABLED=true` at process startup.

## Configuration

Set the values documented in `apps/mastra/.env.example`:

- `STOREFRONT_CURATOR_MODE`: `off`, `dry_run`, or `stage`; defaults to `off`.
- `STOREFRONT_CURATOR_ENABLED_LOCALES`: locale CSV; defaults to exactly `en`.
- `STOREFRONT_CURATOR_SCHEDULE_ENABLED`: defaults to `false`. When false, the
  workflow has no schedule configuration even if mode is `stage`.
- `STOREFRONT_CURATOR_SERVICE_API_KEYS`: dedicated operator bearer CSV. Keep it
  disjoint from `MASTRA_SERVICE_API_KEYS`.
- `STOREFRONT_CURATOR_MCP_URL`: exact Admin MCP resource URL ending in `/mcp`.
- `STOREFRONT_CURATOR_MCP_ALLOWED_HOSTS`: comma-separated Admin and Auth hosts.
  Production requires HTTPS and both hosts in this allowlist.
- `STOREFRONT_CURATOR_MODEL`: defaults to `openai/gpt-5.4-mini`. Provision the
  credential for the selected provider; the default route requires
  `OPENAI_API_KEY`.
- `STOREFRONT_CURATOR_RECENT_LIMIT`: 1 through 25; defaults to 12.

For a one-off local run, `STOREFRONT_CURATOR_MCP_ACCESS_TOKEN` may hold a
short-lived access token. Scheduled operation should use the public Admin MCP
client's `offline_access` tuple:

- `STOREFRONT_CURATOR_MCP_AUTH_ISSUER_URL`
- `STOREFRONT_CURATOR_MCP_CLIENT_ID`
- `STOREFRONT_CURATOR_MCP_REFRESH_TOKEN`

Request exactly this grant:

```text
offline_access
experience:read
video:read
media:read
experience:locale:validate
storefront:homepage:stage
```

Do not request or grant `experience:publish`. The seeded Admin MCP clients have
broad default scopes, including publish, so requested-scope configuration alone
is not sufficient evidence. Before activation, the operator must inspect the
actual issued access token or authorization grant and record that its effective
scope contains the six entries above and excludes `experience:publish`. Stop
rollout if the provider broadens the grant.

Tokens, bearer values, refresh tokens, and OAuth error bodies must never be
logged. Auth may rotate a refresh token, while this client keeps the replacement
only in process memory and deliberately never retries a refresh request whose
response was lost. A timeout or network failure after refresh dispatch therefore
makes credential state unknown: stop the schedule and reauthorize before another
run.

This PR does not add a durable secret-write path. Keep scheduled execution off
until a preview credential passes a controlled rotation-and-restart test, or an
approved encrypted rotation handoff outside this process is documented and
operational. The test must prove that a fresh Mastra process can obtain a valid
Admin access token after at least one refresh rotation without logging or
exporting token values. If the bootstrap environment refresh token is revoked by
rotation, the in-memory client is not restart-safe and cannot be used for the
weekly schedule. A static access token remains a manual/local-run option only.

## Run report semantics

Use `writeOutcome` and `draftStaged` to decide whether Admin changed. Do not use
the legacy `changed` field by itself.

- `candidateDiffers`: deterministic candidate bytes differ from canonical
  bytes. It can be true even when validation, media checks, or staging fail.
- `draftStaged`: true only when Admin staging is confirmed by matching
  `operationId` and `candidateDigest` attribution.
- `writeOutcome: no_change`: the model chose no change or the candidate digest
  equals canonical content.
- `writeOutcome: no_write`: no confirmed write. This includes a successful dry
  run; `candidateDiffers` and legacy `changed` may still be true.
- `writeOutcome: staged`: the attributed draft is confirmed. `previewUrl` may
  still be null; inspect the active draft in Admin instead of restaging.
- `writeOutcome: stage_outcome_unknown`: the stage response was ambiguous and
  the immediate read-back could not prove the exact operation/digest. A write
  may have happened. Never automatically retry it.
- `changed`: compatibility field. It is true for a successful differing dry-run
  candidate and for a confirmed staged draft, so it is not a write receipt.

For scheduled runs, use the bounded run list to discover the newest `runId`,
then fetch that run before recording its disposition. For a manual run whose
HTTP response was lost, inspect recent runs instead of submitting another POST.

## English editorial pilot and weekly activation

The provisional owner is the **Watch Editorial on-call**, with decisions
recorded in **`#watch-editorial`**. Confirm both the role assignment and channel
identifier before activation; do not enable the schedule while ownership is
unconfirmed.

1. Deploy Admin before Mastra. Leave mode `off`, locale allowlist `en`, and the
   schedule flag `false`. Confirm Admin advertises the two storefront tools.
2. Provision the dedicated route bearer, host allowlist, model credential, and
   OAuth tuple. Verify bearer-pool disjointness and the actual issued OAuth
   scope, including the absence of `experience:publish`. Complete the controlled
   rotation-and-restart credential gate above; stop rollout if the fresh process
   cannot authenticate without manual token extraction.
3. Set mode `dry_run` and keep the schedule flag false. The owner invokes the
   protected route with `{ "locale": "en", "dryRun": true }`.
4. Require at least **three consecutive owner-approved English dry runs**. Each
   must return a valid candidate with no unknown IDs, unavailable media, locale
   issue, or ambiguous outcome. The owner reviews seasonality, homepage copy,
   collection quality, translation claims, and preservation of human sections.
   Reset the consecutive count after any rejected candidate or guard failure.
5. Change mode to `stage` only after the dry-run acceptance gate. Run once
   manually, review the Admin preview or active draft, and let a human choose
   publish, discard, or leave unchanged through the ordinary Admin flow.
6. After the staged English run is approved, set
   `STOREFRONT_CURATOR_SCHEDULE_ENABLED=true` for the weekly Monday trigger.
   This also requires the credential rotation-and-restart gate to be green.
   Discover and inspect every run through the protected run routes, then record
   the decision in `#watch-editorial`; the schedule is not unattended
   publication.

A real local/connected stage smoke is an operational rollout gate and is not
performed by this PR's unit-test validation.

## Disposition before the next run

- `active_draft`: the Watch Editorial on-call inspects the current Admin draft,
  records whether it belongs to a human or a prior curator run, and explicitly
  publishes, discards, or defers it. Do not run the curator again until that
  disposition is recorded and the active-draft conflict is resolved.
- `stage_outcome_unknown`: stop the schedule. In Admin, find any active draft
  and compare its stored curator `operationId` and `candidateDigest` with the
  run report. An exact match is the staged result and must go through normal
  editorial review. A mismatch is a separate draft and must be dispositioned as
  such. Retry only after an operator has verified that no matching draft exists
  and has recorded the resolution in `#watch-editorial`.
- `concurrent_change`: review the newer canonical/draft state, then begin a new
  operation from fresh evidence. Never reuse the old operation ID.

## Other expected non-success results

- `off`: mode gate closed; no MCP or model call occurred.
- `locale_disabled`: requested locale is outside the explicit rollout CSV.
- `model_api_key_missing`: provider readiness failed before any Admin call.
- `homepage_missing` / `homepage_ambiguous`: repair Admin homepage designation.
- `invalid_proposal`: model used an unknown/duplicate identifier or violated
  the bounded section contract. Do not bypass the guard.
- `validation_failed`: Admin rejected the final block payload.
- `media_unavailable`: at least one selected leaf video was not playable in its
  intended language.
- `admin_unavailable` / `agent_unavailable`: restore the dependency. Treat an
  Admin failure during stage according to its `writeOutcome`, not this label
  alone.

## Rollback

Set `STOREFRONT_CURATOR_SCHEDULE_ENABLED=false` and restart Mastra to remove the
timer, then set `STOREFRONT_CURATOR_MODE=off`. If a curator draft exists, review
and publish/discard it manually in Admin. Do not add automatic discard or
publication to the workflow.

## Multilingual expansion

Keep the schedule English-only until the editorial pilot is stable. Add one
locale at a time to `STOREFRONT_CURATOR_ENABLED_LOCALES`, repeating the same
three accepted dry runs and one reviewed staged run before any cadence change.
Start with `ru`, `es`, and `fr`, then expand only to Admin-supported locale
codes. Do not fork one agent per language. Language spotlights may feature a
different catalog language, but every leaf item must carry the exact evidenced
language ID and pass the same deterministic checks.
