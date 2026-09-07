# Independent held-out content overlap audit

The exact ch33 source excerpt does **not** occur in any of the 19 retained outgoing paid requests or the unchanged effective instructions, either as raw source bytes, a decoded JSON string substring, or the full normalized word sequence. There are **zero shared contiguous phrases of eight or more words**. The longest shared span is only three words in 15 requests; it is two words in the other four requests and in the instructions.

All 19 file hashes match the earlier audit. The held-out source is 3134 UTF-8 bytes / 617 normalized words, SHA256 `c2bb9fefb171e2af88ab2f2269bdf6a8645585ebf94e8481120f44b4a29d4127`. The unchanged proposal remains SHA256 `d7e9a51c02d7f32006dcd204b1b316ae48c79d2b1d700713539e94132cdb0e21`.

The complete audit is `content-overlap-audit.json`. Every file has its SHA256, all tied longest matching spans, target JSON path and zero-based half-open character/word locations, source-section labels, and an unfiltered list for all maximal eight-word-or-longer matches (empty in every case). `audit-content-overlap.py` is the reproducible offline scanner; it creates the audit with exclusive creation and will not overwrite it.

## What the short matches mean

- Embedded Scripture shares `and saw him`, `that is a`, and `that way … And` (the latter spans a verse number ignored by word normalization). These are common narrative wording, not a retained ch33 quotation.
- Henry's introduction shares `in the gospels`, `the other side`, and `to have been`. In retained requests these appear in the earlier storm or Good Samaritan material; they do not reproduce the held-out argument.
- The specific Henry argument shares only generic fragments such as `doing good to` and `that is a` among the longest matches. Neither the three conditional distinctions about group guilt, possible repentance, and beneficial visitation nor the physician/sick reasoning appears as a substantive contiguous wording match. This is a lexical finding, not a claim that all related themes are absent.
- Instruction and schema matches are ordinary two-word phrases such as `in the`, `to the`, and `is a`. They remain in the machine-readable evidence; none was filtered out to improve the result.

## Method and limits

Compare each decoded JSON string value and key independently with the exact saved `heldout-source.body`; compare the plain frozen instructions separately. Normalize case and Unicode compatibility forms, fold ae/oe ligatures, treat literal escaped newline/tab/carriage-return sequences as separators, and tokenize Unicode letters while splitting punctuation and numbers. Do not join unrelated JSON leaves. Source sections are labeled as embedded Scripture, Henry introduction, or Henry specific argument using the original excerpt boundaries.

Eight words is the requested reporting threshold, **not a subjective pass/fail threshold**. No boilerplate, stopwords, Scripture, schema text, or inconvenient matches were discarded. A separate `difflib.SequenceMatcher(autojunk=False)` calculation independently confirmed all 20 longest-span results; exact eight-word set intersections independently confirmed zero matches for all 20 files.

This strengthens the claim that ch33's source wording was unseen in these retained Studio paid requests and frozen instructions. It does not establish a training-data holdout, semantic independence, unseenness across all historical sessions, or model unfamiliarity with Luke/Henry. No historical saved generated answer file was opened; only already-retained outgoing request continuations were scanned. No future model payload, native configuration, database record, existing audit, proposal, or repository file was changed. No paid call was made.
