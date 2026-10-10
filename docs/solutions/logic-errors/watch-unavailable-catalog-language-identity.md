---
title: "Preserve catalog language identity when ICU aliases a regional selection"
date: "2026-10-10"
module: "apps/web watch; apps/admin video snapshot"
problem_type: "logic_error"
tags:
  - "watch"
  - "language"
  - "graphql"
  - "schema-lag"
---

The French-African unavailable page selected the correct public slug but named it
plain French. `Intl.DisplayNames` canonicalizes its provider tag `fra` to `fr`,
losing the published `French, African` qualifier. A selected fallback dub's language
cannot supply the requested language identity either.

`WatchRouteSnapshot.requestedLanguage` now resolves the exact active language slug
in the existing preferred-variant SQL statement. Its unique-index join adds no
request or statement. Web accepts metadata only for the exact requested public
slug. The opt-in `catalog-identity` display usage preserves provider English wording
when its words carry qualifiers absent from ICU's English name. Other display
usages retain existing localization. Recovery keeps `nativeName: null`: an arbitrary
non-English JSON entry is not evidence of an approved native name, and unsupported
UI locales must retain their previous provider-English fallback.

Admin and Web deploy independently. An additive selection can therefore invalidate
all video snapshot queries temporarily. Derive a legacy document with `graphql.visit`,
retry only the exact unknown-field validation error, and cool down probes for 60
seconds. Mixed/server errors must remain errors. Tests cover both rejected Apollo
errors and returned error arrays, plus resumed probing after cooldown.

Validate a catalog claim independently from this UI issue. An unavailable dub is
not proof of an incorrect catalog; creating dubs or changing publication needs an
owner-approved content expectation. The FGE-284 audit found working Burmese LUMO
and French-African Bartimaeus subtitle examples, disproving the blanket gaps.
