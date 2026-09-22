---
title: Smoke a mobile write path on the simulator through a throwaway fake-admin proxy
date: 2026-09-17
last_updated: 2026-09-22
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: development_workflow
severity: medium
root_cause: incomplete_setup
resolution_type: tooling_addition
applies_when:
  - "Verifying an apps/mobile (or apps/tv) write path against Admin GraphQL on a simulator when no development endpoint accepts the feature's bearer"
  - "A local admin answers every bearer-gated mutation UNAUTHENTICATED because its keyring lacks the production fleet key"
  - "Production must not receive test writes (anonymous viewer identities, playback episodes, evidence receipts)"
  - "Verifying a retry or rate-limit ladder (HTTP 200 with extensions.http.statusCode 429 and Retry-After) on the real Hermes runtime rather than under jest fake timers"
  - "Choosing a port for a throwaway local proxy on a machine that also runs a real local admin dev server on :3003"
symptoms:
  - "Local admin answers every recommendation mutation with UNAUTHENTICATED because the production fleet bearer is not in its keyring"
  - "A `Web consumer authentication required` RUM error beside an EMPTY proxy log: the simulator resolves localhost to ::1 and reaches the real local admin on *:3003 while the proxy on 127.0.0.1:3003 sits idle"
  - "After a proxy restart every request logs identityOk false because the device keeps its older stored identity (expected, not a fault)"
  - "Every playback episode ended 19 ms after it began because the adapter's abandoned session reason was mapped to a route exit; no jest suite showed it"
  - "Two IssueWatchPlaybackContext issuances 360 ms apart for one Home-tile open, the first shipping a stub episode (resolved 2026-09-22 by PR #2376; see the session-identity learning under logic-errors)"
related_components:
  - apps/admin
  - apps/tv
  - testing_framework
  - authentication
tags:
  - expo-dev-client
  - simulator
  - smoke-testing
  - local-dev
  - verification
  - fault-injection
  - recommendations
  - feat-516
---

# Smoke a mobile write path on the simulator through a throwaway fake-admin proxy

## Context

