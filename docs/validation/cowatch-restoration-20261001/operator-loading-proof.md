# Operator loading proof — 2026-10-01

The new controls are added only to the existing Admin owner-release panel. They
start with no request, interval, effect, or background polling. Inspection begins
on an explicit button press. The Watch client and its initial requests are unchanged.

A local browser harness compiled the actual baseline and modified
`OwnerReleaseControls.tsx` with production React and esbuild minification. Fixture
responses were clearly labeled; no production mutation was made. The baseline is
from `8890beaf1bb61932d4fbd4195a12cee59c0134d8`.

| Measurement                                           |           Baseline |          Modified |
| ----------------------------------------------------- | -----------------: | ----------------: |
| Bundle bytes (including React)                        |            200,921 |           208,238 |
| gzip bytes                                            |             62,983 |            64,803 |
| Initial requests (each sample)                        |                  0 |                 0 |
| Three alternating navigation-to-two-frame samples, ms | 122.6, 88.1, 110.3 | 104.7, 69.2, 75.1 |

The added compressed JavaScript is 1,820 bytes. These small local samples detect
an obvious component loading regression; they are not production Web Vitals or a
statistical speedup claim. The preview verified the revoked graph deadline, last
success, refusal reason, next eligible attempt and independent stop action without
layout overlap. The seven component tests include StrictMode, no initial fetch,
review/cancel, duplicate submission, delayed commit visibility, exact original
request retry, malformed responses and stop reconciliation. API and existing
owner-control tests bring this run to 26 passing tests.

Harness: `/tmp/cowatch-ui-proof/build.cjs`, loopback port 4317, in-app browser.
The eventual production deployment and serving evidence are recorded separately.
