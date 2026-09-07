# Closed follow-up 2: partial editorial improvement, acceptance still incomplete

Two exact saved cases used seven provider requests (ch19 four, ch31 three).
All seven streams completed; none was retried or replaced. Provider-reported cost
is USD 0.0791718, separate from the USD 2 ceiling and USD 1.68432 standard bound.
Total measured provider time is 72,980.209306 ms. Maximum actual serialized input
plus framing bound was 160,854. The batch is CLOSED; STOP.json and the retained
LIVE ledger prevent further dispatch. Paid runtime4189 is stopped. No apply,
approval, narration, media, registration or publication occurred.

## ch19: separate operation, coverage and editorial outcomes

The first proposal puts an extra `role` key on each `set-text` operation. The native
strict tool schema rejects those keys, and the next request contains actionable
schema errors. The second proposal removes them. This is visible in original
paid-0-1-response.body and paid-0-2-request.body.

The second proposal then receives `Studio asset tool rejected`, retained in
paid-0-3-request.body. Exact read-only revalidation of the unchanged second proposal
against the unchanged r1 project reproduces a canonical ZodError: `fontSize`
expects a number but receives strings `"52"` and `"56"` in set-properties. This
happens before coverage validation. The generic Admin/native error boundary hides
that actionable field/type fact. `ch19-readonly-diagnosis.json` is a subsequent
local deterministic diagnosis, not an invented original server trace. No edit was
applied and no paid request was replayed.

Independently, the same unchanged role claims contain `video` and `subtitle` with
status not_checked but actual item IDs. None of those items has those speech roles.
Role-only validation yields ROLE_COVERAGE_UNCHECKED_IDS for video, with actual
roles reflection/bridge/settle. Fixing only property types would still need to
address this separate rejection. Those semantic source checks belong in findings;
custom roles remain permitted when actually represented in the timeline.

The rejected script has 211 spoken words (112 reflection, 90 bridge, nine settle).
It now develops the previously missing distinction: “He is not denying that faith
exists; He is asking whether it is ready for use when the wind rises,” followed by
trusting in sunshine versus storm and unexpected trial. It also retains moderation
about believers showing weakness. These are concrete same-case depth improvements
over the earlier 113-word fear-to-ready-faith jump. Self-echo is now evaluated as
repetition and scripture_echo is correctly not_checked without verse/source context.

That editorial improvement does not rescue canonical validity: zero accepted
proposals and no composed preview. The model also proposes new timing locks,
overlapping spans and a 23-second settle span without spoken-duration evidence;
these warrant operator review independently of its short spoken settle. Its broad
QA passes are not accepted as proof. The final prose honestly says the edit was
rejected. The preserved UI preview timeout means no proposal button existed, not
a browser page error.

## ch31: accepted composition, qualified editorial result

The canonical result has one retained proposal and an actual composed preview,
with truthful reflection/bridge/settle role coverage. The 189-word effective script
contains 102 reflection words, 79 bridge words and eight settle words. A question
role can truthfully be absent while a bridge raises semantic questions; these are
different checks. Scripture_echo and canonical source evidence correctly remain
not_checked. This improves over the prior prose-only false-role result.

The positive fidelity/depth/voice self-ratings are still too broad:

- “will not measure a person’s worthiness before helping” loses the excerpt’s
  distinction about **excessive** scrutiny, along with “wisely, discreetly, and with
  good sense.” Disposition: qualified fidelity concern, not an unqualified pass.
- “does not wait for a safer moment” is not explicitly stated in the supplied
  excerpt. “At once” supports prompt aid, but does not establish a safety-related
  delay or motive. Disposition: remove or label this as an inference in a future
  revision; the closed output is untouched.
- “gives aid” and “costs time, trouble, and care” state the theme but omit the
  excerpt’s wounds, donkey, inn, payment and promised follow-through. These actions
  would substantiate costly practical charity rather than merely naming it.
  Disposition: depth remains partial; its blanket developed-reasoning pass is
  unsupported. The 79-word bridge still carries much of the substantive body.
- “The parable begins with a lawyer’s question” followed by retelling the wounded
  traveler, priest and Levite is an expository premise/recap opening. It does connect
  to the argument, but the model’s blanket curiosity-led/no-recap pass needs a
  concern under the chosen editable default. This is not a universal opening ban.
- The bridge ends with several broad questions about charity, neighbor and future
  willingness, rather than one personal present-tense question. That is a separate
  editorial preference concern, not false canonical role coverage.

Concrete source anchors and the charity-versus-low-cost-benevolence contrast are
present, and the short settle is distinct. Nevertheless, accepted operations and
preview do not establish final editorial acceptance. Fidelity/depth and unsupported
QA passes remain unresolved. No natural voice or music quality was evaluated.

## Evidence and next unpaid correction

`case0-canonical-result.json` and `case1-canonical-result.json` retain actual
canonical output manifests/preview documents. Raw requests contain every dynamic
tool result; raw SSE bodies, extracted proposals and prose remain unchanged.
`ledger.json`, `summary.json`, screenshots and the live adapter preserve costs,
claims, routing and dispatch behavior. The adapter’s additional tested persistent
batch stop narrows execution after any exception; it does not expand authorization.

The demonstrated implementation gap is bounded field/type feedback for canonical
property validation. Strict operation and coverage rejection must remain intact;
no coercion or blanket prompt edit is justified by this result. That correction
will be a separate unpaid code commit. Same-case examples informed the prompt
calibration, so these improvements are regression evidence, not blind generalization
or full feat-458 acceptance. All paid batches remain closed; ElevenLabs stays paused.
