---
title: "Admit New Watch Audio Languages from the Runtime Manifest"
date: "2026-07-30"
last_updated: "2026-07-30"
category: "ui-bugs"
module: "apps/web watch routing and language search"
problem_type: "stale_generated_data"
component: "frontend_routing"
symptoms:
  - "A newly playable language appears in Core and Forge Admin but its Watch URL returns 404"
  - "The website language picker omits a language that the mobile app can play"
  - "Forge Admin's route snapshot resolves the requested dub while Web rejects the public URL"
root_cause: "The Web proxy and language catalog treated a generated BCP-47-era slug corpus as runtime route admission authority"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "route_manifest"
  - "search_language_catalog"
  - "language_inventory"
tags:
  - "watch-route"
  - "audio-language"
  - "route-manifest"
  - "bcp47"
  - "jiamao"
  - "static-corpus"
---

# Admit New Watch Audio Languages from the Runtime Manifest

## Problem

`/watch/jesus.html/jiamao.html` returned 404 even though Core and Forge Admin
both exposed a published Jiamao dub with a playable HLS URL. Forge Admin's
public route snapshot selected that exact dub, but Web omitted Jiamao from its
language options and rejected the URL before page resolution.

## Root Cause

Three different contracts had been collapsed into
`isPublicWatchLanguageSlug()`:

1. safe public slug syntax;
2. the generated static corpus used for one-segment language-home/content
   collision decisions;
3. current playable route admission from Admin's Watch route manifest.

The static corpus was derived from an older `Language.bcp47` snapshot. Jiamao
was synced into Admin later with `slug=jiamao` and a playable dub but
`bcp47=null`, so it never entered that code-generated corpus. The proxy rejected
the two-segment route before consulting the manifest, and search projection
discarded the same slug.

## Solution

Keep the static corpus for the contract it can safely answer: one-segment
language-home collisions and language-less English canonical URLs.

For two- and three-segment content routes:

- validate the audio segment's safe slug shape;
- require the existing exact content/audio or episode/audio manifest match;
- let the catch-all render the already proxy-admitted slug with English chrome
  fallback when no generated UI locale mapping exists.

For Admin-sourced language options:

- retain safe English-name slugs that are absent from the static corpus;
- continue rejecting raw BCP-47 catalog keys as public URL identities;
- seed search route language only when it is either in the static corpus or in
  the loaded Admin language options.

For a newly discovered one-segment language selection, proxy admission checks
`manifest.audioLanguageSlugs` and redirects to
`/{language}.html/videos`. This gives the user an honest, admitted inventory
surface without making the catch-all guess whether an unknown one-segment slug
is a language home.

## Invariants

- The route manifest remains the runtime authority for playable
  content/language pairs.
- Safe syntax alone never admits an unknown public route.
- BCP-47 values remain metadata and locale-negotiation inputs, not public Watch
  audio route identities.
- No request-time GraphQL lookup was added to the static page renderer.
- New playable languages no longer require hand-editing the generated slug
  corpus before their explicit video and episode URLs can work.

## Verification

- Jiamao-shaped regression tests cover proxy admission, catch-all rendering,
  Admin language projection, global language switching, and inventory routing.
- Full Web suite: 155 files passed, 2,486 tests passed, 2 todo.
- Web typecheck passed.
- Web lint passed.