`feat-516` added the mobile recommendations API client and playback
attribution (PR #2329, open and unmerged as of 2026-09-17). Its write path
sends four mutations per playback: bootstrap a viewer, issue a playback
context, claim an episode, then record playback facts in batches. Admin
requires the fleet bearer on every one of those operations
(`carriesFleetBearer`, `apps/mobile/src/lib/authHeaders.ts:25-30`). A caller
without it gets `UNAUTHENTICATED`, not a coarser rate-limit bucket.

There was no endpoint to verify that path against. A local admin's keyring
does not carry the production fleet key. A development bundle against local
admin therefore fails the bootstrap with `UNAUTHENTICATED` on the first
request and then enters a cooldown (`apps/mobile/CLAUDE.md:605-609`). A
development build refuses to start against production admin unless an
operator opts in (`decideAdminEndpointAccess`,
`apps/mobile/src/lib/adminEndpoint.ts:98-126`). Production must never receive
anonymous test identities, playback episodes or evidence. The consumer handoff
established no enabled development endpoint (`apps/mobile/CLAUDE.md:674-681`).

Jest could not close the gap. The recorder and the hook have full suites, but
a mocked adapter emits the events the test author wrote, on the timers the
test author chose. The device runs Hermes, expo-video, SecureStore and the
Apollo link chain together. The write path's decisions depend on their real
order and timing. Mocked tests prove branch shape; only the real runtime
proves the production contract
(`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`).

The first attempt at a harness also hit a port trap. On this machine a real
local admin dev server owned `*:3003` over IPv6, and the simulator resolved
`localhost` to `::1` (observed 2026-09-16; an environment fact, not a code
fact). A proxy bound to `127.0.0.1:3003` coexisted with it silently, so the
app talked to the real admin while the proxy log stayed empty. Per this session's
conclusion, the tell was a `Web consumer authentication required` RUM error
beside an empty proxy log (auto memory [claude]).

## Guidance

Run a throwaway local Node HTTP server, the fake-admin proxy, in front of the
app. It does four things, and every one of them is load-bearing:

1. It answers the operations under test locally with contract-shaped data. It
   mints the viewer and session tokens, the claim nonce and the episode id. It
   validates each facts batch against the strict schemas admin enforces
   (`apps/admin/src/services/recommendations/contracts.ts:363-535`, including
   the 60 000 ms active-chunk cap at line 435).
2. It logs every request as one JSON line, including the requests it only
   forwards. A silent forward hides a misroute.
3. It refuses every other mutation with a `BLOCKED` error. Nothing that is not
   under test can reach production.
4. It forwards every other query to production admin without the
   `Authorization` header, so Home and the watch page load real content.

An optional fifth behaviour injects one fault through an environment variable,
so a retry ladder runs on the real runtime.

### The proxy

The script below is the essential shape of the harness used for `feat-516`.
The session's copy lives in an ephemeral scratchpad, so this doc is its
durable home. Save it as `fake-admin-proxy.mjs` anywhere outside the repo.

```js
// Throwaway smoke harness. Never a CI test double: it mocks Admin, so it
// proves the CLIENT side of the contract only.
import http from "node:http"
import { randomBytes } from "node:crypto"
import { appendFileSync } from "node:fs"

const PORT = Number(process.env.SMOKE_PORT ?? 3010)
const LOG = process.env.SMOKE_LOG ?? "/tmp/feat-516-smoke.jsonl"
const PROD = "https://admin.jesusfilm.org/api/graphql"
// SMOKE_LIMIT_ISSUE_ONCE=<seconds>: answer the FIRST context issuance the
// way @envelop/rate-limiter does, then behave normally.
let limitIssueOnce = process.env.SMOKE_LIMIT_ISSUE_ONCE
  ? Number(process.env.SMOKE_LIMIT_ISSUE_ONCE)
  : null

const mint = () => randomBytes(32).toString("base64url")
const viewerToken = mint()
const sessionToken = mint()
let issuedNonce = null
let sequence = 0

// The subset of admin's fact schemas (contracts.ts) that mobile emits: no
// playback_viewing_mode, no partial-coverage missingReason. A key admin would
// reject must show up here as a problem, not as an accepted receipt.
const PAYLOAD_KEYS = {
  playback_attempt: ["initiation"],
  playback_start: ["positionSeconds"],
  playback_progress: [
    "positionSeconds",
    "durationSeconds",
    "progress",
    "wallElapsedMilliseconds",
  ],
  playback_seek: ["fromSeconds", "toSeconds"],
  playback_observation: [
    "version",
    "elapsedMilliseconds",
    "visibility",
    "playerState",
    "startObserved",
    "errorObserved",
    "seekCount",
    "navigationCount",
    "qoeCount",
  ],
  playback_navigation: ["action", "cause", "positionSeconds"],
  playback_qoe: ["action", "cause", "positionSeconds"],
  playback_active_visible_playing: ["activeMilliseconds", "coverage"],
  playback_end: [
    "reason",
    "positionSeconds",
    "durationSeconds",
    "progress",
    "completed",
  ],
  playback_error: ["code", "positionSeconds"],
}

function log(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry })
  appendFileSync(LOG, line + "\n")
  console.log(line)
}

// False after a proxy restart: the device keeps the identity an earlier
// proxy minted in SecureStore. That is expected, not a fault.
const checkIdentity = (v) =>
  v.viewerToken === viewerToken &&
  v.sessionToken === sessionToken &&
  v.sessionDigest == null

function validateFacts(events) {
  const problems = []
  for (const e of events) {
    const expected = PAYLOAD_KEYS[e.kind]
    if (!expected) problems.push(`unknown kind ${e.kind}`)
    if (typeof e.eventId !== "string" || e.eventId.length > 191)
      problems.push(`bad eventId ${e.eventId}`)
    if (Number.isNaN(Date.parse(e.occurredAt)))
      problems.push(`bad occurredAt ${e.occurredAt}`)
    const keys = Object.keys(e.payload ?? {}).sort()
    const want = (expected ?? []).slice().sort()
    if (JSON.stringify(keys) !== JSON.stringify(want))
      problems.push(`${e.kind} keys ${keys} != ${want}`)
    if (
      e.kind === "playback_active_visible_playing" &&
      e.payload.activeMilliseconds > 60000
    )
      problems.push("active chunk > 60s")
  }
  return problems
}

function handleLocal(op, variables, headers) {
  const base = {
    op,
    auth: headers.authorization ? "present" : "absent",
    viewerId: headers["x-viewer-id"] ?? null,
    identityOk: checkIdentity(variables),
  }
  switch (op) {
    case "CreateRecommendationViewer":
      log(base)
      return {
        data: {
          createRecommendationViewer: {
            viewerToken,
            sessionToken,
            expiresAt: new Date(Date.now() + 180 * 86400000).toISOString(),
            personalization: true,
          },
        },
      }
    case "UpdateRecommendationViewer":
      log({ ...base, action: variables.action })
      return {
        data: {
          updateRecommendationViewer: {
            state: "active",
            personalization: true,
          },
        },
      }
    case "IssueWatchPlaybackContext":
      if (limitIssueOnce != null) {
        const retryAfter = limitIssueOnce
        limitIssueOnce = null
        log({ ...base, mediaId: variables.mediaId, limited: true, retryAfter })
        // HTTP 200 with errors[]: Yoga reads extensions.http.status, so the
        // transport status never becomes 429. The client must read the extension.
        return {
          errors: [
            {
              message: "Too many requests",
              extensions: {
                http: {
                  statusCode: 429,
                  headers: { "Retry-After": String(retryAfter) },
                },
              },
            },
          ],
        }
      }
      issuedNonce = mint()
      log({
        ...base,
        mediaId: variables.mediaId,
        discoverySource: variables.discoverySource,
        provenance: variables.provenance,
      })
      return {
        data: {
          issueWatchPlaybackContext: {
            claimNonce: issuedNonce,
            contextVersion: "playback-context-v1",
          },
        },
      }
    case "ClaimSemanticRecommendationEpisode":
      log({
        ...base,
        mediaId: variables.mediaId,
        nonceMatches: variables.claimNonce === issuedNonce,
      })
      return {
        data: {
          claimSemanticRecommendationEpisode: {
            episodeId: "smoke-episode-1",
            capability: "smoke-capability",
            activeUntil: new Date(Date.now() + 3600000).toISOString(),
            hardUntil: new Date(Date.now() + 7200000).toISOString(),
          },
        },
      }
    case "RecordSemanticRecommendationPlayback": {
      const events = variables.events ?? []
      log({
        ...base,
        contractVersion: variables.contractVersion,
        episodeId: variables.episodeId,
        capability: variables.capability,
        mediaId: variables.mediaId,
        count: events.length,
        kinds: events.map((e) => e.kind),
        payloads: events.map((e) => e.payload),
        problems: validateFacts(events),
        bodyBytes: Buffer.byteLength(JSON.stringify(variables)),
      })
      return {
        data: {
          recordSemanticRecommendationPlayback: events.map((e) => ({
            eventId: e.eventId,
            status: "accepted",
            sequence: ++sequence,
          })),
        },
      }
    }
    default:
      log({ ...base, note: "recommendation op not exercised by smoke" })
      return {
        errors: [
          {
            message: "not in smoke",
            extensions: { code: "SERVICE_UNAVAILABLE" },
          },
        ],
      }
  }
}

// Every operation the fleet bearer rides. The ones the switch above does not
// answer still land here, so they never reach production.
const LOCAL_OPS = new Set([
  "UserRecommendations",
  "CreateRecommendationViewer",
  "UpdateRecommendationViewer",
  "RecordSemanticRecommendationEvidence",
  "SelectSemanticRecommendation",
  "ClaimSemanticRecommendationEpisode",
  "IssueWatchPlaybackContext",
  "RecordSemanticRecommendationPlayback",
])

http
  .createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString("utf8")
    let body = null
    try {
      body = JSON.parse(raw)
    } catch {}
    const op = body?.operationName ?? null
    const isMutation =
      typeof body?.query === "string" && /^\s*mutation\b/.test(body.query)
    // Log EVERY request, forwards included. An empty log with a working app
    // means the app is not talking to this process.
    log({
      req: op,
      mutation: isMutation,
      auth: req.headers.authorization ? "present" : "absent",
    })
    res.setHeader("content-type", "application/json")
    if (op && LOCAL_OPS.has(op)) {
      res.end(
        JSON.stringify(handleLocal(op, body.variables ?? {}, req.headers)),
      )
      return
    }
    if (isMutation) {
      log({ op, blocked: true })
      res.end(
        JSON.stringify({
          errors: [
            {
              message: "mutation blocked in smoke",
              extensions: { code: "BLOCKED" },
            },
          ],
        }),
      )
      return
    }
    // Public reads go upstream WITHOUT the Authorization header.
    try {
      const upstream = await fetch(PROD, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw,
      })
      res.statusCode = upstream.status
      res.end(await upstream.text())
    } catch (error) {
      log({ op, forwardError: String(error) })
      res.statusCode = 502
      res.end(JSON.stringify({ errors: [{ message: "forward failed" }] }))
    }
  })
  .listen(PORT, () => log({ listening: PORT, log: LOG }))
```

Keep the operation-name set and the payload-key table in step with the app's
documents (`apps/mobile/src/lib/recommendations/operations.ts`) and admin's
`contracts.ts`. A stale table turns a real schema defect into a green
`problems: []`.

### Point the app at the proxy

Write the override to the per-machine file, never to `.env.local`.
`fetch-secrets` replaces `.env.local` wholesale (`apps/mobile/package.json:9`),
and `.env.development.local` is never loaded in production mode, so it cannot
reach a published bundle (`apps/mobile/CLAUDE.md:128-131`).

```bash
# apps/mobile/.env.development.local
EXPO_PUBLIC_ADMIN_GRAPHQL_URL=http://localhost:3010/api/graphql
```

Use `localhost`, not a LAN address. The resolver classifies `localhost`,
`127.0.0.1` and `::1` as `local`, so the production refusal stays quiet
(`adminEndpoint.ts:26-32`, `:51-59`). On an Android emulator in a development
bundle both loopback names are rewritten to `10.0.2.2`
(`adminEndpoint.ts:23`, `:63-76`), so one value serves both simulators.

Never bind the proxy to 3003. That port is the development default
(`LOCAL_ADMIN_GRAPHQL_URL`, `adminEndpoint.ts:5`), and a real local admin
usually owns it over IPv6. Pick a port nothing listens on, such as 3010, and
prove it before you start:

```bash
lsof -nP -iTCP:3010 -sTCP:LISTEN || echo "3010 is free"
```

Start the proxy and the worktree's own Metro detached, so they keep running
after the shell that started them exits. Restart Metro with `--clear` after every change to the env
file: Expo inlines `EXPO_PUBLIC_*` at bundler startup, so a reload picks up
nothing (`adminEndpoint.ts:122-123`).

```bash
SMOKE_PORT=3010 SMOKE_LOG=/tmp/feat-516-smoke.jsonl \
  nohup node fake-admin-proxy.mjs > proxy.log 2>&1 < /dev/null &

cd apps/mobile
nohup npx expo start --dev-client --port 8095 --clear > metro.log 2>&1 < /dev/null &
sleep 8 && curl -s http://127.0.0.1:8095/status
```

Then prove the override reached the served bundle before you trust any log
line. The session fetched the iOS dev bundle from Metro and grepped it:

```bash
curl -s -o /tmp/bundle.js -m 900 \
  "http://127.0.0.1:8095/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true"
grep -c "localhost:3010" /tmp/bundle.js   # must be > 0
```

The app also prints one `[admin-endpoint] admin_endpoint.url=...` line at env
module evaluation in a development bundle (`adminEndpoint.ts:130-139`). Read
it in the Metro log as a second check.

### Drive the device

The dev client is `forgemobile://` (`apps/mobile/app.json:8`). Point it at the
worktree's Metro, then open a video by deep link:

```bash
UDID=<simulator udid>
xcrun simctl openurl "$UDID" "forgemobile://expo-development-client/?url=http://127.0.0.1:8095"
sleep 30
xcrun simctl openurl "$UDID" "forgemobile://watch/the-birth-of-jesus"
```

A deep link is an external open, so the app marks the discovery `share`
with provenance `{ handoff: "shared_link" }`
(`apps/mobile/src/lib/recommendations/playbackDiscovery.ts:3-5`, `:29-30`).
Open a video from a Home tile or a search result to get `direct` or `search`.
Watch past 60 s to see one full active chunk, then leave the page or let the
video end.

### Tear down

Remove the override and stop both processes when you finish. A forgotten
override sends the next session's writes to a proxy that no longer exists,
and the app then shows the frozen fallback Home.

```bash
rm -f apps/mobile/.env.development.local
for port in 8095 3010; do
  pid=$(lsof -ti:$port 2>/dev/null); [ -n "$pid" ] && kill $pid
done
ls apps/mobile/.env.development.local 2>/dev/null || echo "override removed"
```

### Read the log

Each line is one JSON object with an `at` timestamp. Lines with `req` are the
raw request log; lines with `op` are the handled recommendation operations.
This `jq` filter prints the operation sequence one line each:

```bash
jq -r 'select(.op) | "\(.at[11:23]) \(.op) \(.discoverySource // "") \(if has("nonceMatches") then "nonce=\(.nonceMatches)" else "" end) \(.kinds // [] | join(","))"' /tmp/feat-516-smoke.jsonl
```

The healthy sequence for one playback is:

1. `CreateRecommendationViewer` once per installation, with `auth: "present"`
   and a `viewerId`. Every later recommendation operation carries both. The
   `req` lines for forwarded public queries show `auth: "absent"`, which
   proves the bearer rides only the fleet operations.
2. `IssueWatchPlaybackContext` with a `discoverySource`. A playback that
   started from a slate selection skips this and claims with the selection
   nonce instead.
3. `ClaimSemanticRecommendationEpisode` with `nonceMatches: true`.
4. `RecordSemanticRecommendationPlayback` batches: `playback_attempt` with
   `playback_start`, then `playback_progress` about every 10 s, one
   `playback_active_visible_playing` chunk of `activeMilliseconds: 60000` each
   minute, and `playback_observation` with `playback_end` at the end. Each
   batch shows `problems: []`.

Three fields need a rule to read them:

- `identityOk: false` on every line after a proxy restart is expected. The
  device keeps the identity an earlier proxy run minted, in SecureStore under
  `forge-watch.recommendation-viewer.v1`, and the new process minted a
  different one. Only a mismatch in the same proxy run is a defect signal.
- `nonceMatches: false` without a restart means a claim arrived with a nonce
  this proxy did not issue last. Two issuances for one media in quick
  succession produce exactly this, because the proxy keeps one nonce.
- `problems: []` means the batch passed the schema mirror. Any string in that
  array names the kind and the keys that admin would reject. `bodyBytes`
  beside it checks the 8 KB body cap.

`blocked: true` marks a non-recommendation mutation the proxy refused, and
`forwardError` marks a public query that did not reach production. Both
should be absent in a healthy run.

### Inject one fault

Restart the proxy with `SMOKE_LIMIT_ISSUE_ONCE=<seconds>` to answer the first
`IssueWatchPlaybackContext` the way `@envelop/rate-limiter` does: HTTP 200,
one `errors[]` entry with `extensions.http.statusCode: 429` and a
`Retry-After` header, no `code`. The client maps that to `RATE_LIMITED` with
the window in `retryAfterMs`
(`rateLimitedFrom`, `apps/mobile/src/lib/recommendations/errors.ts:90-99`;
`parseRetryAfterMs`, `:68-77`). Admin's real header value is the window string
`"1m"` (`apps/admin/src/graphql/plugins/rate-limit.ts:144`), while the proxy
sends integer seconds; `parseRetryAfterMs` accepts both. Then reload the dev
client and open one video.
The log must show the limited issuance, a second issuance after the window
under the same discovery mark, a claim that matches the second nonce, and the
held facts delivered.

```bash
pid=$(lsof -ti:3010 2>/dev/null); [ -n "$pid" ] && kill $pid; sleep 1
SMOKE_PORT=3010 SMOKE_LOG=/tmp/feat-516-smoke.jsonl SMOKE_LIMIT_ISSUE_ONCE=3 \
  nohup node fake-admin-proxy.mjs > proxy.log 2>&1 < /dev/null &
```

The same env-variable pattern extends to a one-shot `TIMEOUT` (delay the
answer past the client deadline) or a one-shot `SERVICE_UNAVAILABLE`.

## Why This Matters

The harness found two defects and confirmed one fix end to end. No jest
suite could see any of the three.

**The adapter's `abandoned` reason ended every episode 19 ms after it began.**
The QoE session ends as `abandoned` on the first source arrival (null to url)
and on every dub switch. The first wiring mapped that reason onto the
episode's end, so every playback recorded `playback_end` at once. The mocked
adapter in the hook suite never emitted that reason at that moment, so the
suite stayed green. The fix is pinned in
`apps/mobile/src/hooks/__tests__/useManagedVideoPlayer.recommendations.test.tsx:528-539`:
a source swap and a dub switch call neither `onEnd` nor `dispose`, and only
`dismissed` and `replaced` close the episode from `endSession`
(`apps/mobile/CLAUDE.md:682-686`).

**A Home-tile open creates two recorders.** Each open from a Home tile issued
two `IssueWatchPlaybackContext` about 360 ms apart for the same media. The
first claim failed its nonce match and shipped a stub episode:
`playback_attempt`, `playback_observation` and `playback_end` with
`route_exit` at 0 s, before the real episode began. A deep-link open issued
once. Resolved 2026-09-22 (PR #2376): the fresh watch screen published its
request by slug alone before its Video record landed, the request store's
strict identity key read that as a different video and ended the floating
session as `replaced`, and the host disposed its recorder and created a second
one when the id arrived one commit later. The recorder effect's dependencies
were the carrier, not the cause. See
[the session-identity learning](../logic-errors/session-identity-needs-one-slug-tolerant-predicate.md).
The `feat-516` ticket's close-out checklist records the item as resolved.
The recorder's own suite could not see it: the suite instantiates one recorder
per test, and the defect was in how many the host creates.

**The round-2 review fix was verified end to end.** Review round 2 found that
one transient answer to the context issuance abandoned the whole episode, and
the fix gave the issuance the claim's ladder (three attempts, one window
deferral, the discovery mark taken once). Six recorder tests pin the ladder
against a mocked transport. The fault injection then proved it on Hermes: the
first issuance was limited at 22:59:56.626, the second landed 3.02 s later
under the same `share` discovery, the claim matched the new nonce 9 ms after
that, and the held `playback_attempt` and `playback_start` facts followed 10 ms
later. That one run covered the client's error classifier
(`toRecommendationClientError`) on a 200-with-errors answer, the client's `Retry-After` parsing, the Hermes timer and the
header chain together.

This is a worked instance of the mocked-shape-vs-real-contract discipline.
The mocked tests prove each branch's shape. The proxy log proves the
production contract on the real runtime. It shows which headers ride which
operations, which variables the app sends, and what shape each fact has. It
also shows the order and the interval of every request. One limit stays: the
proxy is itself a mock of Admin.
It proves the client's side of the contract and never Admin's acceptance,
which is why `feat-517` carries the first real-environment smoke
(`docs/roadmap/content-discovery/feat-517-mobile-recommended-for-you-shelf.md:44-45`).

Two side effects follow from the proxy answering in under a millisecond.
On-device timing of the JS path excludes Admin's real latency, which is
asynchronous and never on the tick's path (ticket "Timing evidence",
`feat-516` ticket lines 210-237). And the 30-mutations-per-minute bucket is
never exercised for real, so budget claims stay claims until the real smoke.

