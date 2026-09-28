# Active hero authority and policy isolation

Parent acceptance at deployed `811f1ec81` observed the home hero remaining v1
while authored placements issued v2, including paced navigation with no missing
admission. Source inspection explains the overflow fallback: parent source IDs
are capped, but child lists/pools are not; the initial queue of seven is not a
catalog bound. No production candidate count was queried in this follow-up.

The compact catalog signs all eligible intro and playable pooled paths, then
selects only the active CTA at slot zero. `sourceVersion` identifies the ordered
deduplicated catalog. Existing HMAC verification binds the selected path/slot,
complete configuration, policy, digest and expiry. Admin replay binding includes
all those values independently: exact retry replays; changed path/catalog/expiry
under the same nonce conflicts; a fresh attempt creates its own window. The
strict 100-item issuer schema, clock/TTL/admission, caching and identity semantics
are unchanged. Empty/unknown active authority does not issue an empty delivery.

Local PostgreSQL policy proof uses private fixtures only. A 140-group mixed
chapters placement truncates; each v1/v2 policy selection returns 70 complete
positions, with eligibility isolated by policy. The 128+1 sentinel and original
3-second SQL/4-second transaction budgets remain. `exposurePolicy` requires an
exact registered `exposure` identity; placement is optional. Arrays, unknown
policies and incompatible signed identities withhold both exposure readers.
Overview and replay counts retain their selected time window.

## Browser and payload proof

Run `node apps/web/scripts/verify-watch-hero-authority-browser.mjs`; optional
`WATCH_HERO_FIXTURE_OUTPUT` selects the sanitized JSON artifact. The fixed
baseline is `811f1ec81f359d1cf66cdda5bad8f5445631c44c`. The control is a hybrid: only carousel/controller TSX are taken from that commit;
remaining imports/adapters are current. Both modes build their actual carousel/controller, use the same synthetic 1,000-card model and adapters,
and run six alternating cold Chromium 149 contexts at 1280×800. Default headless
launch has no browser-feature overrides. A shared 400 ms image load gate checks
issuance after load. Enabled mode includes the compact authority payload; the
baseline has the same model and no authority because its >100 source overflows.

Two independent runs:

| Metric                         | Baseline A | Enabled A | Baseline B | Enabled B |
| ------------------------------ | ---------: | --------: | ---------: | --------: |
| DCL median ms                  |      66.95 |     67.00 |      62.60 |     64.90 |
| Load median ms                 |     422.25 |    422.60 |     420.60 |    422.05 |
| FCP median ms                  |        156 |       162 |        150 |       154 |
| Render-to-two-frames median ms |      74.30 |     77.90 |      71.30 |     73.20 |
| Resource count                 |          4 |         5 |          4 |         5 |

Raw script bytes are 829,158 baseline / 831,652 enabled (+2,494). The isolated
selector dependency closure is 1,707 unminified bytes and four inputs: base path,
public URL constants, canonical path normalization and selector. Schema, signer,
compiler, route initialization, environment and locale modules are absent.
An initial import added 600,395 bytes and was corrected before handoff.

The synthetic model JSON is 242,733 bytes; added catalog JSON is 76,161 bytes
(versus 383,891 for repeated full singleton envelopes). A selected envelope is
383 bytes; the activation body including retry nonce is 447 bytes, independent
of catalog cardinality. Signing observations were 20.40/18.88 ms. These are
synthetic raw UTF-8 JSON/bundle measurements, not real production pool counts or
compressed RSC bytes. Signing/serialization remain linear in catalog size and
each authored placement has its own authority.

Both runs pass exact-known-path singleton verification, slot zero, >100 catalog,
active target changes, focused native button node retention, issuance only after
load and zero browser errors. Unit/integration coverage additionally exercises
duplicates, query-only changes, catalog change with retained path, intro/pool
parity, no empty served issuance, stale receipts and immediate updated-href
selection. Page tests invoke the actual source adapter and signer for fallback,
leading and mid-page authored hero transport.

Scope: real component/controller/signature verifier with mocked delivery receipts,
Next link/image/i18n adapters and hidden stub media. No production CSS/Tailwind,
Next RSC/ISR hydration, navigation, DB persistence or decoded-video startup is
claimed. The shared load gate can mask load overhead; DCL/FCP/mount/script bytes
provide comparative local evidence. Every median requires six finite samples; FCP coverage is explicitly 6/6 in
both modes/runs. The fixture rejects unknown routes/methods, malformed JSON and
oversized bodies, bounds request/body/header time to two seconds and body size to
64 KiB, and contains handler failures. All action/navigation/launch waits are
finite; routing compares parsed origins exactly. A forced browser-launch failure
exits in 1.22 seconds with zero new owned scratch directories remaining. Cleanup
independently closes browser/server and removes owned build scratch, including
setup failures. Exact active CTA and its observed v2 selected fact are asserted.
Parent owns full-page/deployed acceptance.

Local checks: 326 focused Web tests plus 64 route tests, 38 Admin service/page
unit tests and eight local PostgreSQL tests pass. Full Web lint/typecheck and
focused Admin lint/typecheck pass. Worker results received independent read-only
review; parent also reviewed signing, policy isolation and controller lifecycle.

## Release boundary

Keep feat-373 in progress. The user explicitly leaves fallback home carousel,
fallback home grid and video editorial coverage unresolved in this batch; preserve
their registry/product behavior. Parent-owned visibility/performance gaps and
actual authorized Admin reconciliation remain required acceptance facts. This
follow-up uses normal PR hooks and exact-head CI; parent owns merge and normal
deployment. No production queries, hidden-pool inspection, auth/scope changes,
migrations or deployment shortcuts were used.
