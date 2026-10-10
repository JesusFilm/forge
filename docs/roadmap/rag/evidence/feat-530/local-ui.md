# Local consumer portal verification — 2026-09-28

Branch: `feat/feat-530-consumer-portal`, based on feat-527 backend revision
`eee34ba39`. This is local development evidence, with no production action or
operational migration proof.

The later [UI refinement](ui-polish.md) replaces preview with direct Create and
updates the layout and style. The original evidence below is retained as history.

## Original implemented slice

- `/portal`: responsive consumer UI and GitHub sign-in entry.
- `/portal/identity`: protected JSON identity and backend-availability proof.
- `/portal/members`: protected merged-allowlist directory for member selection.
- Preview/submit creation, read-only authenticated initial owner, one-time key
  display/copy/dismissal, versioned membership and key replacement, suspend/resume
  and terminal revocation.
- Static shell and assets contain no user data. No browser storage, analytics or
  automatic mutation retries. CSP allows only same-origin scripts/styles/connects.
- `scripts/portal-dev.ts` composes the real Postgres access/auth/session adapters
  behind synthetic sign-in. It binds loopback HTTPS and refuses any database
  other than local `forge_rag_portal_dev`. Consumer writer/reader role validation
  passed. Production `serve.ts` has no development identity switch.

## Original observed outcomes (before UI refinement)

`portal:verify` passed in Chrome for Testing 153.0.8010.12 at 1280×900 and 390×844:

- Preview creates no consumer; Back preserves the draft; submit creates the
  consumer and authenticated initial owner.
- Key display is absent after dismissal/reload. First key authenticates; after
  replacement, old key returns 401 and replacement returns 200.
- The last member cannot be removed in the UI. Adding an allowlisted member
  grants management; a different identity sees the consumer without controls.
- The added member can replace the key and remove the original owner. The removed
  owner loses controls on the next sign-in/directory read.
- Suspension denies retrieval, resume restores it, and revocation denies it with
  no further issuance controls.
- Lost creation response is reported with refresh/rotation recovery guidance.
  Exactly one creation POST was sent; the created consumer appears on refresh.
- No browser page errors or mobile horizontal overflow were observed.

The repeatable suite substitutes synthetic display keys while keeping generated
backend credentials only in memory, preventing credential-bearing failure DOM
artifacts. A separate unmodified browser smoke also passed real UI preview,
creation, correctly formatted one-time display, bearer authentication and reload
without re-reveal. It recorded only a pass result, with no credential or artifact
capture.

HTTP lifecycle integration against the isolated database and restricted roles:
2 tests passed, including admission-change rollback, scope intersection,
non-owner denial, stale rotation conflict, immediate old-key invalidation and
terminal revocation. The RAG suite ran 890 tests: 888 passed in the sandbox;
two CLI tests were blocked by tsx IPC socket restrictions. Both affected files
were rerun outside the sandbox: all 28 tests passed. Five tests remain skipped
under their existing opt-in conditions. Typecheck, lint and dependency rules pass.

## Page-load evidence

Local authenticated navigation measured DOMContentLoaded and load at 9 ms.
Decoded initial bytes: document 2,838; CSS 4,621; deferred JavaScript 14,062;
identity 68; consumer directory 173. Total 21,762 bytes across the document and
four same-origin requests. No frontend framework, third-party resources, fonts,
images or telemetry are added. The browser test checks a 60 KB initial payload
budget and resource origins. This is an expected addition over the previous JSON
identity proof at `/portal`, not a production latency comparison; live GitHub
admission reads still govern protected request latency.

Screenshots and timing JSON are in ignored `apps/rag/output/portal/`, captured
only after secret dismissal. Desktop and mobile layouts were visually inspected.

## Remaining feature gates

Feat-530 remains in progress until its PR and remaining checks are accounted for.
Current live GitHub allowlist removal, stale publication/outage, durable session
restart and production leakage checks are not established by synthetic sign-in.
The browser suite does not exercise concurrent owner removal/rotation or every
conflict case; the backend retains its separate concurrency/authorization tests.
Usage reports remain feat-528. Actual RAGBot onboarding must use the portal UI,
and actual `forge-rag-retrieve` ops HTTP dogfood, seven-day grace and any shared
bearer cutoff remain feat-529 and separately authorized production work.
