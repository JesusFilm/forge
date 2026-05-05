---
title: "Admin AI Experience preview: match VideoDub language before using stream URLs"
category: integration-issues
module: apps/admin + apps/web
date: 2026-05-01
problem_type: integration_issue
component: service_object
symptoms:
  - "/watch/<slug>/en showed English generated copy but video playback used non-English audio"
  - "Generated blocks could persist streamingUrl from the first available dub rather than the requested locale"
  - "Preview hydration could fall back to a non-English dub when a generated block only stored videoId"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - admin-experience-ai
  - preview
  - video-dubs
  - locale
  - graphql
  - vector-search
  - watch-page
  - generated-content
affected_components:
  - apps/admin/src/services/experience-ai/experience-ai.service.ts
  - apps/admin/src/services/experience-ai/experience-ai.service.test.ts
  - apps/web/src/lib/admin-content.ts
  - apps/web/src/lib/admin-content.test.ts
  - apps/admin/src/graphql/types/experience.ts
  - apps/web/src/lib/content.ts
related_docs:
  - docs/solutions/cms/admin-app-data-model-decisions.md
  - docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md
  - docs/roadmap/platform/feat-107-admin-ai-experience-drafting.md
---

# Admin AI Experience preview: match VideoDub language before using stream URLs

## Problem

Admin AI Experience generation for `locale=en` could create a page whose text
was English while its video playback used a different audio language. The page
looked like an English Experience, but the generated `streamingUrl` or preview
fallback pointed at whichever `VideoDub` happened to sort first.

This is a different class of bug from bad AI copy. The text source is
`VideoLocale`; playback audio is `VideoDub.language`. Both must match the
requested Experience locale before the generated page is considered locale
correct.

## Symptoms

- A freshly generated page such as `/watch/vector-retest-1777607482347-9/en`
  rendered English headings, collection titles, and question text.
- The hero block persisted a `streamingUrl` for `what-is-christianity` whose
  `VideoDub.language.bcp47` was `hr`, while the English dub existed later in
  the same catalog list.
- Other referenced videos had the same shape: English `VideoLocale` rows but
  first dubs in languages such as `ru` or `th`.
- Preview correctly preserved generated block data, so old records with a
  wrong stored `streamingUrl` kept playing the wrong audio.

## What Didn't Work

- Prompting the model to write all generated copy in English only fixed page
  text. It did not affect which HLS URL was chosen for playback.
- Filtering candidate titles/descriptions to `videoLocale.locale === "en"`
  prevented cross-language copy fallback, but still allowed `previewStreamUrl`
  to come from the first dub.
- Preview-side overwriting of generated fields is the wrong fix. Preview must
  render real Experience JSON, using catalog data only to hydrate missing
  fields. Existing wrong generated records should be regenerated and
  re-published, not silently corrected at render time.
- Prior session history showed that Admin preview already needed an Admin
  content source and block-shape adapter; relying on the Strapi watch path did
  not make Admin-published Experiences visible on web. (session history)

## Solution

The fix is to make stream selection locale-aware in both places where a stream
URL can enter preview output.

### Generation candidate loading

`apps/admin/src/services/experience-ai/experience-ai.service.ts` now fetches
language metadata for candidate dubs:

```ts
language: {
  select: {
    bcp47: true,
    iso3: true,
    slug: true,
  },
},
```

Candidate assembly only assigns `previewStreamUrl` from a dub matching the
requested locale:

```ts
const preferredDub =
  dubsByVideo
    .get(video.id)
    ?.find(
      (row) =>
        (row.hls || row.dash || row.share) &&
        (row.language?.bcp47 === locale ||
          row.language?.iso3 === locale ||
          row.language?.slug === locale),
    ) ?? null
```

If a catalog video has English copy but no English dub, the candidate can still
exist, but `previewStreamUrl` is `null`. That is safer than generating an
English page with non-English audio.

### Preview fallback hydration

`apps/web/src/lib/admin-content.ts` now requests `language { bcp47 iso3 slug }`
for Admin `referencedVideos.dubs`, carries the `ExperienceLocale.locale` through
normalization, and only hydrates fallback streams from matching dubs:

```ts
function videoStream(video: AdminReferencedVideo | undefined, locale: string) {
  return (
    video?.dubs?.find(
      (dub) =>
        dub?.published === true && dub.hls && dubMatchesLocale(dub, locale),
    )?.hls ??
    video?.dubs?.find((dub) => dub?.hls && dubMatchesLocale(dub, locale))
      ?.hls ??
    null
  )
}
```

The adapter still preserves generated block data first:

```ts
streamingUrl: block.streamingUrl ?? videoStream(heroVideo, locale)
```

That keeps preview honest. It prevents fallback from introducing the wrong
audio when `streamingUrl` is missing, while leaving already persisted generated
data visible as-is.

## Why This Works

The data model separates viewer-facing metadata from playback audio:

- `VideoLocale` is the localized title, description, and snippet for an
  audience.
- `VideoDub` is the audio-language-specific playable media.

The bug came from treating those as interchangeable. Vector search and locale
copy filtering could find English candidate text, but a language-agnostic dub
lookup could still pick Croatian, Russian, Thai, or any other stream based on
row ordering.

Matching `VideoDub.language` at generation time prevents new Experiences from
persisting bad stream URLs. Matching it again in preview fallback prevents the
renderer from inventing a wrong-language stream when a block only contains a
`videoId`.

## Prevention

- Test candidate loading with a newer non-English dub before an older English
  dub; `previewStreamUrl` must pick the English HLS.
- Test candidate loading with only another locale's `VideoLocale`; the video
  should not become an English candidate.
- Test preview hydration with a Spanish dub before an English dub; fallback
  should use English for an English Experience.
- Test preview hydration with only a Spanish dub; fallback should return
  `streamingUrl: null` for an English Experience.
- Treat "catalog-backed video" as necessary but insufficient. Any persisted or
  hydrated playback URL must also be selected from a `VideoDub` whose language
  matches the Experience locale.
- Do not fix old generated pages by overriding preview output. Regenerate and
  re-publish those Experiences so the stored block JSON is correct.

## Related Issues

- [Admin App Data Model Decisions](../cms/admin-app-data-model-decisions.md) —
  defines `VideoDub` as the audio-language grain and `VideoLocale` as
  audience-facing metadata.
- [Prototype defaults vs data-derived enumeration](../best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md)
  — same failure class: silent language defaults create data that looks valid
  but lies about the underlying language.
- [Admin AI Experience Drafting](../../roadmap/platform/feat-107-admin-ai-experience-drafting.md)
  — feature scope for prompt-first Admin-native Experience generation.
