#!/usr/bin/env python3
"""Project a completed read-only Admin audit into compact, reviewable evidence."""

import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("coverage_json", type=Path)
    parser.add_argument("inventory_json", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).parent)
    args = parser.parse_args()
    coverage_bytes = args.coverage_json.read_bytes()
    inventory_bytes = args.inventory_json.read_bytes()
    report = json.loads(coverage_bytes)
    inventory = {row["coreLanguageId"]: row for row in json.loads(inventory_bytes)}
    contexts = report["contexts"]
    themes = sorted(set().union(*(row["poolCounts"] for row in contexts)) - {"start"})
    reasons = sorted({item["reason"] for row in contexts for item in row["rejected"]})
    fields = ["locale", "audioLanguageSlug", "coreLanguageId", "startUnique", "unionUnique",
              "atLeast6", "atLeast30", "atLeast44", "eligibleVideoIdsUpperBound"]
    fields += [f"pool:{theme}" for theme in themes] + [f"rejected:{reason}" for reason in reasons]
    with (args.output_dir / "admin-language-coverage.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        for context in contexts:
            counts = collections.Counter(item["reason"] for item in context["rejected"])
            row = {key: context[key] for key in fields[:5]}
            row.update({f"atLeast{depth}": context["startUnique"] >= depth for depth in (6, 30, 44)})
            row["eligibleVideoIdsUpperBound"] = inventory[context["coreLanguageId"]]["eligibleVideoIdsUpperBound"]
            row.update({f"pool:{theme}": context["poolCounts"][theme] for theme in themes})
            row.update({f"rejected:{reason}": counts[reason] for reason in reasons})
            writer.writerow(row)
    summary = {
        "status": "admin-local-snapshot-audit-not-production-validation",
        "database": "forge_feat477_20260910 (isolated clone of local forge_feat453)",
        "checkedAt": report["checkedAt"],
        "sourceVersion": report["version"],
        "auditInputDigest": report["sourceDigest"],
        "validationVersion": report["validationVersion"],
        "fullAuditSha256": hashlib.sha256(coverage_bytes).hexdigest(),
        "inventoryAuditSha256": hashlib.sha256(inventory_bytes).hexdigest(),
        "localesAuditedAcrossAllAudioLanguages": sorted({row["locale"] for row in contexts}),
        "languageContexts": len(contexts),
        "unknownCoreVideoIds": report["unknownCoreVideoIds"],
        "starterCoverage": {
            "atLeast30": sum(row["startUnique"] >= 30 for row in contexts),
            "sixTo29": sum(6 <= row["startUnique"] < 30 for row in contexts),
            "oneTo5": sum(0 < row["startUnique"] < 6 for row in contexts),
            "zero": sum(row["startUnique"] == 0 for row in contexts),
            "atLeast44": sum(row["startUnique"] >= 44 for row in contexts),
        },
        "allCatalogOptimisticInventory": {
            "belowSix": sum(row["eligibleVideoIdsUpperBound"] < 6 for row in inventory.values()),
            "zero": sum(row["eligibleVideoIdsUpperBound"] == 0 for row in inventory.values()),
            "interpretation": "Distinct Admin IDs before canonical dedup, including uncurated content; upper bound only",
        },
        "themePoolsAddUniqueCandidatesBeyondStarter": any(row["unionUnique"] > row["startUnique"] for row in contexts),
    }
    (args.output_dir / "admin-coverage-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary["starterCoverage"]))


if __name__ == "__main__":
    main()