## When to Apply

- Any mobile or TV write path to Admin that rides a fleet bearer, when no
  development endpoint with that bearer is enabled. The same shape fits the
  progress mutations or any future bearer-gated operation set.
- Verifying a retry ladder, a rate-limit deferral, a timeout path or a
  dispose-during-flight rule on the real runtime. The one-shot fault variable
  is the simplest way to make a device enter a branch that production would
  enter once a month.
- Proving header scope: that a bearer rides only the operations it should,
  and that public queries go out anonymous.
- Catching host-level defects, such as a double recorder or an event mapped
  to the wrong lifecycle reason, that a per-module suite structurally cannot
  see.

Do not use it as a substitute for the first real-environment smoke. Do not
run it from `.env.local`. Do not bind it to 3003. Do not trust a log line
before the served bundle shows the proxy port. And do not leave the schema
mirror unmaintained: a stale `PAYLOAD_KEYS` table reports `problems: []` for
a batch that admin would reject.

## Examples

### A healthy run with the one-shot fault (round 2, 2026-09-16 UTC)

Printed with a compact per-line summary from `/tmp/feat-516-perf.jsonl`. The
proxy had just restarted with `SMOKE_LIMIT_ISSUE_ONCE=3`, so `identityOk` is
`false` on every line and that is expected.

