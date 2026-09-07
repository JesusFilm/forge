# Closed paired model comparison 1

The batch is closed. No repeat, replacement, remaining slot, or media execution is authorized. The immutable bound proposal is `verified-bound-proposal.body`, SHA256 `f1aac2780903fdd16ccfb9aad7af0de7a6de7ee7036534253a8c320ba0e947c4`. Original transport/bridge/native snapshots and reviewed helpers remain byte-preserved; the later replay/deadline correction is separate.

## Results and accounting

The sole original ledger is `/tmp/forge-studio-458-runtime/native-paid-guard/model-comparison-1-live.sqlite`. `live/ledger-export.json`, `live/STOP.json`, `live/canonical-attempts.jsonl` and `summary.json` retain closure: 14 consumed claims, 13 complete and one ambiguous. Known provider-reported charges total **$0.39004885**. The ambiguous claim's actual charge is unknown; **$0.56144** is its reserved ceiling, not a charge. Actual total therefore remains unknown. Authorized batch ceiling was $9.

| Slot | Case / arm                   | Outcome                                                                                                      |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 0    | Held-out ch33 / GPT-5.4      | Three complete requests; valid retained proposal; $0.163131 reported                                         |
| 1    | Held-out ch33 / GPT-5.4-mini | Three complete; valid retained proposal, QA absent/null; $0.03314685 reported                                |
| 2    | Regression ch19 / mini       | Four complete; valid retained proposal; fifth request rejected before network by budget; $0.0366015 reported |
| 3    | Regression ch19 / GPT-5.4    | Three complete plus one ambiguous; no valid proposal; $0.1571695 known, remaining charge unknown             |
| 4–5  | Regression ch31 / both       | Never started                                                                                                |

Slot 2 is budget-limited, not evidence of model incapability. Slot 3 violates the intended no-retry protocol and cannot support a creative comparison. Only the held-out pair completed; neither schema validity nor this small calibrated sample establishes creative acceptance.

## Editorial disposition

`editorial-blind-assessment.md` evaluates exact final canonical document speech. Its assessor saw neutral Birch/Dune/Flint labels and did not infer model identity; it retained prior case-criteria context and was not case-blind. The coordinator and implementing assessor knew model labels. The label map and exact supplied samples are in `live/editorial-label-map.json` and `live/editorial-blinded/`.

Dune/slot 0 retains Henry's three distinctions as concise propositions, but the bridge's short sentences do not develop them. Its depth pass cites Lazarus, stature, murmuring and group judgment not present in final speech. This is an unsupported QA pass, even allowing a deliberately concise structure. Birch/slot 1 develops effort/initiative instead of the three selected distinctions and introduces interpretive claims without adequate qualification. “Slot 1 quality omitted” means the **proposal omitted QA**, not that the assessor omitted evaluating it. Flint/slot 2 preserves genuine believers' fear in reflection, but “if trusting Christ is real, then it has to be ready before the wind rises” blurs the source's distinction between possessing and exercising faith.

Canonical ordered operations matter: slot 0's later `set-text` replaces earlier long `set-speech` prose in effective narration. The longer prose remains intermediate intent only. Nothing was restored or applied. Current set-text schema/description does not explain speech synchronization, and validate-proposal returns validity/quality rather than effective spoken bytes. A narrow future description plus bounded effective-speech feedback could improve self-review; this comparison does not change those semantics or tune prompts. Missing canonical footage/subtitles remains `not_checked`.

## Replay and deadline diagnosis

Exact slot 3 request ordinals 1, 2 and 3 share SHA256 `b59f76a3ce08e39c48c1ebb5c3e505518596cc5f7b2c71d306436f719211ca57`. Both completed intervening responses exhausted 4096 output tokens and ended `tool_calls` with truncated JSON arguments, zero executable parsed calls and zero results. Mastra 1.55.0's continuation condition treats that finish reason as nonterminal and repeats unchanged messages. SDK `maxRetries: 0` did not disable this framework continuation. These are replayed inputs, not distinct creative turns.

`live/replay-diagnosis*`, `live/replay-observation*` and failure-first evidence reproduce through unchanged installed framework with retained SSE, no external network. Matching ch19 case/project/message is explicit. Parsed pack equivalence does not by itself prove exact serialized request equality: JSON property order differed in the diagnostic reconstruction. Original paid request equality is independently established from raw body hashes.

Original native runtime owns a 90000ms whole-run timer; Manager allowed 100000ms, browser harness 600000ms and transport each request 90000ms. Slot 3 canonical start was 2026-09-07T19:05:11.665Z, terminal update 19:06:41.903Z. Fourth request began 19:06:26.830Z and failed after 14877ms; cumulative duration closely matches native whole-run expiration. `live/timing-evidence.json` preserves timestamps and their provenance. Source-extracted fake-clock reproduction confirms that abort path. Historical AbortError did not tag its source, so native whole-run attribution is strongly supported, not directly recorded telemetry. The partial stream has no DONE or usage; no billing inference or replay was used to fill the gap.

## Preview, fixtures and services

Retained canonical reads returned 200 and three preview documents exist. Earlier UI-ready observations did not establish rendered visual acceptance. Authenticated preview preparation later returned 429; invalid authentication returned 401. Inspection of the unchanged preview service identified its eight-session quota, not a renderer failure. No sessions were purged. Preserve the intermediate/final screenshots as observations, not visual acceptance.

`live/asset-preflight-before.json` and `live/asset-preflight-after.json` preserve identical project/pack/asset identities around the batch. The 132 recovered originals and previous paid batches were not modified. Previously documented 936 unavailable disposable objects remain unavailable; database rows do not prove their retention.

`live/service-change-intent.json` and `live/service-closure-intent.json` record own-service transitions. The paid native runtime on 4189 was stopped; Manager 3588 was restored to deterministic 4188. No production/shared service was changed. Baseline `/tmp/forge-studio-458-baseline` remains in place because its own Manager/preview processes still depend on it. New scratch uses workspace `.tmp` under inode pressure; no sibling cleanup occurred.

The feature remains in progress: improved live creative quality and actual authorized ElevenLabs narration/music/voice evidence are outstanding. All prior paid batches remain closed.
