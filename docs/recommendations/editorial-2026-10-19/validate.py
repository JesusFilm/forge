"""Validate the saved editorial list without network or database access."""
import csv
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent
data = json.loads((root / "recommendations.json").read_text())
rows = data["records"]
sources = {r["sourceVideoId"]: r for r in rows}
availability = {
    row["id"]: row for row in json.loads((root / "availability.json").read_text())
}
report = json.loads((root / "validation.json").read_text())
assert len(rows) == len(sources) == report["sources"] == 1031
assert set(sources) == set(availability), "Snapshot source coverage changed"
expected_csv = []
for source in rows:
    targets = source["recommendations"]
    ids = [t["videoId"] for t in targets]
    assert len(targets) == len(set(ids)) == 6, source["sourceTitle"]
    assert len({t["coreId"] for t in targets}) == 6
    assert source["sourceVideoId"] not in ids
    assert [t["rank"] for t in targets] == list(range(1, 7))
    for target in targets:
        original = sources[target["videoId"]]
        assert target["title"] == original["sourceTitle"]
        assert target["coreId"] == original["sourceCoreId"]
        assert target["reason"].strip()
        assert availability[target["videoId"]]["playablePublishedDubs"] > 0
        expected_csv.append({
            "sourceVideoId": source["sourceVideoId"],
            "sourceTitle": source["sourceTitle"],
            "rank": str(target["rank"]),
            "targetVideoId": target["videoId"],
            "targetTitle": target["title"],
            "reason": target["reason"],
            "setRationale": source["setRationale"],
            "decisionMethod": source["decisionMethod"],
            "evidenceFlags": ";".join(source["evidenceFlags"]),
        })
with (root / "recommendations.csv").open(newline="") as handle:
    assert list(csv.DictReader(handle)) == expected_csv, "CSV differs from JSON"
html = (root / "review.html").read_text()
embedded = re.search(
    r'<script\s+id="data"\s+type="application/json"\s*>(.*?)</script>', html, re.S
)
assert embedded and json.loads(embedded.group(1)) == data, "Review differs from JSON"
assert len(expected_csv) == report["recommendations"] == 6186
assert len({tuple(t["videoId"] for t in r["recommendations"]) for r in rows}) == report["uniqueOrderedSlates"]
assert len({t["videoId"] for r in rows for t in r["recommendations"]}) == report["targetVideos"]
assert sum(r["decisionMethod"] == "source-specific-six" for r in rows) == report["sourceSpecificSlates"]
assert sum(r["decisionMethod"] == "shared-editorial-decision" for r in rows) == report["sharedEditorialDecisionSources"]
assert [r["sourceVideoId"] for r in rows if "title-profile-mismatch-or-transcript-language-issue" in r["evidenceFlags"]] == report["mismatchedEvidenceSources"]
print("PASS: 1,031 sources, 6,186 links; membership, uniqueness, snapshot playback, CSV and review agreement.")
