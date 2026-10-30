---
title: "Intl.DisplayNames names alias and group region codes, so a country label can make a wrong code look valid"
date: 2026-10-07
category: logic-errors
module: apps/admin push campaigns
problem_type: logic_error
component: service_layer
related_components:
  - frontend
symptoms:
  - "A campaign country typed as UK showed as 'United Kingdom (UK)' but matched no phone, because phones store GB"
  - "Intl.DisplayNames also named DD, SU, EU, UN, and ZZ, so the label hid the wrong code"
  - "In a campaign with several countries the audience count stayed above zero, so nothing warned the editor"
root_cause: missing_validation
resolution_type: code_fix
severity: medium
framework_version: "node 24.14.1 (ICU 78.2, CLDR 48.0)"
tags:
  [
    intl,
    displaynames,
    country-codes,
    iso-3166,
    cldr,
    validation,
    push-campaigns,
  ]
---

# Intl.DisplayNames names alias and group region codes, so a country label can make a wrong code look valid

## Problem

The push campaign editor began to show a country name next to each targeted code, such as "Mexico (MX)" (PR #2603, open as of this writing). `Intl.DisplayNames` also gives a name to codes that no phone reports: aliases such as `UK` and group codes such as `EU`. The new label made a wrong code look like a valid target.

## Symptoms

- An editor typed `UK`. The chip, the audience summary, and the send-now confirmation all said "United Kingdom (UK)".
- Phones store `GB` for the United Kingdom, so the campaign reached no phone there. Registrations take the country from the edge header `cf-ipcountry` or from the phone locale's region subtag (`apps/admin/src/services/push/country.ts:11`, `:33`).
- The audience filter compares codes exactly (`apps/admin/src/services/push/audience.service.ts:91-92`). In a campaign that also named other countries, the audience count stayed above zero, so nothing warned the editor.
- Before the labels, the bare code `UK` at least looked unusual. The label removed that signal.

## What Didn't Work

- **`fallback: "none"` alone.** It makes `of()` return `undefined` only for codes that CLDR does not know, such as `QQ`. It still names aliases and group codes.
- **Checking that the name differs from the code.** This catches only codes without data. `UK` has data, so it passed.
- **The first label version.** It shipped with only the two checks above. In the first review round, the correctness and adversarial reviewers both found the `UK` case, and the validator confirmed it with a probe:

| Code | `Intl.Locale("und-" + code).region` | `DisplayNames.of(code)` |
| ---- | ----------------------------------- | ----------------------- |
| `UK` | `GB`                                | United Kingdom          |
| `DD` | `DE`                                | Germany                 |
| `SU` | `RU`                                | Russia                  |
| `EU` | `EU`                                | European Union          |
| `UN` | `UN`                                | United Nations          |
| `ZZ` | `ZZ`                                | Unknown Region          |
| `XK` | `XK`                                | Kosovo                  |
| `QQ` | `QQ`                                | `undefined`             |

The probe ran on Node 24.14.1 with ICU 78.2 and CLDR 48.0.

## Solution

`apps/admin/src/services/push/country-code.ts` classifies each code. It uses two `Intl` facts:

- **Canonical form.** `Intl.Locale` canonicalizes a region subtag with the CLDR alias data. A real ISO code is its own canonical form, and an alias is not (`UK` becomes `GB`).
- **A deny set.** Group codes and ISO user-assigned codes stay unchanged under canonicalization, so a small pattern refuses them (`country-code.ts:13`). `XK` (Kosovo) is user-assigned, but it stays valid because Cloudflare reports it.

```ts
const NOT_A_COUNTRY = /^(?:AA|Q[M-Z]|X[A-JL-Z]|ZZ|EU|EZ|UN)$/

export function checkPushCountryCode(code: string): PushCountryCheck {
  if (!/^[A-Z]{2}$/.test(code)) return { kind: "unknown" }
  const canonical = canonicalRegion(code) // new Intl.Locale(`und-${code}`).region
  if (canonical && canonical !== code) {
    const name = regionName(canonical)
    return name && !NOT_A_COUNTRY.test(canonical)
      ? { kind: "alias", canonical, name } // "Use GB for United Kingdom"
      : { kind: "unknown" }
  }
  if (NOT_A_COUNTRY.test(code)) return { kind: "unknown" }
  const name = regionName(code)
  return name ? { kind: "country", name } : { kind: "unknown" }
}
```

Three places use it:

- **The label.** `formatPushCountry` shows a name only for `kind: "country"`, and it shows the bare code otherwise.
- **The editor.** `normalizePushCountryInput` refuses an alias with "UK is not an ISO country code. Use GB for United Kingdom."
- **The shared schema.** `PushCountryCodeSchema` (`apps/admin/src/services/push/contracts.ts`) refuses the same codes. The dashboard save and the admin MCP tools both parse with it, so an agent gets the same refusal.

## Why This Works

- **The canonical test separates real codes from aliases.** The ISO 3166-1 list contains no deprecated alias, and CLDR maps each deprecated code to its successor.
- **The deny set covers what canonicalization cannot see.** Group codes and user-assigned codes are their own canonical form, so only an explicit list refuses them.
- **The label and the validation agree.** The label uses the same classifier, so the page never names a code that the schema refuses.
- **A pin outside ICU catches ICU drift.** `country-code.test.ts` copies all 249 codes from tzdata's `iso3166.tab`, a source independent of ICU, and asserts each one is a country. A wider deny pattern, or a Node upgrade whose ICU drops a name, fails that test in CI.

## Prevention

- A human-readable label is not validation. Before you add a name to a code, check whether the name can make an invalid code look valid.
- Validate region codes with two checks: the canonical form equals the code, and the code is not a group or user-assigned code. Do this on every write path.
- Keep the label and the validation on one classifier.
- Pin the accepted set against a list that is independent of ICU. Include the special cases that the product depends on, such as `XK`.
- The names come from the runtime's ICU data. A browser with older CLDR data can name a region differently from the server. A client component that renders the name on the server and in the browser can then log a hydration text mismatch.
- Another region-name call exists in `apps/web/src/lib/search-language-actions.ts` (`countryNameFromCode`). Its input comes from `x-vercel-ip-country`, `cf-ipcountry`, or `x-country-code` (`readCountryCode`), and a client can set the last one. So it can receive an alias or a group code, and it names it. It only labels a search hint, so the impact is low, but the trap is the same.

## Related Issues

- PR #2603: the push campaign delete and country names.
- `docs/solutions/architecture-patterns/agent-and-person-share-one-versioned-write-path.md`: the shared write path that carries this check to the MCP tools.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`: why the pin uses a real external list.
- `apps/admin/CLAUDE.md`, section "Campaign countries": the operator-facing rule and the pre-deploy query.