```
22:59:56.626 IssueContext media=75cdy9 LIMITED retryAfter=3
22:59:59.648 IssueContext media=75cdy9 discovery=share
22:59:59.657 ClaimEpisode media=75cdy9 nonceMatches=True
22:59:59.667 RecordPlayback media=75cdy9  attempt(manual) start(0s)
23:00:07.679 RecordPlayback media=75cdy9  progress(10.047854334s)
23:00:17.794 RecordPlayback media=75cdy9  progress(20.164548708s)
23:00:27.934 RecordPlayback media=75cdy9  progress(30.297960667s)
23:00:38.096 RecordPlayback media=75cdy9  progress(40.464619792s)
23:00:48.232 RecordPlayback media=75cdy9  progress(50.59804225s)
23:00:58.381 RecordPlayback media=75cdy9  active(60000ms)
23:00:58.385 RecordPlayback media=75cdy9  active(826ms) progress(60.748075209s)
...
23:04:31.036 RecordPlayback media=75cdy9  active(30237ms)
23:04:31.042 RecordPlayback media=75cdy9  playback_observation end(ended,273.40161225s)
```

The raw line behind the first entry, which is the shape the client must read
as `RATE_LIMITED` and never as `GRAPHQL_ERROR`:

```json
{
  "at": "2026-09-16T22:59:56.626Z",
  "op": "IssueWatchPlaybackContext",
  "auth": "present",
  "viewerId": "d89299dc-ff4e-4054-962b-b1fcdb8e9136",
  "identityOk": false,
  "mediaId": "cmp78ukoe0ge8qm01v375cdy9",
  "limited": true,
  "retryAfter": 3
}
```

