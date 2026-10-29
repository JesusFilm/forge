# Admin-backed automation integration

Candidate: foundation `0f105217b`, UI `c1f3fa60a`, with the run-creation wire
contract repair recorded in this change. Node 24.22.1; task-owned PostgreSQL 18
on loopback 55890; Manager Next development server on 4891; Admin's real Pothos
schema/services over a local Yoga HTTP fixture on 4890. Authentication used a
synthetic signed local operator session and deterministic session-validation
fixture. GraphQL still enforced its Manager service principal and service ABAC.
This does not test Auth SSO, production ingress, or a production deploy.

T3 collaborative preview, isolated incognito session:

1. Created source-subtitle automation, dry run, weekly Monday 9am, cap six.
2. Review launch sent zero POSTs and focused the review heading. Final Create
   sent exactly one POST, returned JSON 201, closed the dialog and restored
   focus to New automation.
3. Reloaded the page and saw the same Admin-stored definition and next cadence.
4. First manual report exposed a real wire-contract failure: Manager forwarded
   `startedAt` into Admin's strict input. The adapter now selects exactly the
   admitted input fields; Admin owns timestamps. A regression asserts the wire.
5. Retried: JSON 200, success report, one eligible/would-enqueue candidate and
   zero jobs. Report persisted in Admin and survived refresh.
6. Paused, verified Resume appeared, resumed, verified Pause and next cadence.
7. Advanced only this disposable definition's due time and called the actual
   `runManagerAutomationTick`. It dispatched through Manager HTTP, which called
   Admin GraphQL for canonical reads and one-time admission. Admin settlement
   persisted success, advanced next cadence, and left the job table empty.
   [Raw durable result](./scheduled-cycle.json) records both scheduled and manual
   runs. No source, translation, embedding or Mux provider call occurred.

One warm navigation measured FCP 84ms, load 90.7ms and request-to-first-byte
51.1ms, with 35 resource entries. This is a development integration observation,
not a production regression benchmark. PR916's adjacent five-load comparison
is recorded separately. No frontend eager initialization was added by the
persistence adapter migration.

Screenshot:
`/home/lado/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvslng4j-c1b59bcd.png`.
The initial preview failures were a local auth redirect to the default port;
using the correct origin and isolated session resolved them. `127.0.0.1` dev
resources also require Next's development-origin allowlist; the successful
interactive run used `localhost`. No production configuration changed.
