# GotQuestions Icelandic — relevance decisions

Resolved under the operator’s instruction to apply decisions from prior source slices. Of 22 disputed pairs, **9 are included and 13 excluded**. The six-case draft now credits **26 pairs across 21 distinct documents**. Original panel scores remain historical evidence; these are explicit adjudication decisions, not rewritten scores.

## Precedents applied

- **P1 — substantive whole-document answers.** [Cru Stage 4](../slices/cru.md) rejected sound-but-off-question material and reinstated 13 credits on review. [The eval approach](../eval-approach.md) requires judging the whole document, including answers buried after an introduction. Shared themes or assertions do not answer a request for reasons.
- **P2 — reject generic gospel endings.** [EveryStudent multilingual campaign §0.9](../slices/everystudent-siblings.md) rejected otherwise off-topic articles whose closing invitation happened to match a query. An article that develops forgiveness or salvation in its body can still qualify.
- **P3 — match the requested stage and action.** [EveryStudent Arabic Stage 4](../slices/everystudent-ar.md) rejected pre-conversion material for a believer’s next-step question. Conversion, assurance, and practical discipleship are distinct needs.
- **P4 — separate relevance from soundness.** [EveryStudent Arabic’s single-source decision](../slices/everystudent-ar.md) uses relevance for credits, reporting soundness separately. Icelandic has the same single-source condition.
- **P5 — retain honest buried answers.** [EveryStudent multilingual campaign §0.9](../slices/everystudent-siblings.md) retained relevant material even when coverage fell because the engine missed it. Retrieval results did not decide these keys.

## Decisions

Whole extracted documents were reviewed in independent contexts without retrieval results or initial panel scores. The agent then applied the precedents to the 22 recommendations, rejecting one proposed inclusion that relied on a short gospel invitation. These decisions use machine-assisted Icelandic reading and English paraphrases; they do not claim native-speaker or human theological verification.

### gq-is-seeker-forgiveness

I am ashamed of what I have done. How can I receive God's forgiveness and start again?

| Decision    | Document                                      | Reason                                                                                                                                                                     | Precedent |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **include** | `/islenska/vegur-Romverjans-hjalpraedis.html` | The Romans Road develops the need for forgiveness, faith in Christ, repentance, and freedom from condemnation; forgiveness is its substance, not an appended invitation.   | P1, P2    |
| **exclude** | `/islenska/lif-eftir-daudann.html`            | The article explains the afterlife; the closing invitation does not turn it into an answer about receiving forgiveness for past actions.                                   | P2        |
| **include** | `/islenska/ekki-fremja-sjalfsmord.html`       | A substantive body section addresses grave past wrongdoing, repentance, forgiveness, and becoming new; its suicide-prevention framing does not erase that direct answer.   | P1        |
| **exclude** | `/islenska/gerist-eftir-daudann.html`         | It explains post-death destinations and judgment, without explaining how to receive forgiveness and begin again now.                                                       | P1        |
| **include** | `/islenska/eilift-lif.html`                   | The body develops sin, Christ’s sacrifice, repentance, and faith as the means of forgiveness; this is more than its concluding prayer.                                     | P1, P2    |
| **include** | `/islenska/hjalprad.html`                     | The salvation explanation connects separation caused by sin to forgiveness and restored relationship through Christ; that developed answer meets the question.             | P1, P2    |
| **exclude** | `/islenska/rett-tru-fyrir-mig.html`           | The article argues for choosing Christianity; its brief forgiveness offer and closing prayer are the gospel-tail pattern previously rejected in the multilingual campaign. | P2        |
| **include** | `/islenska/hvao-naest.html`                   | Its substantial opening explanation of salvation and assurance explains how forgiveness is received, even though later sections address new believers.                     | P1        |

### gq-is-skeptic-jesus-divinity

Was Jesus just a good teacher, or are there biblical reasons to believe he is God?

| Decision    | Document                                | Reason                                                                                                                                           | Precedent |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| **exclude** | `/islenska/lif-eftir-daudann.html`      | It assumes Christ’s divine identity while explaining the afterlife; it does not develop the requested case against the merely-good-teacher view. | P1        |
| **exclude** | `/islenska/Jesus-einasti-vegurinn.html` | It argues that Jesus is the route to salvation, while assuming rather than defending his divine identity against the question’s objection.       | P1        |
| **include** | `/islenska/rett-tru-fyrir-mig.html`     | The body develops Jesus’ authority and resurrection evidence, giving reasons to consider him more than an ordinary teacher.                      | P1        |

