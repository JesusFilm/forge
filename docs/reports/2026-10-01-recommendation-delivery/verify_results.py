"""Verify saved aggregate diagnosis without network or production access."""

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load(name):
    return json.loads((ROOT / f"{name}.json").read_text())


overview = load("overview")
stages, locales, pools = overview[1:4]
distribution = Counter()
empty_reasons = Counter()
partial_reasons = Counter()
for row in stages:
    count = int(row["requests"])
    cards = row["expected_item_count"]
    distribution[cards] += count
    if cards == 0:
        empty_reasons[row["fallback_reason"]] += count
    elif cards < 6:
        partial_reasons[row["shortfall_reason"]] += count

assert sum(distribution.values()) == 5958
assert distribution[0] == 930 and distribution[6] == 4633
assert sum(distribution[n] for n in range(1, 6)) == 395
assert empty_reasons == {
    "no_candidates": 811,
    "seed_embedding_unavailable": 118,
    "retrieval_timeout": 1,
}
assert partial_reasons == {
    "insufficient_candidates": 383,
    "eligibility_exhausted": 12,
}
assert len(pools) == 51
pool_locales = {row["locale"] for row in pools}
assert len(pool_locales) == 21
assert sum(int(r["empty"]) for r in locales if r["locale"] not in pool_locales) == 683
assert sum(int(r["empty"]) == int(r["requests"]) for r in locales) == 99

supply = load("supply")
assert sum(int(r["partial"]) for r in supply[0] if not r["has_current_pool"]) == 386
assert sum(int(r["partial"]) for r in supply[0] if r["has_current_pool"]) == 9
english = [r for r in supply[0] if r["locale"] == "en" and r["audio_language_slug"] == "english"]
assert len(english) == 1
assert int(english[0]["requests"]) == 1885 and int(english[0]["partial"]) == 0
assert sum(int(r["requests"]) for r in supply[2] if not r["locale_has_published_content"]) == 683
assert all(not r["has_transcript"] for r in supply[2] if r["fallback_reason"] == "seed_embedding_unavailable")
assert [r["locale"] for r in supply[2] if r["fallback_reason"] == "retrieval_timeout"] == ["pt"]

for before, after, expected_before, expected_after in [
    ("birth-gbii", "birth-gbii-audio-prefilter", 1, 36),
    ("beginning-kwanyama", "beginning-kwanyama-audio-prefilter", 2, 36),
    ("creation-wanca", "creation-wanca-audio-prefilter", 4, 31),
    ("birth-english", "birth-english-audio-prefilter", 20, 36),
    ("jesus-gbii", "jesus-gbii-audio-prefilter", 0, 2),
    ("jesus-mandarin-current", "jesus-mandarin-display-zh-hans", 0, 36),
]:
    assert int(load(before)[-1][0]["returned_candidates"]) == expected_before
    assert int(load(after)[-1][0]["returned_candidates"]) == expected_after

print("PASS: cohort totals, reason partitions, locale and pool coverage, exact-audio groups, and all diagnostic comparisons")
