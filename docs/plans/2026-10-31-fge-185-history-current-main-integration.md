# FGE-185 History reliability on current main

## Scope and immutable inputs

PR2384 reports `8277cd4f0cfdaa345a6604dbb13c945e40d035b1` while
`fix/fge-185-watch` and the synthetic merge parents use its direct child
`482ecf866acbc7a06e8b2cd2475da11445c465ce`. The child changes only the incoming
ticket status. This candidate starts from that child and integrates main
`c2e4bd3aec94198fc074ec7c37e546469d6001d1`, preserving both heads and main.
No PR merge or deployment is authorized. The current staged composition is
uncommitted and unpublished until validation and independent review finish.

The direct original source is FGE-185/W-043 and the original PR account. The
named audit observer is unknown; the issue filer is not assumed to be that
observer. Main still has the source-supported rejection-to-anonymous failure
path. Historical author A/B and mocked tests are not fresh runtime evidence.

## Work

- Retain the offered per-item isolation, order-preserving width-eight sliding
  pool, 20-second aggregate fan-out budget and signal/race behavior in
  `apps/web/src/lib/watch-history.ts`.
- Keep authenticated degraded responses in
  `apps/web/src/app/api/watch-progress/route.ts`, and the read/write/delete
  fallbacks in `apps/web/src/lib/watch-progress-server.ts`.
- Share the bounded nonthrowing reason token in
  `apps/web/src/lib/safe-error-name.ts`, retaining the route's existing
  `errorName` import contract. No message, body or raw error enters the log.
- Correct deadline/counter attribution and the solution's PR link. Preserve
  current main's root rules and the merged signed-out History sign-in return
  destination from PR2822. Unmerged bootstrap PR2647 is not imported.
- Rename only incoming 537/539/540 to 919/920/921 after the fresh all-author,
  retained/frozen, filename/frontmatter and reservation audit. Preserve the
  separate Studio tickets, existing 918 reservation and bidirectional edges
  through platform feat-229. The repair remains in progress; both follow-ups
  remain not started.

## Review and validation gates

Source qualification found three P3 items: error names lacked bounded,
nonthrowing extraction; the deadline diagnostic overclaimed causal diagnosis;
and the governing solution linked unrelated PR2382. The local changes address
those source points, but no post-repair tests have run at this preparation
stage. A fresh independent integration review remains required.

Run the three affected history/route/progress suites and meaningful old-red /
new-green controls for throwing and unsafe error names. Preserve healthy
siblings, authenticated user/entries, five item logs plus summary, safe token
shape and read/write/delete fallbacks. Keep width-eight and blocked-item-zero /
item-eight-starts-before-zero-settles controls, partial cards, actual deadlines,
preabort/no-new-claims and late completion/rejection behavior.

Then run scoped format/lint, Web nonincremental types and relevant locale,
roadmap/hidden-lane guards through normal hooks. Do not substitute historical
44 tests or old hosted CI for this candidate. Initial heavy validation was
deferred behind the PR2383 browser/loading worker. Its bounded R7 result is
separate from this History repair; a dedicated History validation task now
owns the Forge heavy slot and remains pinned to the initial frozen candidate.

## Source-review lifecycle correction — 2026-10-31

The first independent integration review covered all fifteen paths and found
the three initial P3 repairs addressed. It identified one further P3: a healthy
or empty pool retained its abort listener until the shared signal aborted.
With a caller-owned nonaborting signal, repeated completed pools accumulated
listeners. Production creates a fresh bounded signal; no production failure or
unbounded production leak was established.

The next source variant gives the listener a stable identity, removes it in
`finally`, and starts neither queries nor listeners for empty or preaborted
input. Regression controls count real signal listeners across healthy/empty
reused-signal calls, preserve the caller's listener, check preabort, and retain
abort settlement and late rejection handling. These four new cases have not
run at source preparation. The original validation task keeps its immutable
source pin; its results cannot certify this variant's changed paths. Adopt and
validate this exact source variant separately before normal publication.

## Actual runtime and loading acceptance

Use the real locked Apollo/HttpLink/timeout-fetch against a controlled current
Admin operation/schema endpoint: healthy video, null, errors-only, partial data
with GraphQL errors, HTTP errors, malformed body, refused connection, delayed
headers/body and recovery. Record actual cancellation/socket closure and
late-work limits; a settled race alone is not cancellation evidence.

Exercise current production History with isolated local test identities: guest
sign-in return destination, user A with one bad video and healthy siblings,
all bad and recovered, A-to-B and anonymous controls, no cross-user bucket
promotion, authenticated200 versus guest401/malformed400, cheap includeVideos
false and real storage/delete semantics. Synthetic sessions do not certify
live Auth/Admin providers or durable real persistence.

Compare matched current-main/candidate History at390/1280 for0/1/200 entries,
one bad/all bad/all hanging, held-first refill, slow read/write/auth and
recovery. Measure full route stages and usable cards, query starts/completions,
max concurrency, actual aborts, resources and relevant loading metrics. The
20-second fan-out ceiling is not the full POST ceiling. Keep every sample and
limit; no performance or readiness claim from source preparation.

## Deferred scope and publication

Degraded-empty marker/UI stays in feat-920; repeated authenticated fan-out
admission stays in feat-921. Neither is silently closed or implemented here.
Existing analytics, authorization, bearer selection/no-store, language routing
and recommendation coverage decisions remain unchanged.

Before an eventual normal non-forced push, guard the remote named tip and
main again, prove both old heads and integrated main ancestry, and complete
normal hooks/review. PR REST/GraphQL head, named ref, pull head and applicable
new-SHA CI must converge afterward. No dummy sync commit, base flip,
close/reopen, approval, merge or production deployment. Parent owns exact
GitHub/Linear receipts. FGE-185 and canvas stay unresolved until acceptance.

## Roadmap index qualification

The current viewer treats an ambiguous inherited ID as satisfied only when all
matching tickets are complete. Legacy feat-229 includes the completed Auth
History ticket and a distinct in-progress production-readiness ticket. Their
files and statuses are preserved. The three incoming rows therefore render
blocked in the index even though their source frontmatter remains respectively
in-progress and not-started. The index adds only these three rows and their
count/date effects. Existing row cells remain unchanged; Prettier re-aligns
the platform table for the new date columns. No unrelated ticket is rewritten.