### gq-is-skeptic-bible-trust

The Bible was written by people. Why should I trust that it is God's word?

| Decision    | Document                                | Reason                                                                                                                                       | Precedent |
| ----------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **exclude** | `/islenska/Jesus-einasti-vegurinn.html` | It uses biblical authority to explain salvation but does not defend that authority against the objection that human authors wrote the Bible. | P1        |

### gq-is-believer-recurring-sin

I believe in Jesus but keep falling into the same sin. How can I resist it in daily life?

| Decision    | Document                           | Reason                                                                                                                                                  | Precedent |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **include** | `/islenska/Kristni.html`           | The body explicitly addresses believers’ continuing struggle with sin and directs them to read and apply Scripture and follow the Spirit in daily life. | P1        |
| **exclude** | `/islenska/eitt-sinn-holpinn.html` | Assurance that salvation cannot be lost does not explain how to resist recurring sin in daily life.                                                     | P3        |

### gq-is-newcomer-next-steps

I have just begun believing in Jesus. What should I do next to grow in faith?

| Decision    | Document                                      | Reason                                                                                                                                      | Precedent |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **include** | `/islenska/Kristni.html`                      | It moves beyond conversion to practical post-conversion guidance: apply Scripture, follow the Spirit, and live in fellowship and obedience. | P1, P3    |
| **exclude** | `/islenska/endurfaedd-kristin-manneskja.html` | It explains becoming born again; the question is what someone who already believes should do to grow.                                       | P3        |
| **include** | `/islenska/merking-lifsins.html`              | The discipleship section explicitly recommends learning about Jesus, Bible reading, prayer, and obedience beyond initial belief.            | P1, P3    |
| **exclude** | `/islenska/vita-vissu-sina-himininn.html`     | It explains obtaining and being assured of salvation, without practical guidance for growth after conversion.                               | P3        |
| **exclude** | `/islenska/personulegur-Frelsari.html`        | It explains receiving Jesus as Savior and ends with a conversion invitation, rather than giving subsequent discipleship steps.              | P3        |

### gq-is-seeker-purpose

My life feels empty even though things are going well. How can I find lasting purpose according to Christianity?

| Decision    | Document                                | Reason                                                                                                                                                    | Precedent |
| ----------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **exclude** | `/islenska/eilift-lif.html`             | It explains receiving eternal life, without developing how faith addresses present emptiness and purpose; its invitation does not fill that gap.          | P1, P2    |
| **exclude** | `/islenska/Jesus-einasti-vegurinn.html` | Its focus is salvation’s exclusive route; it does not develop an answer about present meaning and fulfillment despite outward success.                    | P1        |
| **exclude** | `/islenska/pekktu-vilja-Guds.html`      | It discusses discerning permissible decisions and aligning desires with God’s will, rather than the question’s existential emptiness and lasting purpose. | P1        |

## Resulting key sizes

| Case                           | Before | After |
| ------------------------------ | -----: | ----: |
| `gq-is-seeker-forgiveness`     |      5 |    10 |
| `gq-is-skeptic-jesus-divinity` |      5 |     6 |
| `gq-is-skeptic-bible-trust`    |      1 |     1 |
| `gq-is-believer-recurring-sin` |      1 |     2 |
| `gq-is-newcomer-next-steps`    |      1 |     3 |
| `gq-is-seeker-purpose`         |      4 |     4 |

The original 918 pair judgments plus 22 supplemental full-document reviews total 940; no further three-lens panel was run. The draft questions, retrieval language, model, top-k, cutoff, and corpus were not changed. Only the relevant sets changed.

The rerun receipt is `gotquestions-is-evaluation-adjudicated.json`. The initial 17-credit receipt is retained as `gotquestions-is-evaluation-candidates.json`; their different answer-key identities prevent treating them as a matched-control regression comparison. The previously reproduced programming false positive remains recorded separately; no cutoff change or new negative check is implied.

Candidate file: `apps/rag/eval/candidates-gotquestions-is.yaml`. The operator subsequently approved the six-case append to canonical `apps/rag/eval/qa-golden.yaml` on 2026-09-08. It is complete; the full canonical rerun and limitations are recorded in `gotquestions-is-evaluation-canonical.json`.
