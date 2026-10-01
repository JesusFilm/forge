# Consumer UI refinement — 2026-09-28

User-directed pass on `feat/feat-530-consumer-portal` (base `eee34ba39`, existing
implementation uncommitted). The supplied screenshots and corrections set the
criteria before editing. No additional design questions were needed.

References: `docs/pages/site/index.html` and
`apps/rag/dashboard/template.html`. Reused attributes: JFP red accents, navy,
warm neutrals, sans-serif typography, 4px corners, thin dividers and semantic
ledger rows. No new UI framework or external resources.

## Criteria and outcome

| Observation and consequence                                                      | Requested change                          | Acceptance result                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Introductory copy, onboarding content and footer compete with the consumer list. | Keep the title, controls and rows.        | Removed the eyebrow, subtitle, duplicate list heading, membership explanations, guide, footer and signed-out confirmation. Signed-out view has one GitHub button. |
| Cards scatter actions across multiple lines and make comparisons harder.         | One consumer per row with inline actions. | Semantic table with name, status and aligned actions; no card grid. Narrow screens scroll the table with the name pinned.                                         |
| Creation requires a redundant preview after entering two fields.                 | Create immediately, then show the key.    | Name and read-only initial owner followed by Cancel/Create. Create and Enter both submit directly. Invalid names remain in the form with validation feedback.     |
| Styling was disconnected from the existing Forge surfaces.                       | Use the Forge and RAG source page cues.   | Shared palette, typography, compact borders and table treatment applied.                                                                                          |

Verdict: keep this pass. This is the implementing agent's assessment against the
user's explicit preferences; it does not imply independent design approval.
Confidence is high for the copy/layout and functional criteria. Production login
and latency were not assessed by this local UI pass.

## Matched visual evidence

Captures: `apps/rag/output/portal-polish/{before,after}/` (ignored local output).
Each includes `consumers.png`, `create.png`, `signed-out.png`, `mobile.png` and
`capture.json`. The same four directory fixtures, local-owner identity, Chrome
for Testing 153.0.8010.12 and 1280×900 / 390×844 viewports were used. No clocks or
animations affect these static states. Captures contain no API keys. Before-source
copies are retained in `apps/rag/output/portal-polish/before-source/`.

The visual capture harness substitutes only the directory response to keep rows
identical. The independent lifecycle browser suite uses the real local database.
Existing local consumer records are synthetic test/development data, not production
consumers. No consumer records were removed as part of visual cleanup.

Desktop and mobile images were inspected at the same scale. The mobile table
scrolls internally; page-level overflow is absent. A native pattern-validation
issue exposed by the new invalid-name test was corrected by escaping the hyphen
for HTML's Unicode-set pattern mode.

## Verification

- Real PostgreSQL browser journey passed: direct Create using Enter, invalid-name
  rejection, one-time key display, member management, key replacement, suspension,
  resumption, revocation, cross-owner control visibility and lost-response recovery.
- Typecheck, lint and all seven portal HTTP tests passed.
- Initial decoded payload: 22,191 bytes before, 22,263 bytes after (+72 bytes).
  Both load the same four resources; no additional requests. Local load was
  8.4 ms before and 10.2 ms after in these single observations. These are local
  measurements, not a claim of a statistically significant latency change.
- No page-level mobile overflow after correction. Production authorization and
  admission still use the existing backend.

The programme plan, feat-529, feat-530 and portal README now record direct
creation and the minimal UI conventions. The earlier preview requirement is
superseded by the user's current instruction. Existing production gates remain
in the feature ticket.

Next review prompt: assess the row density and action placement while using the
local portal with your own consumer.