Read it as: limited, re-issued after 3.02 s under the same discovery, claimed
with a matching nonce, facts delivered, one 60 000 ms active chunk per minute,
a final partial chunk, and an `ended` reason at the video's duration.

### The double-issuance anomaly (Home-tile open, 2026-09-16 UTC)

Same log, same summary format. Per this session's reading of the log, the
viewer returned to Home with the floating player up and tapped a tile for the
same media; the action itself was not observed.

```
22:57:40.866 RecordPlayback media=l7sonr  playback_observation
22:57:40.867 IssueContext media=l7sonr discovery=direct
22:57:41.229 IssueContext media=l7sonr discovery=direct
22:57:41.431 RecordPlayback media=l7sonr  end(route_exit,100.544170043s)
22:57:41.432 ClaimEpisode media=l7sonr nonceMatches=False
22:57:41.443 ClaimEpisode media=l7sonr nonceMatches=True
22:57:41.585 RecordPlayback media=l7sonr  attempt(manual) playback_observation end(route_exit,0s)
22:57:41.587 RecordPlayback media=l7sonr  attempt(manual)
22:57:41.656 RecordPlayback media=l7sonr  start(0.305682334s)
22:57:52.408 RecordPlayback media=l7sonr  progress(11.111421709s)
```

Read it as: two issuances 362 ms apart for one media, the first claim's nonce
overwritten by the second issuance, a stub episode that opens and closes at
0 s, and only then the real episode. The same pattern repeated at 22:54:48 and
22:58:23 in the same log. Every batch still showed `problems: []`, so the
schema mirror alone would have called this run healthy. The count of
issuances per open is the signal, and only a log that records every request
can show it.

## Related

- [Mocked-shape-vs-real-contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md): the META home. This doc is a worked instance: the jest suites proved branch shape while two adapter-lifecycle wiring defects were visible only in the proxy's request log on device.
- [Verifying mobile (Expo) worktree changes in the iOS simulator](./verifying-mobile-expo-worktree-changes-in-simulator-20260608.md): the read-path simulator recipe this doc extends (env override in `.env.development.local`, Metro restart, deep links). It says nothing about a write path local admin cannot answer.
- [Expo dev client can relaunch on a cached bundle](./expo-dev-client-cached-bundle-verification.md): grep the served bundle before you trust a device result. The proxy-port check here is that rule applied to an inlined `EXPO_PUBLIC_*` value.
- [Local admin cannot validate a local-auth consumer JWT](./mobile-local-admin-consumer-jwt-auth-issuer-mismatch-20260812.md): the sibling case where a mobile write path against local admin has a real fix. This doc covers the case where none exists.
- [TV/mobile clients consume only public admin queries](../conventions/tv-mobile-clients-consume-only-public-admin-queries.md): its feat-516 note records why the eight recommendation operations answer `UNAUTHENTICATED` without the bearer and a proven viewer handle.
- [Fleet-client bearer must be operation-scoped, never global](../architecture-patterns/fleet-client-bearer-must-be-operation-scoped-not-global.md): the scoping the proxy mirrors when it forwards public reads without the `Authorization` header.
- [Expo env file handling](../mobile/expo-env-file-handling.md): why `.env.development.local` wins and never reaches a published bundle.
- [Throwaway operator harness with explicit deletion contract](../best-practices/throwaway-operator-harness-deletion-contract-20260430.md): throwaway tooling must not become load-bearing, which is why the first real-environment smoke stays with `feat-517`.
- [Synthetic-SSE fetch-patch browser verification](../best-practices/synthetic-sse-fetch-patch-browser-verification.md): the web-side analogue, a synthetic upstream driving the client.
- [A ref's write timing becomes a contract when a diff adds consumers](../logic-errors/pre-flight-correlation-ref-write-misattributes-telemetry-after-failure.md): a prior mobile wiring defect that only a server-side event log exposed, the same class as the two found here.
- [Two predicates for one identity](../logic-errors/session-identity-needs-one-slug-tolerant-predicate.md): the root cause and fix (PR #2376) for the double-issuance anomaly this doc's log exposed, and the diagnostic step it adds to this recipe: read the log's neighbouring queries to spot a stack remount.
- [feat-516 ticket](../../roadmap/content-discovery/feat-516-mobile-recommendations-api-client.md): Results carry the timing evidence, the round-2 device check and the close-out checklist that records the double-recorder item as resolved on 2026-09-22.
- PR #2329 (feat-516), merged 2026-09-17.
